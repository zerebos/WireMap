<script lang="ts">
	import FedPath from '$lib/components/FedPath.svelte';
	import { resolve } from '$app/paths';
	import Icon from '$lib/components/Icon.svelte';
	import { access } from '$lib/access.svelte';
	import ItemRow from './ItemRow.svelte';
	import { mutate, plural, type HouseIndex, type HouseItem } from '$lib/house';
	import { deleteItems, setTied, swapItemBreaker, updateRoom } from '$lib/db/ops';
	import type { Breaker, Room } from '$lib/db/schema';
	import { ITEM_TYPES, ITEM_TYPE_LABELS } from '$lib/constants';
	import { NONE, floorSteps, itemsOn, shapeOfRoom, roomBreakerCount, roomGroups, slotsText, specOf, type Sel } from './model';

	let {
		ix,
		sel,
		floorId,
		hovB = $bindable(null),
		moving,
		go,
		onmove,
		onshape
	}: {
		ix: HouseIndex;
		sel: Sel;
		floorId: number | null;
		/** Circuit card being hovered or focused in room mode. */
		hovB?: number | null;
		/** Item waiting for a click on the map. */
		moving: number | null;
		go: (sel: Sel, floor?: number | null) => void;
		onmove: (item: HouseItem) => void;
		/** Opens layout editing on this room; absent when the viewer can't edit. */
		onshape?: (room: Room) => void;
	} = $props();

	const floorName = $derived(ix.floorName(floorId));
	const panelHref = (b: Breaker) => `${resolve('/panel')}?b=${b.id}`;
	const selectItem = (i: HouseItem) => go({ kind: 'item', id: i.id }, i.floorId ?? floorId);

	// ---- Item mode
	const item = $derived(sel.kind === 'item' ? (ix.house.items.find((i) => i.id === sel.id) ?? null) : null);
	const fed = $derived(item ? ix.breakersOf(item) : []);
	const sibs = $derived(item ? itemsOn(ix, item.breakerIds).filter((i) => i.id !== item.id) : []);
	const optionText = (b: Breaker) => `${ix.slotOf(b)} — ${ix.labelOf(b)} (${b.amps}A)`;

	function closeItem() {
		// Back to the circuit it was lit on, like the design; several or none → nothing.
		go(fed.length === 1 ? { kind: 'circuit', id: fed[0].id } : NONE);
	}
	function toRoom() {
		if (!item || item.roomId === null) return;
		const room = ix.roomById.get(item.roomId);
		go({ kind: 'room', id: item.roomId }, room?.floorId ?? floorId);
	}
	/** Swaps breaker `from` for the one picked in a select (or none); `from` null adds one. */
	function reassign(from: number | null, e: Event | null) {
		if (!item) return;
		const v = e ? (e.currentTarget as HTMLSelectElement).value : '';
		const to = v === '' ? null : Number(v);
		if (to === from) return;
		const id = item.id;
		mutate(() => swapItemBreaker(id, from, to));
	}
	/** "Turn off both 14 and 21", or "Turn off all 3 (9, 14, 21)". */
	const allOffText = $derived.by(() => {
		const n = fed.map((b) => ix.slotOf(b));
		return n.length === 2 ? `Turn off both ${n[0]} and ${n[1]}` : `Turn off all ${n.length} (${n.join(', ')})`;
	});
	/** Handle-tied: every breaker feeding the item shares one tie group. */
	const tied = $derived(fed.length > 1 && fed[0].tieGroup !== null && fed.every((b) => b.tieGroup === fed[0].tieGroup));
	function tie(on: boolean) {
		const ids = fed.map((b) => b.id);
		mutate(() => setTied(ids, on));
	}
	async function remove() {
		if (!item) return;
		if (!confirm(`Remove “${item.name}”? This deletes it from the map, the panel and the items list.`)) return;
		const id = item.id;
		go(NONE);
		await mutate(() => deleteItems([id]));
	}

	// ---- Circuit mode
	const breaker = $derived(sel.kind === 'circuit' ? (ix.breakerById.get(sel.id) ?? null) : null);
	const circ = $derived(breaker ? ix.itemsOf(breaker.id) : []);
	const here = $derived(circ.filter((i) => i.floorId === floorId));
	const elsewhere = $derived(
		ix.house.floors
			.filter((f) => f.id !== floorId)
			.map((f) => ({ f, n: circ.filter((i) => i.floorId === f.id).length }))
			.filter((o) => o.n > 0)
	);

	// ---- Room mode
	const room = $derived(sel.kind === 'room' ? (ix.roomById.get(sel.id) ?? null) : null);
	const groups = $derived(room ? roomGroups(ix, room) : []);
	const nCirc = $derived(roomBreakerCount(groups));
	const roomItems = $derived(room ? ix.itemsInRoom(room.id).length : 0);
	const hasShape = $derived(room ? shapeOfRoom(room) !== null : false);

	let renaming = $state(false);
	let draftName = $state('');
	let renameError = $state('');
	$effect(() => {
		// A different selection ends a rename.
		void sel;
		renaming = false;
		renameError = '';
	});
	function startRename() {
		if (!room) return;
		draftName = room.name;
		renameError = '';
		renaming = true;
	}
	async function saveRename() {
		if (!room || !renaming) return;
		const name = draftName.trim();
		if (!name || name === room.name) return void (renaming = false);
		if (ix.house.rooms.some((r) => r.id !== room.id && r.floorId === room.floorId && r.name.toLowerCase() === name.toLowerCase())) {
			renameError = `There's already a ${name} on this floor.`;
			return;
		}
		renaming = false;
		const id = room.id;
		await mutate(() => updateRoom(id, { name }));
	}
	function renameKey(e: KeyboardEvent) {
		if (e.key === 'Enter') saveRename();
		else if (e.key === 'Escape') {
			e.stopPropagation();
			renaming = false;
		}
	}
	const focus = (el: HTMLElement) => el.focus();

	// ---- Nothing selected on a floor that isn't mapped yet (DESIGN.md §5.9)
	const steps = $derived(floorSteps(ix, floorId));
	const gettingStarted = $derived(floorId !== null && (!steps.rooms || !steps.placed));
	const checklist = $derived([
		{ title: 'Add rooms', body: 'Upload a plan and trace it, or draw on the grid.', done: steps.rooms },
		{ title: 'Place items', body: 'Outlets, lights, switches and appliances, where they really are.', done: steps.placed },
		{ title: 'Connect them to breakers', body: 'Pick a breaker per item, or trace with your phone and it places them for you.', done: steps.wired }
	]);
	const cur = $derived(checklist.findIndex((s) => !s.done));
</script>

<aside aria-label="Inspector" class="inspector">
	<div class="scroll">
		{#if item}
			<div class="stack">
				<div class="top">
					<div class="hd">
						<span class="ov">{ix.typeLabel(item)}</span>
						<h2>{item.name}</h2>
						{#if item.roomId !== null && ix.roomById.has(item.roomId)}
							<button type="button" class="linkbtn" onclick={toRoom}>{ix.whereOf(item)}</button>
						{:else}
							<span class="meta">{ix.whereOf(item)}</span>
						{/if}
					</div>
					<button type="button" class="ibtn" aria-label="Close item" onclick={closeItem}><Icon name="close" size={16} /></button>
				</div>

				<div class="fed">
					<span class="ov amb">{fed.length > 1 ? `Fed by ${fed.length} breakers` : 'Fed by'}</span>
					{#if fed.length === 1}
						{@const b = fed[0]}
						<div class="fb">
							<span class="big mono">{ix.slotOf(b)}</span>
							<div class="fbt">
								<span class="bn">{ix.labelOf(b)}</span>
								<span class="bs">{specOf(b)}</span>
							</div>
						</div>
						<FedPath {ix} breaker={b} />
						{#if !access.guest}<div class="fld">
							<label for="reb-{b.id}">Move to another breaker</label>
							<select id="reb-{b.id}" class="inp" value={String(b.id)} onchange={(e) => reassign(b.id, e)}>
								{#each ix.house.breakers as o (o.id)}<option value={String(o.id)}>{optionText(o)}</option>{/each}
							</select>
						</div>{/if}
					{:else if fed.length > 1}
						{#each fed as b (b.id)}
							<div class="frow">
								<span class="chipn mono">{ix.slotOf(b)}</span>
								<span class="fbt grow">
									<span class="fn">{ix.labelOf(b)}</span>
									<span class="fs">{specOf(b)}</span>
								</span>
								{#if !access.guest}<button type="button" class="ibtn x" aria-label="Remove breaker {ix.slotOf(b)} from this item" onclick={() => reassign(b.id, null)}
									><Icon name="close" size={14} stroke={2.2} /></button
								>{/if}
							</div>
						{/each}
					{:else}
						<div class="fb">
							<span class="big mono warn">?</span>
							<div class="fbt">
								<span class="bn warnt">No breaker</span>
								<span class="bs">Not assigned yet</span>
							</div>
						</div>
						{#if !access.guest}<div class="fld">
							<label for="reb-none">Pick its breaker</label>
							<select id="reb-none" class="inp" value="" onchange={(e) => reassign(null, e)}>
								<option value="">— No breaker —</option>
								{#each ix.house.breakers as o (o.id)}<option value={String(o.id)}>{optionText(o)}</option>{/each}
							</select>
						</div>{/if}
					{/if}
					{#if fed.length && !access.guest}
						<div class="fld">
							<label for="addb">Add another breaker</label>
							<select id="addb" class="inp" value="" onchange={(e) => reassign(null, e)}>
								<option value="">Choose…</option>
								{#each ix.house.breakers.filter((o) => !item.breakerIds.includes(o.id)) as o (o.id)}<option value={String(o.id)}
										>{optionText(o)}</option
									>{/each}
							</select>
						</div>
					{/if}
					{#if fed.length > 1}
						<div class="multi">
							<span class="mt"><strong>{allOffText}</strong> before opening this box.</span>
							{#if !access.guest}<label class="chk"
								><input type="checkbox" checked={tied} onchange={(e) => tie(e.currentTarget.checked)} /><span
									>These share a neutral (multi-wire circuit). They should be handle-tied.</span
								></label
							>{/if}
							{#if tied && !access.guest}<span class="tiewarn">The Panel draws these {fed.length === 2 ? 'two' : fed.length} with a tie bar and warns if they’re moved apart.</span>{/if}
						</div>
					{/if}
					{#each fed as b (b.id)}
						<a class="open" href={panelHref(b)}>{fed.length > 1 ? `Open ${ix.slotOf(b)} in panel →` : 'Open in panel →'}</a>
					{/each}
				</div>

				<div class="sect">
					<span class="ov">Also on this circuit · {sibs.length}</span>
					{#each sibs as s (s.id)}
						<ItemRow item={s} where={ix.whereOf(s)} onclick={() => selectItem(s)} />
					{:else}
						<span class="none">Nothing else on this breaker yet.</span>
					{/each}
				</div>

				{#if !access.guest}<div class="row">
					<button type="button" class="btn grow" aria-pressed={moving === item.id} onclick={() => item && onmove(item)}>
						{item.x === null || item.y === null ? 'Place on map' : 'Move on map'}
					</button>
					<button type="button" class="btn btn-warn grow" onclick={remove}>Remove</button>
				</div>{/if}
			</div>
		{:else if breaker}
			<div class="stack">
				<div class="hd">
					<span class="ov">Breaker {ix.slotOf(breaker)}</span>
					<h2 class:unl={!breaker.label}>{ix.labelOf(breaker)}</h2>
					<span class="meta">{specOf(breaker)} · {plural(circ.length, 'item')}</span>
				</div>
				<div class="sect">
					<span class="ov">On {floorName} · {here.length}</span>
					{#each here as s (s.id)}
						<ItemRow item={s} where={ix.roomName(s.roomId)} onclick={() => selectItem(s)} />
					{:else}
						<span class="none">Nothing on this floor.</span>
					{/each}
				</div>
				{#if elsewhere.length}
					<div class="sect">
						<span class="ov">Elsewhere</span>
						{#each elsewhere as o (o.f.id)}
							<button type="button" class="btn between" onclick={() => go(sel, o.f.id)}>
								{o.n} on {o.f.name}<span aria-hidden="true">→</span>
							</button>
						{/each}
					</div>
				{/if}
				<a class="btn" href={panelHref(breaker)}>{access.guest ? 'Open in panel' : 'Edit in panel'}</a>
			</div>
		{:else if room}
			<div class="stack">
				<div class="top">
					<div class="hd">
						<span class="ov">Room · {ix.floorName(room.floorId)}</span>
						{#if renaming}
							<label class="sr" for="rename">Room name</label>
							<input id="rename" class="inp rename" bind:value={draftName} onkeydown={renameKey} onblur={saveRename} use:focus />
							{#if renameError}<span class="err" role="alert">{renameError}</span>{/if}
						{:else}
							<h2>{room.name}</h2>
						{/if}
						<span class="meta">{plural(roomItems, 'item')} on {plural(nCirc, 'circuit')}</span>
					</div>
					<button type="button" class="ibtn" aria-label="Close room" onclick={() => go(NONE)}><Icon name="close" size={16} /></button>
				</div>
				<a class="btn shut" href={`${resolve('/map')}?floor=${room.floorId}&room=${room.id}&shutoff=1`}>
					<Icon name="power" size={16} stroke={2.2} />Shut off this room · {plural(nCirc, 'breaker')}
				</a>
				{#if hasShape && !access.guest}
					<div class="row">
						<button type="button" class="btn grow sm" onclick={() => room && onshape?.(room)}>Edit shape</button>
						<button type="button" class="btn grow sm" aria-pressed={renaming} onclick={() => (renaming ? saveRename() : startRename())}>
							{renaming ? 'Save name' : 'Rename'}
						</button>
					</div>
				{/if}
				<div class="sect cards">
					<span class="ov">Circuits in this room · {nCirc}</span>
					{#each groups as g (g.key)}
						{@const gb = g.breaker}
						<div
							class="card"
							role="group"
							aria-label={gb ? `Breaker ${ix.slotOf(gb)}` : 'No breaker'}
							onmouseenter={() => (hovB = gb?.id ?? null)}
							onmouseleave={() => (hovB = null)}
						>
							{#if gb}
								<button
									type="button"
									class="ghead"
									title="Light up this circuit"
									onclick={() => go({ kind: 'circuit', id: gb.id })}
									onfocus={() => (hovB = gb.id)}
									onblur={() => (hovB = null)}
								>
									<span class="bnum">{ix.slotOf(gb)}</span>
									<span class="gt">
										<span class="gn">{ix.labelOf(gb)}</span>
										<span class="gm">{specOf(gb)}</span>
									</span>
									<span class="gm mono">{g.items.length}</span>
								</button>
							{:else}
								<div class="ghead static">
									<span class="bnum warn">?</span>
									<span class="gt">
										<span class="gn warnt">No breaker</span>
										<span class="gm">Not assigned yet</span>
									</span>
									<span class="gm mono">{g.items.length}</span>
								</div>
							{/if}
							<div class="gitems">
								{#each g.items as s (s.id)}
									<ItemRow item={s} compact plus={gb ? ix.plusOf(s, gb.id) : ''} onclick={() => selectItem(s)} />
								{/each}
							</div>
							{#if g.elseText}
								<div class="else"><Icon name="arrow" size={14} /><span>{g.elseText}</span></div>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{:else if gettingStarted}
			<div class="getting">
				<div class="hd"><span class="ov">Getting the map going</span><h2 class="h20">Three steps per floor</h2></div>
				<ol class="steps">
					{#each checklist as s, n (s.title)}
						<li class="ck" class:is-cur={n === cur} class:is-done={s.done}>
							<span class="n">
								{#if s.done}<Icon name="check" size={14} stroke={2.5} /><span class="sr">Done:</span>{:else}{n + 1}{/if}
							</span>
							<span class="ckt">
								<span class="ckh">{s.title}</span>
								<span class="ckb">{s.body}</span>
							</span>
						</li>
					{/each}
				</ol>
				{#if !access.guest}<a class="btn" href={resolve('/trace')}>Trace with your phone instead</a>{/if}
			</div>
		{:else}
			<div class="nothing">
				<h2>Nothing selected</h2>
				<span
					>Pick a circuit on the left to light up everything it feeds, click a room to see its circuits, or click any item to find its
					breaker.</span
				>
			</div>
		{/if}
	</div>

	{#if !(gettingStarted && !item && !breaker && !room)}
		<div class="legend">
			<span class="ov">Legend</span>
			<div class="lg">
				{#each ITEM_TYPES as t (t)}
					<span class="li"><span class="ico"><Icon name={t} size={14} /></span>{ITEM_TYPE_LABELS[t].one}</span>
				{/each}
			</div>
		</div>
	{/if}
</aside>

<style>
	.getting {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
	.h20 {
		font-size: 20px;
		font-stretch: 105%;
	}
	.steps {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
	.ck {
		display: flex;
		gap: 12px;
		align-items: flex-start;
	}
	.ck .n {
		width: 26px;
		height: 26px;
		border-radius: 50%;
		border: 1.5px solid var(--field);
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-mono);
		font-size: 12px;
		font-weight: 600;
		color: var(--muted);
		flex-shrink: 0;
	}
	.ck.is-cur .n {
		background: var(--amber);
		border-color: var(--amber);
		color: var(--on-amber);
	}
	.ck.is-done .n {
		border-color: var(--ok);
		color: var(--ok);
	}
	.ckt {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.ckh {
		font-size: 14px;
		font-weight: 700;
	}
	.ck.is-done .ckh {
		color: var(--muted);
	}
	.ckb {
		font-size: 13px;
		color: var(--muted);
		line-height: 1.45;
	}
	.getting .btn {
		margin-top: 4px;
	}
	.inspector {
		width: 320px;
		flex-shrink: 0;
		background: var(--surface);
		border-left: 1px solid var(--line-2);
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	.scroll {
		flex-grow: 1;
		min-height: 0;
		overflow: auto;
		padding: 20px;
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.stack {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.top {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 12px;
	}
	.hd {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}
	h2 {
		font-size: 22px;
		font-weight: 800;
		font-stretch: 105%;
		line-height: 1.2;
		overflow-wrap: anywhere;
	}
	h2.unl {
		font-style: italic;
		color: var(--warn);
	}
	.meta {
		font-size: 14px;
		color: var(--muted);
	}
	.rename {
		font-size: 18px;
		font-weight: 700;
	}
	.err {
		font-size: 13px;
		color: var(--warn);
	}
	.sect {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.cards {
		gap: 12px;
	}
	.none {
		font-size: 13px;
		color: var(--muted);
	}
	.row {
		display: flex;
		gap: 8px;
	}
	.grow {
		flex-grow: 1;
	}
	.btn.sm {
		height: var(--control-h-sm);
	}
	.between {
		justify-content: space-between;
	}

	/* Fed by */
	.fed {
		border: 1.5px solid var(--ink);
		border-radius: var(--r-xl);
		padding: 14px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		background: var(--amber-soft);
	}
	.ov.amb {
		color: var(--amber-ink);
	}
	.fb {
		display: flex;
		gap: 12px;
		align-items: center;
	}
	.big {
		min-width: 48px;
		height: 48px;
		padding: 0 6px;
		background: var(--amber);
		color: var(--on-amber);
		border: 1.5px solid var(--fed-bd);
		border-radius: var(--r-md);
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 600;
		font-size: 16px;
		flex-shrink: 0;
		white-space: nowrap;
	}
	.big.warn {
		background: var(--warn);
		color: var(--surface);
		border-color: var(--warn);
	}
	.fbt {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.bn {
		font-size: 16px;
		font-weight: 700;
	}
	.warnt {
		color: var(--warn);
	}
	.bs {
		font-size: 13px;
		color: var(--soft);
	}
	.frow {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.chipn {
		min-width: 44px;
		height: 40px;
		padding: 0 6px;
		background: var(--amber);
		color: var(--on-amber);
		border-radius: var(--r-md);
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 600;
		font-size: 15px;
		flex-shrink: 0;
		white-space: nowrap;
	}
	.fn {
		font-size: 15px;
		font-weight: 700;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.fs {
		font-size: 12px;
		color: var(--soft);
	}
	.ibtn.x {
		width: 36px;
		height: 36px;
	}
	.multi {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding-top: 10px;
		border-top: 1px solid color-mix(in srgb, var(--amber) 40%, transparent);
	}
	.mt {
		font-size: 13px;
		line-height: 1.45;
	}
	.tiewarn {
		font-size: 12px;
		color: var(--warn);
		font-weight: 600;
		line-height: 1.45;
	}
	.open {
		font-size: 14px;
		font-weight: 600;
	}

	/* Room */
	.shut {
		width: 100%;
		height: 48px;
		background: var(--amber);
		color: var(--on-amber);
		border-color: var(--amber);
	}
	.shut:hover {
		background: var(--amber-h);
		color: var(--on-amber);
		border-color: var(--amber-h);
	}
	.card {
		border: 1px solid var(--line-2);
		border-radius: var(--r-xl);
		overflow: hidden;
		flex-shrink: 0;
	}
	.ghead {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 10px 12px;
		border: 0;
		border-bottom: 1px solid var(--line);
		background: var(--raised);
		font: inherit;
		color: var(--ink);
		text-align: left;
		cursor: pointer;
	}
	.ghead:hover,
	.ghead:focus-visible {
		background: var(--amber);
		color: var(--on-amber);
	}
	.ghead:focus-visible {
		outline-offset: -3px;
	}
	.ghead:hover .gm,
	.ghead:focus-visible .gm {
		color: var(--on-amber-muted);
	}
	.ghead.static {
		cursor: default;
	}
	.ghead.static:hover {
		background: var(--raised);
		color: var(--ink);
	}
	.ghead.static:hover .gm {
		color: var(--muted);
	}
	.ghead .bnum {
		min-width: 40px;
	}
	.gt {
		flex-grow: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.gn {
		font-size: 14px;
		font-weight: 700;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.gm {
		font-size: 12px;
		color: var(--muted);
	}
	.gitems {
		padding: 6px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.else {
		padding: 8px 12px;
		border-top: 1px solid var(--line);
		font-size: 12px;
		line-height: 1.4;
		color: var(--muted);
		display: flex;
		gap: 6px;
		align-items: flex-start;
	}
	.else :global(svg) {
		flex-shrink: 0;
		margin-top: 1px;
	}

	.nothing {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding-top: 8px;
	}
	.nothing h2 {
		font-size: 20px;
	}
	.nothing span {
		font-size: 14px;
		color: var(--muted);
		line-height: 1.5;
	}

	.legend {
		border-top: 1px solid var(--line);
		padding: 14px 20px 16px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.lg {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px 12px;
		font-size: 13px;
	}
	.li {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.li .ico {
		width: 26px;
		height: 26px;
	}
</style>
