<script lang="ts">
	// Copy the panel directory (docs/design/DESIGN.md §5.8): type in the paper label from the panel
	// door, slot by slot, and save them all as breakers.
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { plural, mutate, type House } from '$lib/house';
	import { createBreaker, createQuad } from '$lib/db/ops';
	import type { Breaker, Panel } from '$lib/db/schema';
	import {
		compareBreakers,
		nextInColumn,
		occupiedSlots,
		position,
		rowCount,
		slotAt,
		slotLabel,
		spacesUsed,
		tandemOk,
		tandemText,
		type Side
	} from '$lib/panel';

	let { house, panel }: { house: House; panel: Panel } = $props();

	const AMP_CHOICES = [15, 20, 30, 40, 50, 60];
	/**
	 * One slot's entry; with `tandem` it's two halves, A (label/amps) and B (labelB/ampsB); with
	 * `quad` (§5.18) it takes the slot below too: the outer pair (label/amps) and inner pair (labelB/ampsB).
	 */
	type Row = { label: string; amps: string; two: boolean; tandem: boolean; quad: boolean; labelB: string; ampsB: string };
	let rows = $state<Record<number, Row>>({});
	const get = (s: number): Row => rows[s] ?? { label: '', amps: '', two: false, tandem: false, quad: false, labelB: '', ampsB: '' };
	function patch(s: number, p: Partial<Row>) {
		rows[s] = { ...get(s), ...p };
	}

	const existing = $derived(house.breakers.filter((b) => b.panelId === panel.id));
	/** Slot → the breaker already there. */
	const taken = $derived.by(() => {
		const m = new Map<number, Breaker>();
		for (const b of existing) for (const s of occupiedSlots(b, panel)) m.set(s, b);
		return m;
	});

	/** The slot directly above in the same column, if any. */
	const above = (s: number) => {
		const { side, row } = position(s, panel);
		return row > 1 ? slotAt(side, row - 1, panel) : null;
	};
	/** A new 2-pole breaker entered on the slot above takes this one. */
	const coveredBy = (s: number): number | null => {
		const up = above(s);
		if (up === null || taken.has(up) || !((get(up).two && !get(up).tandem) || get(up).quad)) return null;
		return coveredBy(up) === null ? up : null;
	};
	const hasA = (r: Row) => r.label.trim() !== '' || r.amps !== '';
	const hasB = (r: Row) => (r.tandem || r.quad) && (r.labelB.trim() !== '' || r.ampsB !== '');
	const hasContent = (r: Row) => hasA(r) || hasB(r);
	/** 2-pole needs the slot below free: not on the panel and not entered in this list. */
	const cant2 = (s: number) => {
		const next = nextInColumn(s, panel);
		return (
			next > panel.slotCount ||
			position(next, panel).side !== position(s, panel).side ||
			taken.has(next) ||
			hasContent(get(next))
		);
	};

	type View =
		| { kind: 'open'; s: number; row: Row; cant2: boolean }
		| { kind: 'cont'; s: number; of: number }
		| { kind: 'existing'; s: number; bs: Breaker[] };

	const view = (s: number): View => {
		const b = taken.get(s);
		if (b) {
			if (b.slot !== s) return { kind: 'cont', s, of: b.slot };
			return { kind: 'existing', s, bs: existing.filter((o) => o.slot === s).sort(compareBreakers) };
		}
		const up = coveredBy(s);
		if (up !== null) return { kind: 'cont', s, of: up };
		return { kind: 'open', s, row: get(s), cant2: cant2(s) };
	};
	const column = (side: Side) =>
		Array.from({ length: rowCount(panel) }, (_, i) => slotAt(side, i + 1, panel))
			.filter((s) => s <= panel.slotCount)
			.map(view);
	const left = $derived(column('left'));
	const right = $derived(column('right'));

	/** The new breakers: open rows with a label or amps. */
	const entered = $derived(
		[...left, ...right]
			.filter((v): v is Extract<View, { kind: 'open' }> => v.kind === 'open' && hasContent(v.row))
			.sort((a, b) => a.s - b.s)
	);
	const isQuad = (v: { s: number; row: Row; cant2: boolean }) => v.row.quad && !v.cant2;
	const isTwo = (v: { s: number; row: Row; cant2: boolean }) => v.row.two && !v.row.tandem && !isQuad(v) && !v.cant2;
	const used = $derived(spacesUsed(existing, panel) + entered.reduce((n, v) => n + (isTwo(v) || isQuad(v) ? 2 : 1), 0));
	// A tandem or quad row is saved as both halves or pairs, even with one left blank.
	const count = $derived(entered.reduce((n, v) => n + (v.row.tandem || isQuad(v) ? 2 : 1), 0));
	const breakersText = (n: number) => (n === 1 ? '1 breaker' : `${n} breakers`);

	// ---- Paste a list: one label per line, in slot order, into the slots that are still open.
	let pasting = $state(false);
	let pasteText = $state('');
	function fillFromList() {
		const lines = pasteText.replace(/\s+$/, '').split(/\r?\n/);
		let i = 0;
		for (let s = 1; s <= panel.slotCount && i < lines.length; s++) {
			if (taken.has(s) || coveredBy(s) !== null) continue;
			patch(s, { label: lines[i++].trim() });
		}
		pasting = false;
		pasteText = '';
	}

	let saving = $state(false);
	let error = $state('');
	async function save() {
		saving = true;
		error = '';
		try {
			await mutate(async () => {
				for (const v of entered) {
					const amps = Number(v.row.amps);
					if (isQuad(v)) {
						// Both pairs are saved, even one left blank, so the slots read as a quad.
						const ampsB = Number(v.row.ampsB);
						await createQuad(
							panel.id,
							v.s,
							nextInColumn(v.s, panel),
							{ label: v.row.label.trim(), amps: amps || 20 },
							{ label: v.row.labelB.trim(), amps: ampsB || 20 }
						);
						continue;
					}
					if (v.row.tandem) {
						// Both halves are saved, even one left blank, so the slot reads as a tandem.
						const ampsB = Number(v.row.ampsB);
						const base = { panelId: panel.id, slot: v.s, poles: 1, kind: 'standard' as const };
						await createBreaker({ ...base, half: 'A', label: v.row.label.trim(), ...(amps ? { amps } : {}) });
						await createBreaker({ ...base, half: 'B', label: v.row.labelB.trim(), ...(ampsB ? { amps: ampsB } : {}) });
						continue;
					}
					await createBreaker({
						panelId: panel.id,
						slot: v.s,
						poles: isTwo(v) ? 2 : 1,
						kind: 'standard',
						label: v.row.label.trim(),
						...(amps ? { amps } : {})
					});
				}
			});
			await goto(resolve('/panel'));
		} catch (e) {
			console.error(e);
			error = "Couldn't save the breakers. Try again.";
			saving = false;
		}
	}
</script>

{#snippet columnOf(views: View[])}
	<div class="col">
		<div class="drow dhead" aria-hidden="true">
			<span class="dnum">Slot</span><span>Label</span><span>Amps</span><span class="c">2-pole</span><span class="c">Tandem</span><span class="c">Quad</span>
		</div>
		{#each views as v (v.s)}
			{#if v.kind === 'open'}
				{@const noT = !tandemOk(v.s, panel)}
				{@const below = nextInColumn(v.s, panel)}
				{@const q = isQuad(v)}
				{@const noQ = v.cant2 || noT || !tandemOk(below, panel)}
				<div class="drow">
					<span class="dnum">{v.s}{q ? `A/${below}B` : v.row.tandem ? 'A' : ''}</span>
					<input
						class="din"
						class:is-filled={v.row.label !== ''}
						type="text"
						value={v.row.label}
						oninput={(e) => patch(v.s, { label: e.currentTarget.value })}
						aria-label="Slot {v.s}{v.row.tandem ? 'A' : ''} label"
					/>
					<select
						class="dsel"
						value={v.row.amps}
						onchange={(e) => patch(v.s, { amps: e.currentTarget.value })}
						aria-label="Slot {v.s}{v.row.tandem ? 'A' : ''} amps"
					>
						<option value="">—</option>
						{#each AMP_CHOICES as a (a)}<option value={String(a)}>{a}</option>{/each}
					</select>
					<label class="d2p">
						<input
							type="checkbox"
							checked={isTwo(v)}
							disabled={v.cant2 || v.row.tandem || q}
							onchange={(e) => patch(v.s, { two: e.currentTarget.checked })}
							aria-label="Slot {v.s} is 2-pole"
						/>
					</label>
					<label class="d2p" title={noT ? `Slot ${v.s} isn’t rated for tandems (${tandemText(panel)})` : undefined}>
						<input
							type="checkbox"
							checked={v.row.tandem}
							disabled={noT || isTwo(v) || q}
							onchange={(e) => patch(v.s, { tandem: e.currentTarget.checked })}
							aria-label="Slot {v.s} is a tandem"
						/>
					</label>
					<label class="d2p" title={noQ && !v.cant2 ? `Slots ${v.s}–${below} aren’t rated for quads (${tandemText(panel)})` : undefined}>
						<input
							type="checkbox"
							checked={q}
							disabled={noQ || isTwo(v) || v.row.tandem}
							onchange={(e) => patch(v.s, { quad: e.currentTarget.checked })}
							aria-label="Slots {v.s} and {below} are a quad"
						/>
					</label>
				</div>
				{#if v.row.tandem || q}
					<div class="drow">
						<span class="dnum">{v.s}B{q ? `/${below}A` : ''}</span>
						<input
							class="din"
							class:is-filled={v.row.labelB !== ''}
							type="text"
							value={v.row.labelB}
							oninput={(e) => patch(v.s, { labelB: e.currentTarget.value })}
							aria-label="Slot {v.s}B label"
						/>
						<select class="dsel" value={v.row.ampsB} onchange={(e) => patch(v.s, { ampsB: e.currentTarget.value })} aria-label="Slot {v.s}B amps">
							<option value="">—</option>
							{#each AMP_CHOICES as a (a)}<option value={String(a)}>{a}</option>{/each}
						</select>
						<span></span>
						<span></span>
						<span></span>
					</div>
				{/if}
			{:else if v.kind === 'existing'}
				{#each v.bs as b (b.id)}
					<div class="drow">
						<span class="dnum">{slotLabel(b, panel).split('/')[0]}</span>
						<span class="dexist" title="Already on the panel">{b.label || 'Unlabeled'}</span>
						<span class="mono dexa">{b.amps}A</span>
						<span></span>
						<span></span>
						<span></span>
					</div>
				{/each}
			{:else}
				<div class="drow">
					<span class="dnum">{v.s}</span>
					<span class="dcont">↳ {get(v.of).quad ? `part of the quad at ${v.of}` : `second pole of ${v.of}`}</span>
				</div>
			{/if}
		{/each}
	</div>
{/snippet}

<main class="dir">
	<section class="left" aria-label="Panel directory">
		<div class="head">
			<div class="tl">
				<h1>Copy the panel directory</h1>
				<span class="mono meta">{panel.name}{panel.mainAmps ? ` · ${panel.mainAmps}A` : ''} · {panel.slotCount} spaces</span>
			</div>
			<p class="sub">Type what’s written on the label inside the panel door. Leave a slot blank if it’s empty or unreadable.</p>
		</div>
		<div class="card">
			<div class="cols">
				{@render columnOf(left)}
				{@render columnOf(right)}
			</div>
		</div>
	</section>

	<aside>
		<div class="box prog">
			<span class="big" role="status">{breakersText(count)} entered</span>
			<div class="bar"><span style:width="{Math.min(100, Math.round((used / panel.slotCount) * 100))}%"></span></div>
			<span class="sm">{used} of {plural(panel.slotCount, 'space')} used · {Math.max(0, panel.slotCount - used)} left</span>
		</div>
		<div class="box tips">
			<span class="ov">Tips</span>
			<div class="tip"><span class="k">Tab</span><span>moves down the column, like reading the label.</span></div>
			<div class="tip">
				<span class="k">2-pole</span><span>Tick it on the top slot of a double-wide breaker (range, dryer, A/C). The slot below joins it.</span>
			</div>
			<div class="tip"><span class="k">Blank</span><span>Empty or unreadable slots can stay blank. Tracing will fill them in later.</span></div>
			<div class="tip"><span class="k">GFCI</span><span>Protection types can be set per breaker on the Panel page afterwards.</span></div>
		</div>
		<div class="grow"></div>
		{#if pasting}
			<div class="box paste">
				<label class="ov" for="paste">Paste a list</label>
				<textarea id="paste" class="inp" rows="6" bind:value={pasteText} placeholder="One label per line, in slot order"></textarea>
				<div class="pb">
					<button type="button" class="btn" onclick={() => (pasting = false)}>Cancel</button>
					<button type="button" class="btn fill" onclick={fillFromList} disabled={!pasteText.trim()}>Fill the slots</button>
				</div>
			</div>
		{:else}
			<button type="button" class="btn wide" onclick={() => (pasting = true)}>Paste a list instead…</button>
		{/if}
		{#if error}<p class="err" role="alert">{error}</p>{/if}
		<button type="button" class="btn btn-pri wide save" onclick={save} disabled={saving || entered.length === 0}>
			Save {breakersText(entered.length)}
		</button>
		<a class="btn wide" href={resolve('/panel')}>Cancel</a>
	</aside>
</main>

<style>
	.dir {
		flex: 1 1 0;
		min-height: 0;
		display: flex;
		gap: 32px;
		padding: 24px 32px;
	}
	.left {
		flex: 1 1 0;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.head {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.tl {
		display: flex;
		align-items: baseline;
		gap: 14px;
	}
	h1 {
		font-size: 28px;
		font-weight: 800;
		font-stretch: 112%;
		letter-spacing: -0.02em;
	}
	.meta {
		font-size: 12px;
		color: var(--muted);
	}
	.sub {
		font-size: 14px;
		color: var(--soft);
	}
	.card {
		flex-grow: 1;
		min-height: 0;
		overflow: auto;
		background: var(--surface);
		border: 1px solid var(--line-2);
		border-radius: var(--r-2xl);
		padding: 12px 20px 20px;
	}
	.cols {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		column-gap: 32px;
	}
	.col {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.drow {
		display: grid;
		grid-template-columns: 62px minmax(0, 1fr) 84px 52px 52px 52px;
		align-items: center;
		column-gap: 8px;
		height: 40px;
	}
	.dhead {
		height: 28px;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.dhead .dnum {
		font-family: inherit;
		font-size: 11px;
		font-weight: 700;
	}
	.c {
		text-align: center;
	}
	.dnum {
		font-family: var(--font-mono);
		font-size: 12px;
		font-weight: 600;
		color: var(--muted);
		text-align: right;
		padding-right: 4px;
	}
	.din,
	.dsel {
		height: 36px;
		width: 100%;
		border: 1px solid var(--field);
		border-radius: var(--r-md);
		background: var(--surface);
		color: var(--ink);
	}
	.din {
		padding: 0 10px;
		font: inherit;
		font-size: 14px;
		font-stretch: 90%;
	}
	.din:focus,
	.dsel:focus {
		outline: 2px solid var(--amber);
		outline-offset: 0;
		border-color: var(--ink);
	}
	.din.is-filled {
		border-color: var(--line-2);
		background: var(--raised);
	}
	.dsel {
		padding: 0 6px;
		font-family: var(--font-mono);
		font-size: 12px;
	}
	.d2p {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 36px;
		cursor: pointer;
	}
	.d2p input {
		width: 18px;
		height: 18px;
		margin: 0;
		accent-color: var(--amber);
		cursor: pointer;
	}
	.d2p input:disabled {
		cursor: default;
	}
	.dcont,
	.dexist {
		height: 36px;
		border-radius: var(--r-md);
		display: flex;
		align-items: center;
		padding: 0 10px;
		font-size: 13px;
		color: var(--muted);
	}
	.dcont {
		grid-column: 2 / span 2;
		border: 1px dashed var(--field);
		font-style: italic;
	}
	/* Already on the panel: shown, not edited here. */
	.dexist {
		background: var(--bg);
		font-size: 14px;
		font-stretch: 90%;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.dexa {
		font-size: 12px;
		color: var(--muted);
		padding: 0 6px;
	}
	aside {
		width: 340px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.box {
		background: var(--surface);
		border: 1px solid var(--line-2);
		border-radius: var(--r-2xl);
		padding: 20px;
		display: flex;
		flex-direction: column;
	}
	.prog {
		gap: 10px;
	}
	.big {
		font-size: 20px;
		font-weight: 800;
		font-stretch: 105%;
	}
	.sm {
		font-size: 13px;
		color: var(--muted);
	}
	.tips {
		gap: 14px;
	}
	.tip {
		display: flex;
		gap: 10px;
		font-size: 13px;
		line-height: 1.45;
	}
	.tip .k {
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 600;
		padding: 2px 6px;
		border-radius: var(--r-sm);
		border: 1px solid var(--line-2);
		background: var(--bg);
		height: fit-content;
		white-space: nowrap;
	}
	.grow {
		flex-grow: 1;
	}
	.paste {
		gap: 10px;
	}
	.pb {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
	}
	.wide {
		width: 100%;
	}
	.save {
		height: 50px;
		font-size: 15px;
	}
	.err {
		font-size: 13px;
		color: var(--warn);
	}
</style>
