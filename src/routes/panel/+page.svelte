<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Icon from '$lib/components/Icon.svelte';
	import { AMPS, ITEM_TYPES, ITEM_TYPE_LABELS, MIN_WIRE, PROTECTIONS, PROTECTION_LABELS, PROTECTION_TAGS } from '$lib/constants';
	import type { Protection } from '$lib/constants';
	import type { Breaker } from '$lib/db/schema';
	import { createItem, updateBreaker } from '$lib/db/ops';
	import { index, mutate, plural } from '$lib/house';
	import { legOfRow, occupiedSlots, rowCount, slotAt, slotLabel, slotText, spacesUsed } from '$lib/panel';
	import { query, search } from '$lib/search.svelte';

	let { data } = $props();

	const house = $derived(data.house);
	const ix = $derived(index(house));
	const panel = $derived(house.panel);
	const breakers = $derived(panel ? house.breakers.filter((b) => b.panelId === panel.id) : []);

	// ---- Unsaved edits, per breaker. The breaker face shows them live.
	type Draft = { label: string; amps: number; kind: Protection; notes: string };
	let drafts = $state<Record<number, Draft>>({});
	let savedJustNow = $state(false);

	const view = (b: Breaker): Breaker => {
		const d = drafts[b.id];
		return d ? { ...b, label: d.label, amps: d.amps, kind: d.kind, notes: d.notes } : b;
	};
	const isChanged = (b: Breaker, d: Draft) =>
		d.label.trim() !== b.label || d.amps !== b.amps || d.kind !== b.kind || (d.notes.trim() || null) !== (b.notes ?? null);
	const dirty = $derived(breakers.some((b) => drafts[b.id] && isChanged(b, drafts[b.id])));

	function edit(b: Breaker, patch: Partial<Draft>) {
		const current = drafts[b.id] ?? { label: b.label, amps: b.amps, kind: b.kind, notes: b.notes ?? '' };
		drafts[b.id] = { ...current, ...patch };
		savedJustNow = false;
	}

	async function save() {
		const changed = breakers.filter((b) => drafts[b.id] && isChanged(b, drafts[b.id]));
		await mutate(async () => {
			for (const b of changed) {
				const d = drafts[b.id];
				await updateBreaker(b.id, { label: d.label.trim(), amps: d.amps, kind: d.kind, notes: d.notes.trim() || null });
			}
		});
		drafts = {};
		savedJustNow = true;
	}

	// ---- Selection lives in the URL (?b=<id>).
	const selId = $derived(Number(page.url.searchParams.get('b')) || breakers[0]?.id);
	const selRaw = $derived(breakers.find((b) => b.id === selId) ?? breakers[0]);
	const sel = $derived(selRaw ? view(selRaw) : undefined);

	function pick(id: number) {
		const url = new URL(page.url);
		url.searchParams.set('b', String(id));
		goto(url, { replaceState: true, keepFocus: true, noScroll: true });
	}
	function step(by: number) {
		if (!sel) return;
		const i = breakers.findIndex((b) => b.id === sel.id);
		pick(breakers[(i + by + breakers.length) % breakers.length].id);
	}

	// ---- Header search: label, slot number, or any item name/room on the breaker.
	const q = $derived(query());
	const matches = (b: Breaker) => {
		if (!q) return true;
		const v = view(b);
		if ((v.label || 'unlabeled').toLowerCase().includes(q) || String(b.slot) === q) return true;
		return ix.itemsOf(b.id).some((i) => `${i.name} ${ix.roomName(i.roomId)}`.toLowerCase().includes(q));
	};
	const matchCount = $derived(breakers.filter(matches).length);

	// ---- The panel face: each column top to bottom; a 2-pole breaker fills two rows.
	type Cell = { slot: number; breaker: Breaker | null };
	const cover = $derived.by(() => {
		const m = new Map<number, Breaker>();
		if (panel) for (const b of breakers) for (const s of occupiedSlots(b, panel)) m.set(s, b);
		return m;
	});
	const rows = $derived(panel ? rowCount(panel) : 0);
	function column(side: 'left' | 'right'): Cell[] {
		if (!panel) return [];
		const out: Cell[] = [];
		for (let row = 1; row <= rows; row++) {
			const slot = slotAt(side, row, panel);
			if (slot > panel.slotCount) continue;
			const b = cover.get(slot);
			if (b && b.slot !== slot) continue;
			out.push({ slot, breaker: b ?? null });
		}
		return out;
	}
	const left = $derived(column('left'));
	const right = $derived(column('right'));

	// ---- What the selected breaker powers.
	const selItems = $derived(sel ? ix.itemsOf(sel.id) : []);
	const summary = $derived.by(() => {
		if (!selItems.length) return 'No items yet';
		const floors = house.floors.filter((f) => selItems.some((i) => i.floorId === f.id)).map((f) => f.name);
		return [plural(selItems.length, 'item'), floors.join(', ')].filter(Boolean).join(' · ');
	});
	const groups = $derived(
		ITEM_TYPES.map((type) => ({ type, name: ITEM_TYPE_LABELS[type].many, items: selItems.filter((i) => i.type === type) })).filter(
			(g) => g.items.length
		)
	);

	async function addItem() {
		if (!sel) return;
		const id = await mutate(() => createItem({ name: 'New item', floorId: house.floors[0]?.id ?? null }, [sel.id]));
		goto(resolve('/items') + `?item=${id}`);
	}
</script>

{#if !panel || !sel}
	<main class="empty-app">
		<h1>No panel yet</h1>
		<p>Setting up a panel from scratch isn't designed yet. Load the example house from Settings to look around.</p>
		<a class="btn" href={resolve('/settings') + '#data'}>Open Settings</a>
	</main>
{:else}
	<main>
		<section class="panel" aria-label="Breaker panel">
			<div class="top">
				<div class="title">
					<h1>{panel.name}</h1>
					<span class="mono meta">
						{panel.mainAmps ? `${panel.mainAmps}A main · ` : ''}{spacesUsed(breakers)} of {panel.slotCount} spaces used
					</span>
				</div>
				<div class="legend">
					<span><span class="tag">GF</span>GFCI</span>
					<span><span class="tag">AF</span>AFCI</span>
					<span><span class="tag">DF</span>Dual function</span>
					<a class="btn trace" href={resolve('/trace')}><Icon name="bolt" size={14} />Trace</a>
				</div>
			</div>

			{#if q}
				<div class="results inv" role="status">
					<span>{matchCount} of {breakers.length} breakers match “{search.q.trim()}”</span>
					<button type="button" class="chipbtn" onclick={() => (search.q = '')}>Clear</button>
				</div>
			{/if}

			<div class="enclosure">
				<div class="main-bk">
					<div class="main-hdl"><span></span><span></span></div>
					<div class="main-txt">
						<span class="mono">MAIN</span>
						<strong>{panel.mainAmps ? `${panel.mainAmps}A` : '—'}</strong>
					</div>
				</div>

				<div class="cols">
					{#snippet col(cells: Cell[], side: 'l' | 'r')}
						<div class="col">
							{#each cells as cell (cell.slot)}
								{#if !cell.breaker}
									<div class="bk bk-1 bk-empty" class:bk-r={side === 'r'}>
										<span class="num">{cell.slot}</span><span class="lbl">Open</span>
									</div>
								{:else}
									{@const b = view(cell.breaker)}
									{@const tag = PROTECTION_TAGS[b.kind]}
									<button
										type="button"
										class="bk bk-{b.poles === 2 ? 2 : 1}"
										class:bk-r={side === 'r'}
										class:is-sel={b.id === sel.id}
										class:is-dim={!matches(cell.breaker)}
										class:is-unl={!b.label.trim()}
										aria-pressed={b.id === sel.id}
										aria-label="Breaker {slotLabel(b, panel)}, {b.label.trim() || 'unlabeled'}, {b.amps} amp"
										onclick={() => pick(b.id)}
									>
										<span class="num">{slotLabel(b, panel)}</span>
										<span class="lbl">{b.label.trim() || 'Unlabeled'}</span>
										{#if tag}<span class="tag">{tag}</span>{/if}
										<span class="amp">{b.amps}</span>
										<span class="hdl"><span class="tog"></span><span class="tog tog2"></span></span>
									</button>
								{/if}
							{/each}
						</div>
					{/snippet}
					{@render col(left, 'l')}
					{#if house.settings.showLegs}
						<div class="legs" aria-hidden="true">
							{#each { length: rows }, r (r)}
								<div class="mono">{legOfRow(r + 1)}</div>
							{/each}
						</div>
					{:else}
						<div class="legs off" aria-hidden="true"></div>
					{/if}
					{@render col(right, 'r')}
				</div>
			</div>
		</section>

		<section class="detail" aria-label="Breaker details">
			<div class="dhead">
				<div class="row">
					<span class="mono slot">{slotText(sel, panel)}</span>
					<div class="nav">
						<button type="button" class="ibtn" aria-label="Previous breaker" onclick={() => step(-1)}><Icon name="prev" /></button>
						<button type="button" class="ibtn" aria-label="Next breaker" onclick={() => step(1)}><Icon name="next" /></button>
					</div>
				</div>
				<label for="f-label" class="sr">Breaker label</label>
				<input
					id="f-label"
					class="ttl"
					type="text"
					value={sel.label}
					oninput={(e) => edit(selRaw!, { label: e.currentTarget.value })}
					placeholder="Unlabeled — what does it power?"
				/>
				<div class="grid4">
					<div class="fld">
						<label for="f-amp">Amperage</label>
						<select
							id="f-amp"
							class="inp"
							value={sel.amps}
							onchange={(e) => edit(selRaw!, { amps: Number(e.currentTarget.value) })}
						>
							{#each AMPS.includes(sel.amps) ? AMPS : [...AMPS, sel.amps].sort((a, b) => a - b) as a (a)}
								<option value={a}>{a} A</option>
							{/each}
						</select>
					</div>
					<div class="fld">
						<label for="f-type">Protection</label>
						<select
							id="f-type"
							class="inp"
							value={sel.kind}
							onchange={(e) => edit(selRaw!, { kind: e.currentTarget.value as Protection })}
						>
							{#each PROTECTIONS as p (p)}
								<option value={p}>{PROTECTION_LABELS[p]}</option>
							{/each}
						</select>
					</div>
					<div class="fld">
						<span class="k">Poles</span>
						<span class="v">{sel.poles === 2 ? '2-pole · 240V' : '1-pole · 120V'}</span>
					</div>
					<div class="fld">
						<span class="k">Min. wire (copper)</span>
						<span class="v">{MIN_WIRE[sel.amps] ?? '—'}</span>
					</div>
				</div>
			</div>

			<div class="dbody">
				<div class="powers">
					<div class="ph">
						<h2>Powers</h2>
						<span>{summary}</span>
					</div>
					<button type="button" class="btn" onclick={addItem}><Icon name="plus" size={16} stroke={2.2} />Add item</button>
				</div>

				{#each groups as g (g.type)}
					<div class="group">
						<div class="gname">{g.name} · {g.items.length}</div>
						<div class="grid2">
							{#each g.items as i (i.id)}
								<div class="irow">
									<span class="ico"><Icon name={i.type} stroke={1.9} /></span>
									<span class="itxt"><span class="in">{i.name}</span><span class="iw">{ix.whereOf(i)}</span></span>
									{#if i.x !== null}
										<a class="loc" href={resolve('/map') + `?item=${i.id}`}>Locate</a>
									{:else}
										<a class="loc" href={resolve('/items') + `?item=${i.id}`}>Place</a>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				{:else}
					<div class="none">
						<span class="nt">Nothing mapped to this breaker yet</span>
						<span class="nd">Flip it off, walk the house, and add whatever went dark. Anything you add here shows up on the map too.</span>
						<div class="nb">
							<button type="button" class="btn btn-pri" onclick={addItem}>Add the first item</button>
							<a class="btn" href={resolve('/trace') + `?b=${sel.id}`}>Trace it</a>
						</div>
					</div>
				{/each}

				<div class="fld">
					<label for="f-notes">Notes</label>
					<textarea
						id="f-notes"
						class="inp"
						rows="3"
						placeholder="Anything worth knowing when this one trips"
						value={sel.notes ?? ''}
						oninput={(e) => edit(selRaw!, { notes: e.currentTarget.value })}
					></textarea>
				</div>
			</div>

			<div class="dfoot">
				<span class="status" role="status">
					<span class="dot" class:is-dirty={dirty}></span>
					{dirty ? 'Unsaved changes' : savedJustNow ? 'Saved just now' : 'All changes saved'}
				</span>
				<div class="acts">
					<a class="btn" href={resolve('/map') + `?circuit=${sel.id}`}><Icon name="map" size={16} />Show on map</a>
					<button type="button" class="btn btn-pri" onclick={save} disabled={!dirty}>Save changes</button>
				</div>
			</div>
		</section>
	</main>
{/if}

<style>
	main {
		flex: 1 1 0;
		min-height: 0;
		display: flex;
		gap: 32px;
		padding: 28px 32px;
	}
	.empty-app {
		flex-direction: column;
		align-items: flex-start;
		gap: 12px;
	}
	.empty-app h1 {
		font-size: 28px;
		font-weight: 800;
		font-stretch: 112%;
	}
	.empty-app p {
		color: var(--muted);
		font-size: 14px;
	}

	/* ---- Left: the panel */
	.panel {
		width: 640px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 14px;
		min-height: 0;
		overflow: auto;
		/* Room for the selected breaker's ring and focus outlines. */
		padding: 3px;
		margin: -3px;
	}
	.top {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 16px;
	}
	.title {
		display: flex;
		flex-direction: column;
		gap: 4px;
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
	.legend {
		display: flex;
		gap: 14px;
		align-items: center;
		font-size: 12px;
		color: var(--soft);
	}
	.legend > span {
		display: flex;
		gap: 6px;
		align-items: center;
	}
	.trace {
		height: 36px;
		padding: 0 12px;
		font-size: 13px;
	}
	.results {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 6px 6px 6px 14px;
		border-radius: var(--r-lg);
		font-size: 13px;
	}
	.results .chipbtn {
		height: 32px;
	}
	.enclosure {
		background: var(--enclosure);
		border: 1px solid var(--enclosure-bd);
		border-radius: var(--r-2xl);
		padding: 18px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		box-shadow: inset 0 1px 0 var(--enclosure-hi);
	}
	.main-bk {
		align-self: center;
		display: flex;
		align-items: center;
		gap: 14px;
		background: var(--raised);
		border: 1px solid var(--enclosure-bd);
		border-radius: var(--r-md);
		padding: 8px 18px 8px 8px;
	}
	.main-hdl {
		width: 64px;
		height: 44px;
		background: var(--handle);
		border-radius: var(--r-sm);
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
	}
	.main-hdl span {
		width: 18px;
		height: 26px;
		background: var(--toggle);
		border-radius: 2px;
	}
	.main-txt {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.main-txt .mono {
		font-size: 11px;
		color: var(--muted);
		letter-spacing: 0.08em;
	}
	.main-txt strong {
		font-size: 20px;
		font-weight: 800;
		font-stretch: 112%;
	}
	.cols {
		display: flex;
		gap: 8px;
	}
	.col {
		flex: 1 1 0;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--breaker-gap);
	}
	.legs {
		width: 28px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: var(--breaker-gap);
		background: var(--bus);
		border-radius: var(--r-sm);
	}
	.legs div {
		height: var(--breaker-h);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 9px;
		font-weight: 600;
		color: var(--bus-ink);
	}

	/* ---- Breaker */
	.bk {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 0 6px 0 8px;
		border: 1px solid var(--breaker-bd);
		border-radius: var(--r-sm);
		background: var(--raised);
		font: inherit;
		color: var(--ink);
		cursor: pointer;
		text-align: left;
		transition:
			opacity 0.2s,
			background 0.15s;
	}
	.bk-1 {
		height: var(--breaker-h);
	}
	.bk-2 {
		height: calc(var(--breaker-h) * 2 + var(--breaker-gap));
	}
	.bk-r {
		flex-direction: row-reverse;
		padding: 0 8px 0 6px;
		text-align: right;
	}
	.num {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--muted);
		width: 34px;
		flex-shrink: 0;
	}
	.bk-r .num {
		text-align: right;
	}
	.lbl {
		flex: 1 1 auto;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-stretch: 80%;
		font-size: 14px;
		font-weight: 500;
	}
	.amp {
		font-family: var(--font-mono);
		font-size: 12px;
		font-weight: 600;
		width: 22px;
		text-align: center;
		flex-shrink: 0;
	}
	.hdl {
		width: 30px;
		height: 22px;
		background: var(--handle);
		border-radius: var(--r-xs);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: space-around;
		flex-shrink: 0;
		position: relative;
	}
	.bk-2 .hdl {
		height: 54px;
	}
	.bk-2 .hdl::after {
		content: '';
		position: absolute;
		left: 4px;
		right: 4px;
		top: 50%;
		height: 3px;
		margin-top: -1.5px;
		background: var(--tie);
		border-radius: 1px;
	}
	.tog {
		width: 14px;
		height: 8px;
		background: var(--toggle);
		border-radius: 2px;
	}
	.bk-1 .tog2 {
		display: none;
	}
	.bk:hover {
		border-color: var(--btn-bd-h);
	}
	.bk.is-sel {
		background: var(--amber);
		border-color: var(--on-amber);
		box-shadow: 0 0 0 2px var(--fed-bd);
	}
	.bk.is-sel,
	.bk.is-sel .num,
	.bk.is-sel .lbl {
		color: var(--on-amber);
	}
	.bk.is-dim {
		opacity: 0.3;
	}
	.bk.is-unl .lbl {
		color: var(--warn);
		font-style: italic;
	}
	.bk.is-sel.is-unl .lbl {
		color: var(--on-amber);
	}
	.bk-empty,
	.bk-empty:hover {
		border: 1px dashed var(--enclosure-bd);
		background: transparent;
		cursor: default;
	}
	.bk-empty .lbl {
		color: var(--muted);
		font-style: italic;
	}

	/* ---- Right: breaker detail */
	.detail {
		flex: 1 1 0;
		min-width: 0;
		background: var(--surface);
		border: 1px solid var(--line-2);
		border-radius: var(--r-2xl);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.dhead {
		padding: 22px 28px;
		border-bottom: 1px solid var(--line);
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.dhead .row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.slot {
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.06em;
		color: var(--muted);
		text-transform: uppercase;
	}
	.nav {
		display: flex;
		gap: 6px;
	}
	.ttl {
		width: 100%;
		border: 0;
		border-bottom: 2px solid transparent;
		padding: 2px 0 6px;
		background: transparent;
		font-family: inherit;
		font-size: 32px;
		font-weight: 800;
		font-stretch: 108%;
		letter-spacing: -0.02em;
		color: var(--ink);
	}
	.ttl:hover {
		border-bottom-color: var(--line-2);
	}
	.ttl:focus {
		outline: none;
		border-bottom-color: var(--amber);
	}
	.ttl::placeholder {
		color: var(--warn);
		font-style: italic;
		font-weight: 600;
	}
	.grid4 {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 12px;
	}
	.dbody {
		flex-grow: 1;
		min-height: 0;
		overflow: auto;
		padding: 22px 28px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
	.powers {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.ph {
		display: flex;
		align-items: baseline;
		gap: 10px;
	}
	.ph h2 {
		font-size: 20px;
		font-weight: 800;
		font-stretch: 108%;
	}
	.ph span {
		font-size: 13px;
		color: var(--muted);
	}
	.group {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.gname {
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.grid2 {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px;
	}
	.irow {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 12px;
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		background: var(--surface);
		min-width: 0;
	}
	.irow .ico {
		width: 34px;
		height: 34px;
	}
	.itxt {
		flex-grow: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.loc {
		font-size: 13px;
		font-weight: 600;
		flex-shrink: 0;
		padding: 6px 2px;
	}
	.none {
		border: 1.5px dashed var(--dash);
		border-radius: var(--r-xl);
		padding: 28px;
		display: flex;
		flex-direction: column;
		gap: 10px;
		align-items: flex-start;
	}
	.nt {
		font-size: 17px;
		font-weight: 700;
	}
	.nd {
		font-size: 14px;
		color: var(--muted);
		max-width: 460px;
		line-height: 1.5;
	}
	.nb {
		display: flex;
		gap: 8px;
	}
	.dfoot {
		padding: 14px 28px;
		border-top: 1px solid var(--line);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.status {
		font-size: 13px;
		color: var(--muted);
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--ok);
	}
	.dot.is-dirty {
		background: var(--dirty);
	}
	.acts {
		display: flex;
		gap: 8px;
	}
	.acts .btn:disabled {
		opacity: 1;
	}
</style>
