<script lang="ts">
	// One panel in Settings → Panels (DESIGN.md §5.7, §5.17). The main panel is always open; a
	// subpanel is a row in the tree with an Edit button that opens the same fields plus name, short
	// code and Delete.
	import Icon from '$lib/components/Icon.svelte';
	import { mutate, plural, type HouseIndex } from '$lib/house';
	import { deletePanel, renamePanel, updatePanel } from '$lib/db/ops';
	import type { Panel } from '$lib/db/schema';
	import { checkFit, occupiedSlots, panelShort, slotLabel, spacesUsed } from '$lib/panel';
	import { MAIN_AMPS, SPACES, SUB_MAIN_AMPS, SUB_SPACES, type Numbering } from '$lib/constants';

	let { ix, panel, depth = 0 }: { ix: HouseIndex; panel: Panel; depth?: number } = $props();

	const house = $derived(ix.house);
	const feeder = $derived(ix.feederOf(panel));
	const sub = $derived(feeder !== null);
	const id = $derived(panel.id);
	const inside = $derived(house.breakers.filter((b) => b.panelId === panel.id));
	let open = $state(false);
	const shown = $derived(!sub || open);

	const ampsChoices = $derived(sub ? SUB_MAIN_AMPS : MAIN_AMPS);
	const spaceChoices = $derived(sub ? SUB_SPACES : SPACES);

	// A spaces or numbering choice that doesn't fit the breakers isn't saved; it waits here.
	let spacesPick = $state<number | null>(null);
	let numberingPick = $state<Numbering | null>(null);
	const shape = $derived({ slotCount: spacesPick ?? panel.slotCount, numbering: numberingPick ?? panel.numbering });

	function fitProblem(s: { slotCount: number; numbering: Numbering }): string | null {
		const used = spacesUsed(inside, s);
		if (used > s.slotCount) {
			return `${used} spaces are in use. Move or remove breakers above slot ${s.slotCount} first.`;
		}
		const bad = inside.find((b) => checkFit(b, s, []));
		if (bad) {
			if (occupiedSlots(bad, s).some((slot) => slot > s.slotCount)) {
				return `Breaker ${slotLabel(bad, { ...s, shortCode: panel.shortCode })} sits past slot ${s.slotCount}. Move or remove breakers above slot ${s.slotCount} first.`;
			}
			return `With this numbering, the 2-pole breaker at slot ${bad.slot} would span both columns. Move it first.`;
		}
		const clash = inside.find((b) => checkFit(b, s, inside));
		if (!clash) return null;
		return `With this numbering, the 2-pole breaker at slot ${clash.slot} would overlap another breaker. Move one of them first.`;
	}
	const problem = $derived(fitProblem(shape));

	function tryShape(next: { slotCount?: number; numbering?: Numbering }) {
		if (next.slotCount !== undefined) spacesPick = next.slotCount;
		if (next.numbering !== undefined) numberingPick = next.numbering;
		const s = { slotCount: spacesPick ?? panel.slotCount, numbering: numberingPick ?? panel.numbering };
		if (fitProblem(s)) return;
		spacesPick = null;
		numberingPick = null;
		if (s.slotCount !== panel.slotCount || s.numbering !== panel.numbering) mutate(() => updatePanel(id, s));
	}

	function saveText(key: 'location' | 'tandemSlots') {
		return (e: Event & { currentTarget: HTMLInputElement }) => {
			const v = e.currentTarget.value.trim() || null;
			if (v !== panel[key]) mutate(() => updatePanel(id, { [key]: v }));
		};
	}
	function saveName(e: Event & { currentTarget: HTMLInputElement }) {
		const name = e.currentTarget.value.trim();
		if (!name) return void (e.currentTarget.value = panel.name);
		if (name !== panel.name) mutate(() => renamePanel(id, name));
	}
	let codeWhy = $state('');
	function saveCode(e: Event & { currentTarget: HTMLInputElement }) {
		const code = e.currentTarget.value.trim().toUpperCase();
		const taken = house.panels.find((p) => p.id !== id && p.shortCode?.toUpperCase() === code);
		codeWhy = !/^[A-Z]{1,3}$/.test(code) ? 'Use 1–3 letters.' : taken ? `“${code}” is already used by ${taken.name}.` : '';
		if (codeWhy) return;
		e.currentTarget.value = code;
		if (code !== panel.shortCode) mutate(() => updatePanel(id, { shortCode: code }));
	}

	async function remove() {
		const down = ix.downstream(feeder!);
		const ids = new Set(down.breakers.map((b) => b.id));
		const orphans = down.items.filter((i) => i.breakerIds.every((b) => ids.has(b))).length;
		const what = ` Its ${plural(inside.length, 'breaker')} will be removed${orphans ? ` and ${plural(orphans, 'item')} will have no breaker` : ''}.`;
		if (!confirm(`Delete ${panel.name}?${what}`)) return;
		await mutate(() => deletePanel(id));
	}
	const f = (k: string) => `p${panel.id}-${k}`;
</script>

<div class="card pcard" class:sub style:margin-left="{depth * 34}px">
	{#if sub && !open}
		<div class="srow">
			<span class="br"><Icon name="branch" size={16} /></span>
			<span class="st">
				<span class="pname">{panel.name}<span class="mono code">&nbsp;· {panel.shortCode}</span></span>
				<span class="mono sm"
					>{panel.mainAmps ?? feeder?.amps}A · fed by {panelShort(ix.panelOf(feeder!))} {ix.slotOf(feeder!)} · {panel.slotCount} spaces</span
				>
			</span>
			<button type="button" class="btn" onclick={() => (open = true)} aria-label="Edit {panel.name}">Edit</button>
		</div>
	{:else}
		<div class="pname">
			{#if sub}<span class="br"><Icon name="branch" size={16} /></span>{/if}
			<span>{panel.name}</span>
			{#if !sub}<span class="tag">MAIN</span>{/if}
		</div>
		{#if sub}
			<div class="pgrid">
				<div class="fld span2">
					<label for={f('name')}>Name</label>
					<input id={f('name')} class="inp" type="text" value={panel.name} onchange={saveName} />
				</div>
				<div class="fld">
					<label for={f('code')}>Short code</label>
					<input
						id={f('code')}
						class="inp"
						type="text"
						maxlength="3"
						value={panel.shortCode ?? ''}
						onchange={saveCode}
						aria-invalid={!!codeWhy}
						aria-describedby={codeWhy ? f('code-e') : undefined}
					/>
				</div>
			</div>
			{#if codeWhy}<span class="err" id={f('code-e')} role="alert">{codeWhy}</span>{/if}
		{/if}
		<div class="pgrid">
			<div class="fld">
				<label for={f('amp')}>Main breaker</label>
				<select
					id={f('amp')}
					class="inp"
					value={panel.mainAmps ?? ''}
					onchange={(e) => {
						const v = e.currentTarget.value;
						mutate(() => updatePanel(id, { mainAmps: v ? Number(v) : null }));
					}}
				>
					{#if sub}<option value="">None (main lugs)</option>{:else if panel.mainAmps === null}<option value="">Not set</option>{/if}
					{#if panel.mainAmps !== null && !ampsChoices.includes(panel.mainAmps)}
						<option value={panel.mainAmps}>{panel.mainAmps} A</option>
					{/if}
					{#each ampsChoices as a (a)}<option value={a}>{a} A</option>{/each}
				</select>
			</div>
			<div class="fld">
				<label for={f('sp')}>Spaces</label>
				<select id={f('sp')} class="inp" value={shape.slotCount} onchange={(e) => tryShape({ slotCount: Number(e.currentTarget.value) })}>
					{#if !spaceChoices.includes(panel.slotCount)}<option value={panel.slotCount}>{panel.slotCount}</option>{/if}
					{#each spaceChoices as n (n)}<option value={n}>{n}</option>{/each}
				</select>
			</div>
			<div class="fld">
				<label for={f('num')}>Slot numbering</label>
				<select
					id={f('num')}
					class="inp"
					value={shape.numbering}
					onchange={(e) => tryShape({ numbering: e.currentTarget.value as Numbering })}
				>
					<option value="odd_left_even_right">Odd left, even right</option>
					<option value="down_left_then_right">Down the left, then the right</option>
				</select>
			</div>
		</div>
		<div class="fld">
			<label for={f('loc')}>Location</label>
			<input
				id={f('loc')}
				class="inp"
				type="text"
				placeholder="Where the panel is, e.g. basement utility room"
				value={panel.location ?? ''}
				onchange={saveText('location')}
			/>
		</div>
		<div class="fld">
			<label for={f('tdm')}>Tandem slots</label>
			<input
				id={f('tdm')}
				class="inp"
				type="text"
				placeholder="e.g. 17–28"
				value={panel.tandemSlots ?? ''}
				onchange={saveText('tandemSlots')}
				aria-describedby={f('tdm-d')}
			/>
			<span class="sd" id={f('tdm-d')}>Printed on the panel label, e.g. “Class CTL — tandems in spaces 17–28”. Leave blank if you’re not sure.</span>
		</div>
		{#if problem}
			<div class="shrink" role="status">
				<strong>Some breakers won’t fit.</strong>
				{problem} This change isn’t saved until they fit.
			</div>
		{/if}
		{#if sub}
			<div class="acts">
				<button type="button" class="btn btn-warn" onclick={remove}>Delete subpanel</button>
				<button type="button" class="btn" onclick={() => (open = false)}>Done</button>
			</div>
		{/if}
	{/if}
</div>

<style>
	.card {
		background: var(--surface);
		border: 1px solid var(--line-2);
		border-radius: var(--r-2xl);
		padding: 0 24px;
	}
	.pcard {
		padding-top: 20px;
		padding-bottom: 20px;
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.pcard.sub {
		padding-top: 14px;
		padding-bottom: 14px;
		border-radius: var(--r-xl);
	}
	.srow {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.st {
		flex-grow: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.br {
		display: flex;
		color: var(--muted);
	}
	.pname {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 17px;
		font-weight: 700;
	}
	.srow .pname {
		gap: 0;
	}
	.code {
		font-size: 13px;
		font-weight: 400;
		color: var(--muted);
	}
	.sm {
		font-size: 12px;
		color: var(--muted);
	}
	.pgrid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 14px;
	}
	.span2 {
		grid-column: span 2;
	}
	.sd {
		font-size: 13px;
		color: var(--muted);
		line-height: 1.45;
	}
	.err {
		font-size: 13px;
		color: var(--warn);
	}
	.shrink {
		background: var(--amber-soft);
		border: 1px solid var(--amber);
		border-radius: var(--r-lg);
		padding: 12px 14px;
		font-size: 13px;
		line-height: 1.45;
	}
	.shrink strong {
		color: var(--amber-ink);
	}
	.acts {
		display: flex;
		justify-content: space-between;
		gap: 10px;
	}
</style>
