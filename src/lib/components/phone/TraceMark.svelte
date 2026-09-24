<script lang="ts">
	// Trace step 2: walk the house with the breaker off and tap everything that lost power.
	import type { SvelteSet } from 'svelte/reactivity';
	import Icon from '$lib/components/Icon.svelte';
	import { mutate, plural, type HouseIndex, type HouseItem } from '$lib/house';
	import { createItem } from '$lib/db/ops';
	import { ITEM_TYPES, ITEM_TYPE_LABELS, type ItemType } from '$lib/constants';
	import type { Breaker } from '$lib/db/schema';

	let {
		ix,
		tb,
		marked,
		keep,
		floor = $bindable(),
		onback,
		onreview
	}: {
		ix: HouseIndex;
		tb: Breaker;
		marked: SvelteSet<number>;
		/** Marked items to keep on their other breakers too. */
		keep: SvelteSet<number>;
		floor: number | null;
		onback: () => void;
		onreview: () => void;
	} = $props();

	const house = $derived(ix.house);
	const num = $derived(ix.slotOf(tb));

	const tabs = $derived(
		house.floors.map((f) => ({
			id: f.id,
			label: f.name.replace(/ floor$/i, ''),
			count: house.items.filter((i) => i.floorId === f.id && marked.has(i.id)).length
		}))
	);

	const groups = $derived.by(() => {
		const its = house.items.filter((i) => i.floorId === floor);
		const rooms = house.rooms.filter((r) => r.floorId === floor).sort((a, b) => a.id - b.id);
		const out = rooms
			.map((r) => ({ key: `r${r.id}`, name: r.name, items: its.filter((i) => i.roomId === r.id) }))
			.filter((g) => g.items.length);
		const known = new Set(rooms.map((r) => r.id));
		const loose = its.filter((i) => i.roomId === null || !known.has(i.roomId));
		if (loose.length) out.push({ key: 'none', name: 'Not in a room', items: loose });
		return out;
	});

	/** "26 · Basement outlets", or "21 + 26" when there are several. */
	function others(i: HouseItem) {
		const bs = ix.breakersOf(i).filter((b) => b.id !== tb.id);
		if (bs.length === 1) return `${ix.slotOf(bs[0])} · ${ix.labelOf(bs[0])}`;
		return bs.map((b) => ix.slotOf(b)).join(' + ');
	}
	function consequence(i: HouseItem, on: boolean): { text: string; moves: boolean } {
		if (i.breakerIds.includes(tb.id)) {
			const rest = ix.breakersOf(i).filter((b) => b.id !== tb.id);
			return { text: `Already on ${[num, ...rest.map((b) => ix.slotOf(b))].join(' + ')}`, moves: false };
		}
		if (!i.breakerIds.length) return { text: on ? `New — will be added to ${num}` : 'No breaker yet', moves: false };
		if (on && keep.has(i.id)) return { text: `Stays on ${others(i)} too`, moves: false };
		return on ? { text: `Moves from ${others(i)}`, moves: true } : { text: `On ${others(i)}`, moves: false };
	}
	function toggle(id: number) {
		if (marked.has(id)) marked.delete(id);
		else marked.add(id);
	}

	// "Add something not listed": a small inline form for the current floor.
	let adding = $state(false);
	let newName = $state('');
	let newType = $state<ItemType>('outlet');
	let newRoom = $state<number | null>(null);
	let saving = $state(false);
	const floorRooms = $derived(house.rooms.filter((r) => r.floorId === floor).sort((a, b) => a.name.localeCompare(b.name)));
	let nameInput = $state<HTMLInputElement>();
	let addBtn = $state<HTMLButtonElement>();

	function openAdd() {
		adding = true;
		newName = '';
		newType = 'outlet';
		newRoom = null;
		queueMicrotask(() => nameInput?.focus());
	}
	function closeAdd() {
		adding = false;
		queueMicrotask(() => addBtn?.focus());
	}
	async function add(e: SubmitEvent) {
		e.preventDefault();
		const name = newName.trim();
		if (!name || saving) return;
		saving = true;
		try {
			const id = await mutate(() => createItem({ name, type: newType, floorId: floor, roomId: newRoom }));
			marked.add(id);
			closeAdd();
		} finally {
			saving = false;
		}
	}
</script>

<header class="top">
	<div class="row">
		<button type="button" class="ibtn" aria-label="Back to breaker list" onclick={onback}><Icon name="prev" /></button>
		<div class="ttl">
			<span class="ov">Step 2 of 3</span>
			<h1 tabindex="-1">Breaker {num} is off</h1>
		</div>
	</div>
	<p class="instr">Walk the house and tap everything that lost power. Test outlets with a lamp or tester.</p>
	{#if tabs.length > 1}
		<div class="seg" role="group" aria-label="Floor">
			{#each tabs as t (t.id)}
				<button type="button" class="sb fb" class:is-on={floor === t.id} aria-pressed={floor === t.id} onclick={() => (floor = t.id)}>
					{t.label}
					{#if t.count}<span class="dotc" aria-label="{t.count} marked">{t.count}</span>{/if}
				</button>
			{/each}
		</div>
	{/if}
</header>

<div class="scroll">
	{#each groups as g (g.key)}
		<section class="grp" aria-label={g.name}>
			<span class="ov" aria-hidden="true">{g.name}</span>
			{#each g.items as i (i.id)}
				{@const on = marked.has(i.id)}
				{@const c = consequence(i, on)}
				<button type="button" class="mrow" class:is-on={on} aria-pressed={on} onclick={() => toggle(i.id)}>
					<span class="ico"><Icon name={i.type} size={16} /></span>
					<span class="mm">
						<span class="mn">{i.name}</span>
						<span class="sub" class:mv={c.moves}>{c.text}</span>
					</span>
					<span class="chk"><Icon name="check" size={14} stroke={3} /></span>
				</button>
				{#if on && i.breakerIds.length && !i.breakerIds.includes(tb.id)}
					{@const was = ix.breakersOf(i).map((b) => ix.slotOf(b)).join(' + ')}
					<div class="segm" role="group" aria-label="What to do with breaker {was} for {i.name}">
						<button type="button" class:is-on={!keep.has(i.id)} aria-pressed={!keep.has(i.id)} onclick={() => keep.delete(i.id)}>Move to {num}</button>
						<button type="button" class:is-on={keep.has(i.id)} aria-pressed={keep.has(i.id)} onclick={() => keep.add(i.id)}>On both {was} + {num}</button>
					</div>
				{/if}
			{/each}
		</section>
	{:else}
		<p class="empty">Nothing on this floor yet.</p>
	{/each}

	{#if adding}
		<form class="addf" onsubmit={add}>
			<div class="fld">
				<label for="add-n">Name</label>
				<input id="add-n" class="inp" type="text" required bind:value={newName} bind:this={nameInput} placeholder="e.g. Outlet by the stairs" />
			</div>
			<div class="two">
				<div class="fld">
					<label for="add-t">Type</label>
					<select id="add-t" class="inp" bind:value={newType}>
						{#each ITEM_TYPES as t (t)}<option value={t}>{ITEM_TYPE_LABELS[t].one}</option>{/each}
					</select>
				</div>
				<div class="fld">
					<label for="add-r">Room</label>
					<select id="add-r" class="inp" bind:value={newRoom}>
						<option value={null}>No room</option>
						{#each floorRooms as r (r.id)}<option value={r.id}>{r.name}</option>{/each}
					</select>
				</div>
			</div>
			<div class="acts">
				<button type="button" class="btn" onclick={closeAdd}>Cancel</button>
				<button type="submit" class="btn btn-pri" disabled={saving || !newName.trim()}>Add and mark</button>
			</div>
		</form>
	{:else}
		<button type="button" class="btn addb" bind:this={addBtn} onclick={openAdd}><Icon name="plus" size={16} stroke={2.2} />Add something not listed</button>
	{/if}
</div>

<footer class="foot">
	<span class="ft" role="status">{marked.size === 0 ? 'Nothing marked yet' : `${plural(marked.size, 'item')} marked`}</span>
	<button type="button" class="btn btn-pri rev" onclick={onreview}>{marked.size === 0 ? 'Nothing lost power' : 'Review'}</button>
</footer>

<style>
	.top {
		flex-shrink: 0;
		padding: 12px 16px 14px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		border-bottom: 1px solid var(--line);
		background: var(--raised);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.ttl {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	/* Focused on step changes so screen readers follow; not interactive, so no ring. */
	h1:focus {
		outline: none;
	}
	h1 {
		font-size: 20px;
		font-weight: 800;
		font-stretch: 108%;
	}
	.instr {
		font-size: 14px;
		line-height: 1.45;
	}
	.fb {
		flex: 1 1 0;
		justify-content: center;
		min-width: 0;
	}
	.dotc {
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		border-radius: 9px;
		background: var(--amber);
		color: var(--on-amber);
		font-size: 11px;
		font-weight: 700;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	.scroll {
		flex: 1 1 0;
		min-height: 0;
		overflow: auto;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.grp {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.mrow {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		min-height: 58px;
		padding: 8px 12px;
		border: 1.5px solid var(--line-2);
		border-radius: var(--r-xl);
		background: var(--surface);
		font: inherit;
		color: var(--ink);
		text-align: left;
		cursor: pointer;
		transition:
			background 0.15s,
			border-color 0.15s;
	}
	.mrow:hover {
		border-color: var(--btn-bd-h);
	}
	.mrow.is-on {
		background: var(--amber-soft);
		border-color: var(--amber);
	}
	.mm {
		flex-grow: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.mn {
		font-size: 15px;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sub {
		font-size: 12px;
		color: var(--muted);
	}
	.sub.mv {
		color: var(--warn);
		font-weight: 600;
	}
	.chk {
		width: 26px;
		height: 26px;
		border-radius: 50%;
		border: 2px solid var(--field);
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--on-amber);
	}
	.chk :global(svg) {
		opacity: 0;
	}
	.mrow.is-on .chk {
		background: var(--amber);
		border-color: var(--amber);
	}
	.mrow.is-on .chk :global(svg) {
		opacity: 1;
	}
	.addb {
		width: 100%;
		border-style: dashed;
		flex-shrink: 0;
	}
	.addf {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 12px;
		border: 1px dashed var(--btn-bd);
		border-radius: var(--r-xl);
		background: var(--surface);
	}
	.two {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	.acts {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
	.empty {
		font-size: 14px;
		color: var(--muted);
	}
	.foot {
		flex-shrink: 0;
		padding: 12px 16px 20px;
		border-top: 1px solid var(--line);
		background: var(--raised);
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.ft {
		flex-grow: 1;
		font-size: 15px;
		font-weight: 700;
	}
	.rev {
		height: 50px;
		font-size: 15px;
	}
	@media (prefers-reduced-motion: reduce) {
		.mrow {
			transition: none;
		}
	}
	/* Move to 21 / On both 14 + 21, under a marked item that's on another breaker. */
	.segm {
		display: flex;
		background: var(--line);
		border-radius: var(--r-md);
		padding: 2px;
		gap: 2px;
		margin: -2px 0 4px 52px;
	}
	.segm button {
		height: 34px;
		padding: 0 10px;
		border: 0;
		border-radius: 5px;
		background: transparent;
		font: inherit;
		font-size: 12px;
		font-weight: 600;
		color: var(--soft);
		cursor: pointer;
	}
	.segm button.is-on {
		background: var(--surface);
		color: var(--ink);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.14);
	}
</style>
