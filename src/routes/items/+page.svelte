<script lang="ts">
	// Items: inventory table with an editor drawer (DESIGN.md §5.3, mockups/Items.dc.html).
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { SvelteSet } from 'svelte/reactivity';
	import Icon from '$lib/components/Icon.svelte';
	import ItemDrawer from '$lib/components/items/ItemDrawer.svelte';
	import { ITEM_TYPES, ITEM_TYPE_LABELS, type ItemType } from '$lib/constants';
	import { index, mutate, type HouseItem } from '$lib/house';
	import { createItem, moveItemsToBreaker } from '$lib/db/ops';
	import { query, search } from '$lib/search.svelte';
	import { importItemsCsv } from '$lib/csv';

	let { data } = $props();
	const house = $derived(data.house);
	const ix = $derived(index(house));

	// ---- Filters and sorting
	type TypeFilter = 'all' | ItemType;
	type SortKey = 'name' | 'room' | 'floor' | 'breaker';
	let type = $state<TypeFilter>('all');
	let floorF = $state<'all' | number>('all');
	let brkF = $state<'all' | 'none' | number>('all');
	let attn = $state(false);
	let sk = $state<SortKey>('room');
	let sd = $state<1 | -1>(1);
	const checked = new SvelteSet<number>();

	const filtered = $derived(type !== 'all' || floorF !== 'all' || brkF !== 'all' || attn || query() !== '');
	function clearFilters() {
		type = 'all';
		floorF = 'all';
		brkF = 'all';
		attn = false;
		search.q = '';
	}

	const floorLevel = $derived(new Map(house.floors.map((f, i) => [f.id, i])));
	const attnCount = $derived(house.items.filter(ix.needsAttention).length);

	function haystack(i: HouseItem) {
		const bs = ix.breakersOf(i);
		const b = bs.length ? bs.map((b) => `${ix.labelOf(b)} ${ix.slotOf(b)}`).join(' ') : 'no breaker';
		return `${i.name} ${ix.roomName(i.roomId)} ${ix.floorName(i.floorId)} ${b}`.toLowerCase();
	}

	// Everything but the type filter, so the type segments can show live counts.
	const base = $derived.by(() => {
		const q = query();
		return house.items.filter((i) => {
			if (floorF !== 'all' && i.floorId !== floorF) return false;
			if (brkF === 'none' && i.breakerIds.length) return false;
			if (typeof brkF === 'number' && !i.breakerIds.includes(brkF)) return false;
			if (attn && !ix.needsAttention(i)) return false;
			if (q && !haystack(i).includes(q)) return false;
			return true;
		});
	});
	const types = $derived(
		(['all', 'outlet', 'light', 'switch', 'appliance'] as const).map((k) => ({
			key: k,
			label: k === 'all' ? 'All' : ITEM_TYPE_LABELS[k].many,
			count: k === 'all' ? base.length : base.filter((i) => i.type === k).length
		}))
	);

	const rows = $derived.by(() => {
		const list = base.filter((i) => type === 'all' || i.type === type);
		const lvl = (i: HouseItem) => (i.floorId === null ? 1e6 : (floorLevel.get(i.floorId) ?? 1e6));
		const cmp = (a: HouseItem, b: HouseItem): number => {
			if (sk === 'name') return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) * sd;
			if (sk === 'floor') return (lvl(a) - lvl(b)) * sd;
			if (sk === 'room') {
				return (
					(lvl(a) - lvl(b) ||
						ix.roomName(a.roomId).localeCompare(ix.roomName(b.roomId), undefined, { sensitivity: 'base' })) * sd
				);
			}
			// Breaker: by first breaker in panel order; unassigned always last.
			const ba = ix.breakersOf(a)[0];
			const bb = ix.breakersOf(b)[0];
			if (!ba || !bb) return (ba ? 0 : 1) - (bb ? 0 : 1);
			return (ba.panelId - bb.panelId || ba.slot - bb.slot) * sd;
		};
		return list.sort((a, b) => cmp(a, b) || a.name.localeCompare(b.name));
	});

	function sortBy(k: SortKey) {
		if (sk === k) sd = sd === 1 ? -1 : 1;
		else {
			sk = k;
			sd = 1;
		}
	}
	const arrow = (k: SortKey) => (sk === k ? (sd === 1 ? '↑' : '↓') : '');
	const ariaSort = (k: SortKey) => (sk === k ? (sd === 1 ? 'ascending' : 'descending') : 'none');

	// ---- Breaker option lists
	const brkFilterOpts = $derived(house.breakers.map((b) => ({ value: b.id, label: `${ix.slotOf(b)} · ${ix.labelOf(b)}` })));
	const brkOpts = $derived(
		house.breakers.map((b) => ({ value: b.id, label: `${ix.slotOf(b)} — ${ix.labelOf(b)} (${b.amps}A)` }))
	);

	// ---- Selection (only rows currently shown count)
	const selected = $derived(rows.filter((r) => checked.has(r.id)).map((r) => r.id));
	const allChecked = $derived(rows.length > 0 && rows.every((r) => checked.has(r.id)));
	function toggleAll() {
		if (allChecked) checked.clear();
		else for (const r of rows) checked.add(r.id);
	}
	function toggle(id: number) {
		if (checked.has(id)) checked.delete(id);
		else checked.add(id);
	}
	async function bulkMove(e: Event) {
		const sel = e.currentTarget as HTMLSelectElement;
		const v = sel.value;
		if (!v) return;
		const ids = selected;
		sel.value = '';
		await mutate(() => moveItemsToBreaker(ids, v === 'none' ? null : Number(v)));
		checked.clear();
	}

	// ---- Drawer, kept in the URL (?item=<id>)
	const openId = $derived(Number(page.url.searchParams.get('item')) || null);
	const openItem = $derived(openId === null ? null : (house.items.find((i) => i.id === openId) ?? null));
	const itemsHref = resolve('/items');
	const open = (id: number) => goto(`${itemsHref}?item=${id}`, { replaceState: true, keepFocus: true, noScroll: true });
	const close = () => goto(itemsHref, { replaceState: true, keepFocus: true, noScroll: true });

	async function addItem() {
		const floorId =
			floorF !== 'all' ? floorF : (house.floors.find((f) => /main/i.test(f.name)) ?? house.floors[0])?.id ?? null;
		const id = await mutate(() => createItem({ name: '', type: 'outlet', floorId, roomId: null }));
		// Make sure the new item shows in the table.
		type = 'all';
		attn = false;
		search.q = '';
		if (typeof brkF === 'number') brkF = 'all';
		await open(id);
	}

	// ---- CSV export of the rows currently shown (filtered and sorted as on screen)
	function exportCsv() {
		const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
		const head = ['name', 'type', 'floor', 'room', 'breakers', 'breaker labels', 'on map', 'critical', 'notes'];
		const lines = rows.map((i) => {
			const bs = ix.breakersOf(i);
			return [
				i.name,
				ITEM_TYPE_LABELS[i.type].one,
				ix.floorName(i.floorId),
				i.roomId === null ? '' : ix.roomName(i.roomId),
				bs.map((b) => ix.slotOf(b)).join(' + '),
				bs.map((b) => ix.labelOf(b)).join(' + '),
				i.x !== null && i.y !== null ? 'yes' : 'no',
				i.critical ? 'yes' : 'no',
				i.notes ?? ''
			]
				.map(cell)
				.join(',');
		});
		const csv = [head.join(','), ...lines].join('\r\n') + '\r\n';
		const d = new Date();
		const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
		const home = (house.settings.homeName || 'home').replace(/[\\/:*?"<>|]/g, '-');
		const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
		const a = document.createElement('a');
		a.href = url;
		a.download = `${home}-items-${date}.csv`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	// ---- CSV import (empty state only; DESIGN.md §5.9)
	let csvInput: HTMLInputElement | undefined = $state();
	let importing = $state(false);
	let toast = $state<{ text: string; warn: boolean } | null>(null);
	let toastTimer: ReturnType<typeof setTimeout> | undefined;
	function say(text: string, warn = false) {
		toast = { text, warn };
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = null), 8000);
	}
	async function importCsv(file: File | undefined) {
		if (!file) return;
		importing = true;
		try {
			const text = await file.text();
			const r = await mutate(() => importItemsCsv(house, text));
			say(`Imported ${r.imported} ${r.imported === 1 ? 'item' : 'items'} (${r.skipped} skipped)`);
		} catch (e) {
			say(e instanceof Error && e.message.startsWith('The first row') ? e.message : "Couldn't read that CSV file.", true);
		} finally {
			importing = false;
			if (csvInput) csvInput.value = '';
		}
	}

	const mapHref = (id: number) => resolve('/map') + '?item=' + id;
	const onSelect = (e: Event) => (e.currentTarget as HTMLSelectElement).value;
</script>

<main class="page">
	<section aria-label="All items" class="list">
		<div class="top">
			<div class="ttl">
				<h1>Items</h1>
				<span class="mono sub"
					>{house.items.length} {house.items.length === 1 ? 'item' : 'items'}{house.items.length
						? ` · ${attnCount} ${attnCount === 1 ? 'needs' : 'need'} attention`
						: ''}</span>
			</div>
			<div class="acts">
				<button
					type="button"
					class="btn"
					onclick={exportCsv}
					disabled={house.items.length === 0}
					title="Downloads the items shown in the table">Export CSV</button>
				<button type="button" class="btn btn-pri" onclick={addItem}
					>{#if house.items.length}<Icon name="plus" size={16} stroke={2.2} />{/if}Add item</button>
			</div>
		</div>

		{#if house.items.length === 0}
			<div class="card none">
				<div class="nwrap">
					<div class="tiles" aria-hidden="true">
						{#each ITEM_TYPES as t (t)}<span class="tile"><Icon name={t} size={22} /></span>{/each}
					</div>
					<div class="ntxt">
						<h2>No items yet</h2>
						<p>
							Items are what your breakers feed: outlets, lights, switches and appliances. The quickest way to add them is to trace a
							breaker — flip it off and tap what went dark.
						</p>
					</div>
					<div class="nacts">
						<a class="btn btn-pri" href={resolve('/trace')}>Trace a breaker</a>
						<button type="button" class="btn" onclick={addItem}>Add item</button>
						<button type="button" class="btn" disabled={importing} onclick={() => csvInput?.click()}>Import CSV…</button>
						<input
							bind:this={csvInput}
							class="sr"
							type="file"
							accept=".csv,text/csv"
							tabindex="-1"
							aria-hidden="true"
							onchange={(e) => importCsv(e.currentTarget.files?.[0])}
						/>
					</div>
					<span class="mono hint">CSV columns: name, type, floor, room, breaker</span>
				</div>
			</div>
		{:else}
			<div class="filters">
				<div class="seg" role="group" aria-label="Item type">
					{#each types as t (t.key)}
						<button
							type="button"
							class="sb"
							class:is-on={type === t.key}
							aria-pressed={type === t.key}
							onclick={() => (type = t.key)}>{t.label}<span class="ct">{t.count}</span></button>
					{/each}
				</div>
				<label for="ff" class="sr">Floor</label>
				<select
					id="ff"
					class="inp fsel"
					value={floorF}
					onchange={(e) => {
						const v = onSelect(e);
						floorF = v === 'all' ? 'all' : Number(v);
					}}>
					<option value="all">All floors</option>
					{#each house.floors as f (f.id)}<option value={f.id}>{f.name}</option>{/each}
				</select>
				<label for="fb" class="sr">Breaker</label>
				<select
					id="fb"
					class="inp fsel fbrk"
					value={brkF}
					onchange={(e) => {
						const v = onSelect(e);
						brkF = v === 'all' || v === 'none' ? v : Number(v);
					}}>
					<option value="all">All breakers</option>
					<option value="none">No breaker</option>
					{#each brkFilterOpts as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
				</select>
				<button type="button" class="chip" class:is-on={attn} aria-pressed={attn} onclick={() => (attn = !attn)}
					><Icon name="warning" size={16} />Needs attention · {attnCount}</button>
				{#if filtered}
					<button type="button" class="btn clear" onclick={clearFilters}>Clear filters</button>
				{/if}
			</div>

			<div class="card">
				<div class="tbl" role="table" aria-label="Items" aria-rowcount={rows.length + 1}>
					<div class="trow thead" role="row">
						<span role="columnheader" class="cb"
							><input type="checkbox" checked={allChecked} onchange={toggleAll} aria-label="Select all shown items" /></span>
						<span role="columnheader"><span class="sr">Type</span></span>
						{#each [['name', 'Name'], ['room', 'Room'], ['floor', 'Floor'], ['breaker', 'Breaker']] as const as [k, label] (k)}
							<span role="columnheader" aria-sort={ariaSort(k)}
								><button type="button" class="th" onclick={() => sortBy(k)}
									>{label}<span aria-hidden="true">{arrow(k)}</span></button></span>
						{/each}
						<span role="columnheader">On map</span>
					</div>
					<div class="tbody" role="rowgroup">
						{#each rows as i (i.id)}
							{@const bs = ix.breakersOf(i)}
							{@const tag = bs[0] ? ix.tagOf(bs[0]) : ''}
							<div class="trow" class:is-chk={checked.has(i.id)} class:is-open={i.id === openId} role="row">
								<span role="cell" class="cb"
									><input
										type="checkbox"
										checked={checked.has(i.id)}
										onchange={() => toggle(i.id)}
										aria-label="Select {i.name || 'Untitled item'}" /></span>
								<span role="cell" class="ico" title={ITEM_TYPE_LABELS[i.type].one}
									><Icon name={i.type} size={16} /><span class="sr">{ITEM_TYPE_LABELS[i.type].one}</span></span>
								<span role="cell" class="nm"
									><button type="button" class="rname" class:untitled={!i.name} onclick={() => open(i.id)}
										>{i.name || 'Untitled item'}</button></span>
								<span role="cell" class="cell">{ix.roomName(i.roomId)}</span>
								<span role="cell" class="cell dim">{ix.floorName(i.floorId)}</span>
								<span role="cell" class="cell brk">
									{#if bs.length}
										<span class="chips">
											{#each bs as b, n (b.id)}
												{#if n > 0}<span class="pj" aria-hidden="true">+</span>{/if}
												<span class="bnum">{ix.slotOf(b)}</span>
											{/each}
										</span>
										{#if bs.length > 1}
											<span class="cell dim">{bs.length} breakers</span>
										{:else}
											<span class="cell">{ix.labelOf(bs[0])}</span>
											{#if tag}<span class="tag">{tag}</span>{/if}
										{/if}
									{:else}
										<span class="warnc">No breaker</span>
									{/if}
								</span>
								<span role="cell" class="cell">
									{#if i.x !== null && i.y !== null}
										<a class="loc" href={mapHref(i.id)}>Locate</a>
									{:else}
										<span class="warnc">Not placed</span>
									{/if}
								</span>
							</div>
						{/each}
						{#if rows.length === 0}
							<div class="empty">
								<span class="et">No items match these filters</span>
								<span class="es">Try a different floor or breaker, or clear everything.</span>
								<button type="button" class="btn" onclick={clearFilters}>Clear filters</button>
							</div>
						{/if}
					</div>
				</div>
				{#if selected.length}
					<div class="bulk inv">
						<span class="bn">{selected.length} selected</span>
						<div class="grow"></div>
						<label for="bulk" class="bl">Move to breaker</label>
						<select id="bulk" class="inp bsel" value="" onchange={bulkMove}>
							<option value="">Choose…</option>
							<option value="none">No breaker</option>
							{#each brkOpts as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
						</select>
						<button type="button" class="btn bclr" onclick={() => checked.clear()}>Clear selection</button>
					</div>
				{/if}
			</div>
		{/if}
	</section>

	<div class="toastslot" role="status">
		{#if toast}
			<div class="toast inv"><Icon name={toast.warn ? 'warning' : 'check'} size={16} stroke={2.4} />{toast.text}</div>
		{/if}
	</div>

	{#if openItem}
		{#key openItem.id}
			<ItemDrawer item={openItem} {ix} breakerOptions={brkOpts} onclose={close} />
		{/key}
	{/if}
</main>

<style>
	.page {
		flex: 1 1 0;
		min-height: 0;
		display: flex;
		gap: 24px;
		padding: 24px 32px;
	}
	.list {
		flex: 1 1 0;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.top {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 16px;
	}
	.ttl {
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
	.sub {
		font-size: 12px;
		color: var(--muted);
	}
	.acts {
		display: flex;
		gap: 8px;
	}
	.filters {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}
	.fsel {
		width: auto;
		height: var(--control-h-sm);
		min-width: 150px;
	}
	.fbrk {
		max-width: 260px;
	}
	.clear {
		height: var(--control-h-sm);
		border-color: transparent;
		background: transparent;
		text-decoration: underline;
	}
	.card {
		flex: 1 1 0;
		min-height: 0;
		background: var(--surface);
		border: 1px solid var(--line-2);
		border-radius: var(--r-2xl);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	/* No items yet */
	.card.none {
		align-items: center;
		justify-content: center;
		overflow: auto;
	}
	.nwrap {
		box-sizing: content-box;
		max-width: 560px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 20px;
		text-align: center;
		padding: 40px;
		margin: auto;
	}
	.tiles {
		display: flex;
		gap: 10px;
	}
	.tile {
		width: 52px;
		height: 52px;
		border-radius: var(--r-xl);
		background: var(--bg);
		border: 1px solid var(--line-2);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--ink);
	}
	.ntxt {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.ntxt h2 {
		font-size: 26px;
		font-weight: 800;
		font-stretch: 108%;
	}
	.ntxt p {
		margin: 0;
		font-size: 15px;
		line-height: 1.55;
		color: var(--soft);
	}
	.nacts {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		justify-content: center;
	}
	.hint {
		font-size: 12px;
		color: var(--muted);
	}
	.toastslot {
		position: fixed;
		left: 50%;
		bottom: 24px;
		transform: translateX(-50%);
		z-index: 20;
	}
	.toastslot:empty {
		display: none;
	}
	.toast {
		padding: 10px 14px;
		border-radius: var(--r-lg);
		font-size: 13px;
		font-weight: 600;
		display: flex;
		align-items: center;
		gap: 8px;
		box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
	}
	.tbl {
		flex: 1 1 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.tbody {
		flex: 1 1 0;
		min-height: 0;
		overflow: auto;
	}
	.trow {
		display: grid;
		grid-template-columns: 32px 36px minmax(0, 2.2fr) minmax(0, 1.3fr) 100px minmax(0, 1.9fr) 112px;
		align-items: center;
		column-gap: 12px;
		padding: 0 16px;
		min-height: 50px;
		border-bottom: 1px solid var(--line);
	}
	.trow:hover {
		background: var(--hover);
	}
	.trow.is-chk,
	.trow.is-open {
		background: var(--sel-row);
	}
	.thead {
		min-height: 42px;
		flex-shrink: 0;
		background: var(--raised);
		border-bottom: 1px solid var(--line-2);
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.thead:hover {
		background: var(--raised);
	}
	.th {
		height: 42px;
		padding: 0;
		border: 0;
		background: transparent;
		font: inherit;
		color: inherit;
		text-transform: inherit;
		letter-spacing: inherit;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		text-align: left;
	}
	.th:hover {
		color: var(--ink);
	}
	.cb {
		display: flex;
		align-items: center;
	}
	input[type='checkbox'] {
		width: 18px;
		height: 18px;
		margin: 0;
		accent-color: var(--amber);
		cursor: pointer;
	}
	.nm {
		min-width: 0;
	}
	.rname {
		width: 100%;
		padding: 8px 0;
		border: 0;
		background: transparent;
		font: inherit;
		font-size: 14px;
		font-weight: 600;
		color: var(--ink);
		text-align: left;
		cursor: pointer;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.rname:hover {
		text-decoration: underline;
	}
	.rname.untitled {
		font-style: italic;
		color: var(--muted);
	}
	.cell {
		font-size: 14px;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.dim {
		color: var(--muted);
	}
	.brk {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.chips {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
	}
	.pj {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--muted);
	}
	.warnc {
		color: var(--warn);
		font-size: 13px;
		font-weight: 600;
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.loc {
		font-size: 13px;
		font-weight: 600;
	}
	.empty {
		padding: 64px 24px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		text-align: center;
	}
	.et {
		font-size: 17px;
		font-weight: 700;
	}
	.es {
		font-size: 14px;
		color: var(--muted);
	}
	.bulk {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 16px;
	}
	.bn {
		font-size: 14px;
		font-weight: 700;
	}
	.bl {
		font-size: 13px;
		font-weight: 600;
	}
	.bsel {
		width: 260px;
		height: var(--control-h-sm);
	}
	.bclr {
		height: var(--control-h-sm);
	}
	.grow {
		flex-grow: 1;
	}
</style>
