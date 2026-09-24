<script lang="ts">
	// The Map on a phone (DESIGN.md §5.12): floor tabs, a circuit picker, the floor scaled to fit
	// the width (pinch to zoom), and what's selected in a panel underneath. For finding things
	// only; layout editing is desktop-only.
	import { resolve } from '$app/paths';
	import Icon from '$lib/components/Icon.svelte';
	import type { Room } from '$lib/db/schema';
	import { plural, type HouseIndex, type HouseItem } from '$lib/house';
	import { planUrl } from '$lib/plans';
	import { pointsOf, type Point, type Rect } from '$lib/shape';
	import { NONE, itemsOn, litBreakers, planBox, roomBreakerCount, roomGroups, shapeOfRoom, slotsText, type Sel } from './model';

	let {
		ix,
		sel,
		floorId,
		go
	}: {
		ix: HouseIndex;
		sel: Sel;
		floorId: number | null;
		go: (sel: Sel, floor?: number | null) => void;
	} = $props();

	const floor = $derived(floorId === null ? null : (ix.floorById.get(floorId) ?? null));
	const floorRooms = $derived(ix.house.rooms.filter((r) => r.floorId === floorId));
	const floorItems = $derived(ix.house.items.filter((i) => i.floorId === floorId && i.x !== null && i.y !== null));
	const breakers = $derived([...ix.house.breakers].sort((a, b) => a.panelId - b.panelId || a.slot - b.slot));

	// ---- Selection
	const selRoom = $derived(sel.kind === 'room' ? (ix.roomById.get(sel.id) ?? null) : null);
	const selItem = $derived(sel.kind === 'item' ? (ix.house.items.find((i) => i.id === sel.id) ?? null) : null);
	const roomMode = $derived(!!selRoom);
	const litBs = $derived(litBreakers(ix, sel));
	const litItems = $derived(itemsOn(ix, litBs.map((b) => b.id)));
	const litIds = $derived(new Set(litItems.map((i) => i.id)));
	const litRooms = $derived(new Set(litItems.filter((i) => i.floorId === floorId).map((i) => i.roomId)));
	const dotFloors = $derived(new Set(litItems.map((i) => i.floorId)));
	const circuitValue = $derived(litBs[0] ? String(litBs[0].id) : '');

	/** "Main floor" reads as "Main" on the narrow floor tabs. */
	const tabName = (name: string) => name.replace(/\s+floor$/i, '') || name;

	// ---- View: fit the floor to the box; pinch (or drag once zoomed) to look closer.
	let box: HTMLDivElement | undefined = $state();
	let bw = $state(390);
	let bh = $state(360);
	let zoom = $state(1);
	let panX = $state(0);
	let panY = $state(0);
	const PAD_X = 12;
	const PAD_Y = 10;
	const fitZ = $derived(floor ? Math.min((bw - PAD_X * 2) / floor.planWidth, (bh - PAD_Y * 2) / floor.planHeight) : 1);
	const z = $derived(fitZ * zoom);
	const ox = $derived(PAD_X + ((bw - PAD_X * 2) - (floor?.planWidth ?? 0) * fitZ) / 2 + panX);
	const oy = $derived(PAD_Y + panY);
	const sx = (x: number) => x * z + ox;
	const sy = (y: number) => y * z + oy;
	$effect(() => {
		void floorId;
		zoom = 1;
		panX = 0;
		panY = 0;
	});

	const pointers = new Map<number, Point>();
	let gesture: { d0: number; zoom0: number; mid: Point; panX0: number; panY0: number } | null = null;
	let dragFrom: { p: Point; panX0: number; panY0: number; moved: boolean } | null = null;
	let suppressClick = false;
	function local(e: PointerEvent): Point {
		const r = box!.getBoundingClientRect();
		return [e.clientX - r.left, e.clientY - r.top];
	}
	function onpointerdown(e: PointerEvent) {
		pointers.set(e.pointerId, local(e));
		if (pointers.size === 2) {
			const [a, b] = [...pointers.values()];
			gesture = { d0: Math.hypot(a[0] - b[0], a[1] - b[1]), zoom0: zoom, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], panX0: panX, panY0: panY };
			dragFrom = null;
		} else if (pointers.size === 1) {
			dragFrom = { p: local(e), panX0: panX, panY0: panY, moved: false };
		}
	}
	function onpointermove(e: PointerEvent) {
		if (!pointers.has(e.pointerId)) return;
		pointers.set(e.pointerId, local(e));
		if (gesture && pointers.size === 2) {
			const [a, b] = [...pointers.values()];
			const nz = Math.min(4, Math.max(1, (gesture.zoom0 * Math.hypot(a[0] - b[0], a[1] - b[1])) / (gesture.d0 || 1)));
			// Keep the point under the fingers' midpoint still.
			const k = nz / gesture.zoom0;
			panX = gesture.mid[0] - (gesture.mid[0] - (gesture.panX0 + baseX())) * k - baseX();
			panY = gesture.mid[1] - (gesture.mid[1] - (gesture.panY0 + PAD_Y)) * k - PAD_Y;
			zoom = nz;
			suppressClick = true;
		} else if (dragFrom && zoom > 1) {
			const p = local(e);
			if (!dragFrom.moved && Math.hypot(p[0] - dragFrom.p[0], p[1] - dragFrom.p[1]) < 6) return;
			if (!dragFrom.moved) box!.setPointerCapture(e.pointerId);
			dragFrom.moved = true;
			suppressClick = true;
			panX = dragFrom.panX0 + p[0] - dragFrom.p[0];
			panY = dragFrom.panY0 + p[1] - dragFrom.p[1];
		}
	}
	function onpointerup(e: PointerEvent) {
		pointers.delete(e.pointerId);
		if (pointers.size < 2) gesture = null;
		if (!pointers.size) {
			dragFrom = null;
			if (zoom <= 1.01) {
				zoom = 1;
				panX = 0;
				panY = 0;
			}
		}
	}
	const baseX = () => PAD_X + ((bw - PAD_X * 2) - (floor?.planWidth ?? 0) * fitZ) / 2;
	function onclickcapture(e: MouseEvent) {
		if (!suppressClick) return;
		suppressClick = false;
		e.stopPropagation();
		e.preventDefault();
	}

	// ---- Plan image
	let planSrc = $state<string | null>(null);
	$effect(() => {
		const name = floor?.planImage ?? null;
		planSrc = null;
		if (!name) return;
		let live = true;
		planUrl(name).then((u) => live && (planSrc = u));
		return () => (live = false);
	});

	type Drawn = { room: Room; pts: Point[]; rect: Rect | null };
	const drawn: Drawn[] = $derived(
		floorRooms.flatMap((room) => {
			const shape = shapeOfRoom(room);
			return shape ? [{ room, pts: pointsOf(shape), rect: shape.type === 'rect' ? shape : null }] : [];
		})
	);
	const pickRoom = (r: Room) => go(selRoom?.id === r.id ? NONE : { kind: 'room', id: r.id });
	const pickItem = (i: HouseItem) => go({ kind: 'item', id: i.id }, i.floorId);
	const itemAria = (i: HouseItem) => {
		const bs = ix.breakersOf(i);
		return `${i.name}, ${ix.roomName(i.roomId)}, ${bs.length ? `breaker ${slotsText(ix, bs)}` : 'no breaker'}`;
	};

	// ---- The panel under the map
	const here = $derived(litItems.filter((i) => i.floorId === floorId));
	const others = $derived(
		ix.house.floors
			.filter((f) => f.id !== floorId)
			.map((f) => ({ f, n: litItems.filter((i) => i.floorId === f.id).length }))
			.filter((o) => o.n > 0)
	);
	const roomItems = $derived.by(() => {
		if (!selRoom) return [];
		const first = (i: HouseItem) => ix.breakersOf(i)[0];
		return ix.itemsInRoom(selRoom.id).sort((a, b) => {
			const ba = first(a);
			const bb = first(b);
			if (!ba || !bb) return (ba ? 0 : 1) - (bb ? 0 : 1);
			return ba.panelId - bb.panelId || ba.slot - bb.slot;
		});
	});
	const roomCircuits = $derived(selRoom ? roomBreakerCount(roomGroups(ix, selRoom)) : 0);
</script>

<div class="pm">
	<div class="ctl">
		<div class="seg" role="group" aria-label="Floor">
			{#each ix.house.floors as f (f.id)}
				<button type="button" class="sb" class:is-on={f.id === floorId} aria-pressed={f.id === floorId} onclick={() => go(roomMode ? NONE : sel, f.id)}
					>{tabName(f.name)}{#if dotFloors.has(f.id)}<span class="dot"><span class="sr"> (has lit items)</span></span>{/if}</button
				>
			{/each}
		</div>
		<label for="pc" class="sr">Circuit</label>
		<select
			id="pc"
			class="inp"
			value={circuitValue}
			onchange={(e) => {
				const v = e.currentTarget.value;
				go(v ? { kind: 'circuit', id: Number(v) } : NONE);
			}}
		>
			<option value="">Pick a circuit to light it up…</option>
			{#each breakers as b (b.id)}
				<option value={String(b.id)}>{ix.slotOf(b)} — {ix.labelOf(b)}</option>
			{/each}
		</select>
	</div>

	<!-- Pinch and drag only change the view; rooms and items are buttons. -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="grid"
		bind:this={box}
		bind:clientWidth={bw}
		bind:clientHeight={bh}
		style:background-size="{12 * zoom}px {12 * zoom}px"
		{onpointerdown}
		{onpointermove}
		{onpointerup}
		onpointercancel={onpointerup}
		{onclickcapture}
	>
		{#if floor}
			{#if planSrc}
				{@const pb = planBox(floor)}
				<img
					class="plan"
					src={planSrc}
					alt=""
					draggable="false"
					style:left="{sx(pb.x)}px"
					style:top="{sy(pb.y)}px"
					style:width="{pb.w * z}px"
					style:height="{pb.h * z}px"
					style:transform="rotate({pb.rot}deg)"
					style:opacity={floor.planOpacity}
				/>
			{/if}
			{#each drawn as d (d.room.id)}
				{#if d.rect}
					<button
						type="button"
						class="room"
						class:is-lit={!roomMode && litRooms.has(d.room.id)}
						class:is-sel={selRoom?.id === d.room.id}
						class:is-mute={roomMode && selRoom?.id !== d.room.id}
						class:is-ext={d.room.kind === 'exterior'}
						style:left="{sx(d.rect.x)}px"
						style:top="{sy(d.rect.y)}px"
						style:width="{d.rect.w * z}px"
						style:height="{d.rect.h * z}px"
						aria-label={d.room.name}
						aria-pressed={selRoom?.id === d.room.id}
						onclick={() => pickRoom(d.room)}><span class="rn">{d.room.name}</span></button
					>
				{/if}
			{/each}
			<svg class="polys" width={bw} height={bh} aria-hidden={drawn.every((d) => d.rect) ? 'true' : undefined}>
				{#each drawn as d (d.room.id)}
					{#if !d.rect}
						{@const minX = Math.min(...d.pts.map((p) => p[0]))}
						{@const minY = Math.min(...d.pts.map((p) => p[1]))}
						<g
							class="poly"
							class:is-lit={!roomMode && litRooms.has(d.room.id)}
							class:is-sel={selRoom?.id === d.room.id}
							class:is-mute={roomMode && selRoom?.id !== d.room.id}
							class:is-ext={d.room.kind === 'exterior'}
							role="button"
							tabindex="0"
							aria-label={d.room.name}
							aria-pressed={selRoom?.id === d.room.id}
							onclick={() => pickRoom(d.room)}
							onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), pickRoom(d.room))}
						>
							<polygon points={d.pts.map((p) => `${sx(p[0])},${sy(p[1])}`).join(' ')} />
							{#if selRoom?.id === d.room.id}
								<polygon class="ring" points={d.pts.map((p) => `${sx(p[0])},${sy(p[1])}`).join(' ')} />
							{/if}
							<text x={sx(minX) + 4} y={sy(minY) + 11}>{d.room.name}</text>
						</g>
					{/if}
				{/each}
			</svg>
			{#each floorItems as i (i.id)}
				{@const lit = !roomMode && litIds.has(i.id)}
				<button
					type="button"
					class="it"
					class:is-lit={lit}
					class:is-dim={roomMode ? i.roomId !== selRoom?.id : litBs.length > 0 && !lit}
					class:is-pick={selItem?.id === i.id}
					style:left="{sx(i.x!)}px"
					style:top="{sy(i.y!)}px"
					aria-label={itemAria(i)}
					aria-pressed={selItem?.id === i.id}
					onclick={() => pickItem(i)}
				>
					<Icon name={i.type} size={12} />
				</button>
			{/each}
			<span class="pinch" aria-hidden="true">Pinch to zoom</span>
		{:else}
			<p class="nofloor">No floors yet.</p>
		{/if}
	</div>

	<div class="sel">
		{#if litBs.length || selItem}
			<div class="head">
				<span class="bnum big" class:warn={!litBs.length}>{slotsText(ix, litBs)}</span>
				<div class="ht">
					<span class="ov">{selItem ? 'Fed by' : 'Breaker'}</span>
					<span class="title">{litBs.length ? litBs.map((b) => ix.labelOf(b)).join(' + ') : 'No breaker yet'}</span>
					<span class="meta">
						{#if selItem}{selItem.name} · {ix.roomName(selItem.roomId)}{:else}{here.length} of {litItems.length} items on this floor{/if}
					</span>
				</div>
				<button type="button" class="ibtn clr" aria-label="Clear selection" onclick={() => go(NONE)}><Icon name="close" size={14} stroke={2.2} /></button>
			</div>
			{#each others as o (o.f.id)}
				<button type="button" class="btn more" onclick={() => go(sel, o.f.id)}>{o.n} more on {o.f.name}<span aria-hidden="true">→</span></button>
			{/each}
			{#if litBs.length}
				<a
					class="btn shut"
					href={resolve('/shutoff') + (litBs.length === 1 ? `?breaker=${litBs[0].id}` : `?item=${selItem?.id}`)}
					>Shut off {litBs.length === 1 ? 'breaker' : 'breakers'} {slotsText(ix, litBs)}</a
				>
			{/if}
			<div class="rows">
				{#each here as i (i.id)}
					<button type="button" class="srow" onclick={() => pickItem(i)}>
						<span class="ico"><Icon name={i.type} size={16} /></span>
						<span class="st"><span class="in">{i.name}</span><span class="iw">{ix.roomName(i.roomId)}</span></span>
					</button>
				{/each}
			</div>
		{:else if selRoom}
			<div class="head">
				<div class="ht">
					<span class="ov">Room · {ix.floorName(selRoom.floorId)}</span>
					<span class="title">{selRoom.name}</span>
					<span class="meta">{plural(roomItems.length, 'item')} on {plural(roomCircuits, 'circuit')}</span>
				</div>
				<button type="button" class="ibtn clr" aria-label="Clear selection" onclick={() => go(NONE)}><Icon name="close" size={14} stroke={2.2} /></button>
			</div>
			{#if roomCircuits}
				<a class="btn shut" href={resolve('/shutoff') + `?room=${selRoom.id}`}>Shut off this room · {plural(roomCircuits, 'breaker')}</a>
			{/if}
			<div class="rows">
				{#each roomItems as i (i.id)}
					{@const bs = ix.breakersOf(i)}
					<button type="button" class="srow" onclick={() => pickItem(i)}>
						<span class="ico"><Icon name={i.type} size={16} /></span>
						<span class="st"
							><span class="in">{i.name}</span><span class="iw">{bs.length ? bs.map((b) => ix.labelOf(b)).join(' + ') : 'No breaker'}</span></span
						>
						{#if bs.length}<span class="bnum">{slotsText(ix, bs)}</span>{/if}
					</button>
				{/each}
			</div>
		{:else}
			<p class="hint">Pick a circuit above, tap a room to see its circuits, or tap any item to find its breaker.</p>
		{/if}
	</div>
</div>

<style>
	.pm {
		flex: 1 1 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.ctl {
		flex-shrink: 0;
		padding: 10px 12px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		background: var(--raised);
		border-bottom: 1px solid var(--line-2);
	}
	.ctl .sb {
		flex: 1 1 0;
		justify-content: center;
		padding: 0 6px;
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--amber);
	}
	.ctl .inp {
		height: 42px;
	}
	.grid {
		height: 360px;
		flex-shrink: 0;
		position: relative;
		overflow: hidden;
		border-bottom: 1px solid var(--line-2);
		touch-action: none;
		user-select: none;
		background-color: var(--grid-bg);
		background-image:
			linear-gradient(var(--grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--grid-line) 1px, transparent 1px);
	}
	.plan {
		position: absolute;
		pointer-events: none;
		max-width: none;
	}
	.room {
		position: absolute;
		border: 1.5px solid var(--wall);
		background: var(--room);
		padding: 0;
		font: inherit;
		color: inherit;
		cursor: pointer;
		transition:
			background 0.3s,
			border-color 0.3s,
			opacity 0.3s;
	}
	.room.is-ext {
		border-style: dashed;
	}
	.room.is-lit {
		background: color-mix(in srgb, var(--amber) 16%, transparent);
		border-color: var(--room-lit-bd);
	}
	.room.is-sel {
		box-shadow: inset 0 0 0 2.5px var(--ink);
		background: var(--surface);
	}
	.room.is-mute,
	.poly.is-mute {
		opacity: 0.5;
	}
	.room:focus-visible {
		outline: 3px solid var(--focus);
		outline-offset: 2px;
	}
	.rn {
		position: absolute;
		left: 4px;
		top: 3px;
		font-size: 8px;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		font-stretch: 80%;
		color: var(--soft);
		pointer-events: none;
		white-space: nowrap;
	}
	.room.is-lit .rn {
		color: var(--room-lit-ink);
	}
	.room.is-sel .rn {
		color: var(--ink);
	}
	.polys {
		position: absolute;
		left: 0;
		top: 0;
		pointer-events: none;
		overflow: visible;
	}
	.poly {
		pointer-events: visiblePainted;
		cursor: pointer;
		transition: opacity 0.3s;
	}
	.poly polygon {
		fill: var(--room);
		stroke: var(--wall);
		stroke-width: 1.5;
	}
	.poly.is-ext polygon {
		stroke-dasharray: 5 3;
	}
	.poly.is-lit polygon {
		fill: color-mix(in srgb, var(--amber) 16%, transparent);
		stroke: var(--room-lit-bd);
	}
	.poly.is-sel polygon {
		fill: var(--surface);
	}
	.poly polygon.ring {
		fill: none;
		stroke: var(--ink);
		stroke-width: 2.5;
	}
	.poly:focus-visible {
		outline: none;
	}
	.poly:focus-visible polygon {
		stroke: var(--focus);
		stroke-width: 3;
	}
	.poly text {
		font-size: 8px;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		font-stretch: 80%;
		fill: var(--soft);
		pointer-events: none;
	}
	.it {
		position: absolute;
		width: 24px;
		height: 24px;
		margin: -12px 0 0 -12px;
		border-radius: 50%;
		border: 1.5px solid var(--ink);
		background: var(--surface);
		color: var(--ink);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		cursor: pointer;
		transition:
			opacity 0.3s,
			background 0.3s;
	}
	.it.is-lit {
		background: var(--amber);
		color: var(--on-amber);
	}
	.it.is-dim {
		opacity: 0.25;
	}
	.it.is-pick {
		box-shadow:
			0 0 0 2px var(--surface),
			0 0 0 4px var(--amber);
		z-index: 2;
	}
	.it:focus-visible {
		outline: 3px solid var(--focus);
		outline-offset: 2px;
	}
	.pinch {
		position: absolute;
		right: 10px;
		bottom: 8px;
		font-size: 11px;
		color: var(--muted);
		pointer-events: none;
	}
	.nofloor {
		margin: 0;
		padding: 16px;
		color: var(--muted);
		font-size: 14px;
	}
	.sel {
		flex: 1 1 0;
		min-height: 0;
		overflow: auto;
		background: var(--surface);
		padding: 14px 16px 16px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.head {
		display: flex;
		align-items: flex-start;
		gap: 12px;
	}
	.bnum.big {
		height: 36px;
		min-width: 46px;
		font-size: 14px;
		background: var(--amber);
		color: var(--on-amber);
	}
	.bnum.big.warn {
		background: var(--warn);
		color: var(--surface);
	}
	.ht {
		flex-grow: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.title {
		font-size: 18px;
		font-weight: 800;
		font-stretch: 105%;
		line-height: 1.2;
	}
	.meta {
		font-size: 13px;
		color: var(--muted);
	}
	.clr {
		width: 40px;
		height: 40px;
	}
	.btn.more {
		justify-content: space-between;
		height: 40px;
		flex-shrink: 0;
	}
	.btn.shut {
		height: 44px;
		flex-shrink: 0;
		background: var(--amber);
		color: var(--on-amber);
		border-color: var(--amber);
	}
	.btn.shut:hover {
		background: var(--amber-h);
		border-color: var(--amber-h);
		color: var(--on-amber);
	}
	.rows {
		display: flex;
		flex-direction: column;
	}
	.srow {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		min-height: 50px;
		padding: 6px 0;
		border: 0;
		border-bottom: 1px solid var(--line);
		background: transparent;
		font: inherit;
		color: var(--ink);
		text-align: left;
		cursor: pointer;
	}
	.st {
		flex-grow: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.hint {
		margin: 0;
		font-size: 14px;
		color: var(--muted);
		line-height: 1.5;
	}
</style>
