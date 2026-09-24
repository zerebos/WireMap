<script lang="ts">
	import { tick } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import PlanPopover from './PlanPopover.svelte';
	import { mutate, plural, type HouseIndex, type HouseItem } from '$lib/house';
	import { createItem, createRoom, placeItem } from '$lib/db/ops';
	import type { Room } from '$lib/db/schema';
	import { planUrl } from '$lib/plans';
	import { ITEM_TYPES, ITEM_TYPE_LABELS, type ItemType } from '$lib/constants';
	import { pointsOf, roomAt, type Point, type Rect } from '$lib/shape';
	import {
		NONE,
		PLAN_ACCEPT,
		itemsOn,
		litBreakers,
		midSentence,
		planBox,
		shapeOfRoom,
		roomBreakerCount,
		roomGroups,
		slotsText,
		uploadPlan,
		type Sel,
		type Tool
	} from './model';

	let {
		ix,
		sel,
		floorId,
		fade,
		tool = $bindable('select'),
		hovB = $bindable(null),
		moving = $bindable(null),
		go,
		onedit
	}: {
		ix: HouseIndex;
		sel: Sel;
		floorId: number | null;
		/** Settings → "Fade other items on the map". */
		fade: boolean;
		tool?: Tool;
		hovB?: number | null;
		moving?: number | null;
		go: (sel: Sel, floor?: number | null) => void;
		/** Switches to layout editing (DESIGN.md §5.10); absent when the viewer can't edit. */
		onedit?: () => void;
	} = $props();

	const floor = $derived(floorId === null ? null : (ix.floorById.get(floorId) ?? null));
	const floorRooms = $derived(ix.house.rooms.filter((r) => r.floorId === floorId));
	const floorItems = $derived(ix.house.items.filter((i) => i.floorId === floorId && i.x !== null && i.y !== null));

	// ---- Selection → what lights up
	const roomMode = $derived(sel.kind === 'room');
	const selRoom = $derived(sel.kind === 'room' ? (ix.roomById.get(sel.id) ?? null) : null);
	const selItem = $derived(sel.kind === 'item' ? (ix.house.items.find((i) => i.id === sel.id) ?? null) : null);
	const litBs = $derived(litBreakers(ix, sel));
	const litItems = $derived(itemsOn(ix, litBs.map((b) => b.id)));
	const litIds = $derived(new Set(roomMode ? (hovB === null ? [] : ix.itemsOf(hovB).map((i) => i.id)) : litItems.map((i) => i.id)));
	const litRooms = $derived(new Set(roomMode ? [] : litItems.filter((i) => i.floorId === floorId).map((i) => i.roomId)));
	/** Floors holding items of the current selection. */
	const dotFloors = $derived(new Set(litItems.map((i) => i.floorId)));

	// ---- Status chip
	const here = $derived(litItems.filter((i) => i.floorId === floorId).length);
	const others = $derived(
		ix.house.floors
			.filter((f) => f.id !== floorId)
			.map((f) => ({ f, n: litItems.filter((i) => i.floorId === f.id).length }))
			.filter((o) => o.n > 0)
	);
	const chip = $derived.by(() => {
		if (litBs.length === 1) {
			const b = litBs[0];
			return { title: `Breaker ${ix.slotOf(b)} · ${ix.labelOf(b)}`, meta: `${here} of ${litItems.length} on this floor` };
		}
		if (litBs.length > 1) return { title: `Breakers ${slotsText(ix, litBs)}`, meta: `${here} of ${litItems.length} on this floor` };
		if (selItem) return { title: selItem.name, meta: 'No breaker' };
		if (selRoom) {
			const n = roomBreakerCount(roomGroups(ix, selRoom));
			return {
				title: `${selRoom.name} · ${ix.floorName(selRoom.floorId)}`,
				meta: `${plural(ix.itemsInRoom(selRoom.id).length, 'item')} on ${plural(n, 'circuit')}`
			};
		}
		return null;
	});

	// ---- View: zoom and pan. Map units → screen px: x * z + px.
	let grid: HTMLDivElement | undefined = $state();
	let cw = $state(800);
	let ch = $state(600);
	let z = $state(1);
	let px = $state(0);
	let py = $state(20);
	const sx = (x: number) => x * z + px;
	const sy = (y: number) => y * z + py;
	const MIN_Z = 0.25;
	const MAX_Z = 4;

	function zoomAt(f: number, cx = cw / 2, cy = ch / 2) {
		const nz = Math.min(MAX_Z, Math.max(MIN_Z, z * f));
		px = cx - ((cx - px) * nz) / z;
		py = cy - ((cy - py) * nz) / z;
		z = nz;
	}
	function fit() {
		if (!floor) return;
		const pad = 20;
		const nz = Math.min(MAX_Z, Math.max(MIN_Z, Math.min((cw - pad * 2) / floor.planWidth, (ch - pad * 2) / floor.planHeight)));
		z = nz;
		px = (cw - floor.planWidth * nz) / 2;
		py = (ch - floor.planHeight * nz) / 2;
	}
	$effect(() => {
		if (!grid) return;
		const el = grid;
		const onWheel = (e: WheelEvent) => {
			if ((e.target as Element).closest('.ovl')) return;
			e.preventDefault();
			const r = el.getBoundingClientRect();
			zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
		};
		el.addEventListener('wheel', onWheel, { passive: false });
		return () => el.removeEventListener('wheel', onWheel);
	});

	function toPlan(e: { clientX: number; clientY: number }): Point {
		const r = grid!.getBoundingClientRect();
		return [(e.clientX - r.left - px) / z, (e.clientY - r.top - py) / z];
	}
	const clamp = (p: Point): Point =>
		floor ? [Math.min(Math.max(p[0], 0), floor.planWidth), Math.min(Math.max(p[1], 0), floor.planHeight)] : p;
	/** Snaps to a 10-unit grid. */
	const snap = (p: Point): Point => clamp([Math.round(p[0] / 10) * 10, Math.round(p[1] / 10) * 10]);

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
	let planOpen = $state(false);
	let opacity = $state(0.35);
	$effect(() => {
		opacity = floor?.planOpacity ?? 0.35;
	});

	// ---- Rooms
	const movingItem = $derived(moving !== null && selItem?.id === moving ? selItem : null);
	/** Clicks on the map place something rather than select. */
	const placing = $derived(tool !== 'select' || movingItem !== null);

	type Drawn = { room: Room; pts: Point[]; rect: Rect | null };
	const drawn: Drawn[] = $derived(
		floorRooms.flatMap((room) => {
			const shape = shapeOfRoom(room);
			return shape ? [{ room, pts: pointsOf(shape), rect: shape.type === 'rect' ? shape : null }] : [];
		})
	);
	const roomAria = (r: Room) => `${r.name}, ${plural(ix.itemsInRoom(r.id).length, 'item')}`;

	function pickRoom(r: Room) {
		if (placing) return;
		go(selRoom?.id === r.id ? NONE : { kind: 'room', id: r.id });
	}
	function pickItem(i: HouseItem) {
		if (placing) return;
		go({ kind: 'item', id: i.id });
	}
	const itemAria = (i: HouseItem) => {
		const bs = ix.breakersOf(i);
		return `${i.name}, ${ix.typeLabel(i)}, ${ix.roomName(i.roomId)}, ${bs.length ? `breaker ${slotsText(ix, bs)}` : 'no breaker'}`;
	};

	// ---- Pointer: pan on empty grid (or rooms), drag rectangles
	type Drag = { kind: 'pan'; x0: number; y0: number; px0: number; py0: number; moved: boolean } | { kind: 'draw'; a: Point; b: Point };
	let drag = $state<Drag | null>(null);
	let suppressClick = false;
	let hover = $state<Point | null>(null);
	let pendingRect = $state<Rect | null>(null);
	let newName = $state('');
	let nameError = $state('');
	let nameInput: HTMLInputElement | undefined = $state();

	const inOverlay = (e: Event) => !!(e.target as Element).closest('.ovl');

	function onpointerdown(e: PointerEvent) {
		if (e.button !== 0 || inOverlay(e) || !floor) return;
		suppressClick = false;
		if ((e.target as Element).closest('.it')) return;
		if (tool === 'room' && !pendingRect) {
			const a = snap(toPlan(e));
			drag = { kind: 'draw', a, b: a };
			grid!.setPointerCapture(e.pointerId);
			e.preventDefault();
			return;
		}
		drag = { kind: 'pan', x0: e.clientX, y0: e.clientY, px0: px, py0: py, moved: false };
	}
	function onpointermove(e: PointerEvent) {
		hover = inOverlay(e) ? null : toPlan(e);
		const d = drag;
		if (!d) return;
		if (d.kind === 'draw') {
			d.b = snap(toPlan(e));
		} else if (d.kind === 'pan') {
			if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 4) return;
			if (!d.moved) grid!.setPointerCapture(e.pointerId);
			d.moved = true;
			px = d.px0 + e.clientX - d.x0;
			py = d.py0 + e.clientY - d.y0;
		}
	}
	async function onpointerup() {
		const d = drag;
		drag = null;
		if (!d) return;
		if (d.kind === 'pan') {
			if (d.moved) suppressClick = true;
		} else if (d.kind === 'draw') {
			const x = Math.min(d.a[0], d.b[0]);
			const y = Math.min(d.a[1], d.b[1]);
			const w = Math.abs(d.a[0] - d.b[0]);
			const h = Math.abs(d.a[1] - d.b[1]);
			if (w < 20 || h < 20) return;
			pendingRect = { x, y, w, h };
			newName = '';
			nameError = '';
			await tick();
			nameInput?.focus();
		}
	}

	async function onclick(e: MouseEvent) {
		if (inOverlay(e) || !floor) return;
		if (suppressClick) {
			suppressClick = false;
			return;
		}
		const p = clamp(toPlan(e));
		const at: Point = [Math.round(p[0]), Math.round(p[1])];
		const inside = roomAt(at, floorRooms);
		if (movingItem) {
			const it = movingItem;
			const f = floor.id;
			moving = null;
			await mutate(() => placeItem(it.id, f, at[0], at[1]));
		} else if (tool === 'place') {
			const type = placeType;
			const f = floor.id;
			const id = await mutate(() =>
				createItem({ type, name: `New ${ITEM_TYPE_LABELS[type].one.toLowerCase()}`, floorId: f, roomId: inside?.id ?? null, x: at[0], y: at[1] })
			);
			go({ kind: 'item', id }, f);
		}
	}

	async function saveRoom() {
		if (!pendingRect || !floor) return;
		const name = newName.trim();
		if (!name) return void (nameError = 'Give the room a name.');
		if (floorRooms.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
			nameError = `There's already a ${name} on this floor.`;
			return;
		}
		const shape = { type: 'rect' as const, ...pendingRect };
		const f = floor.id;
		pendingRect = null;
		await mutate(() => createRoom({ floorId: f, name, kind: 'interior', shape }));
	}
	function nameKey(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			saveRoom();
		} else if (e.key === 'Escape') {
			e.stopPropagation();
			pendingRect = null;
		}
	}

	// ---- Tools
	let placeType = $state<ItemType>('outlet');
	function setTool(t: Tool) {
		tool = t;
		pendingRect = null;
		moving = null;
	}
	function onkeydown(e: KeyboardEvent) {
		if (e.key !== 'Escape' || e.defaultPrevented) return;
		if ((e.target as Element).closest?.('input, textarea, select')) return;
		if (drag?.kind === 'draw') drag = null;
		else if (pendingRect) pendingRect = null;
		else if (moving !== null) moving = null;
		else if (tool !== 'select') setTool('select');
		else if (planOpen) planOpen = false;
	}

	const ghostRect = $derived.by((): Rect | null => {
		if (drag?.kind !== 'draw') return pendingRect;
		const x = Math.min(drag.a[0], drag.b[0]);
		const y = Math.min(drag.a[1], drag.b[1]);
		return { x, y, w: Math.abs(drag.a[0] - drag.b[0]), h: Math.abs(drag.a[1] - drag.b[1]) };
	});
	const ghostType = $derived<ItemType | null>(movingItem ? movingItem.type : tool === 'place' ? placeType : null);
	const traced = $derived(floorRooms.filter((r) => shapeOfRoom(r)).length);
	const zoomText = $derived(`${Math.round(z * 100)}%`);

	// ---- Empty floor (DESIGN.md §5.9): no rooms yet.
	const noRooms = $derived(!!floor && floorRooms.length === 0);
	/** The "Map the floor" card: no rooms and no plan, while nothing else is going on. */
	const showCard = $derived(noRooms && !floor?.planImage && tool === 'select' && !movingItem);
	// A floor with a plan but no rooms opens straight into drawing, over the plan.
	const drawFirst = $derived(noRooms && !!floor?.planImage ? floorId : null);
	$effect(() => {
		if (drawFirst !== null) setTool('room');
	});
	let cardInput: HTMLInputElement | undefined = $state();
	let cardError = $state('');
	let cardBusy = $state(false);
	let cardOver = $state(false);
	async function cardFile(file: File | undefined) {
		if (!file || !floor) return;
		cardBusy = true;
		cardError = await uploadPlan(floor.id, file);
		cardBusy = false;
		if (cardInput) cardInput.value = '';
	}
	function cardDrop(e: DragEvent) {
		e.preventDefault();
		cardOver = false;
		cardFile(e.dataTransfer?.files[0]);
	}
	$effect(() => {
		void floorId;
		cardError = '';
	});

	function pickFloor(id: number) {
		hovB = null;
		pendingRect = null;
		go(sel.kind === 'room' ? NONE : sel, id);
	}
</script>

<svelte:window {onkeydown} />

<section aria-label="Floor map" class="mapcol">
	<div class="bar">
		<div class="seg" role="group" aria-label="Floor">
			{#each ix.house.floors as f (f.id)}
				<button type="button" class="sb" class:is-on={f.id === floorId} aria-pressed={f.id === floorId} onclick={() => pickFloor(f.id)}>
					{f.name}{#if dotFloors.has(f.id)}<span class="fdot"><span class="sr">(has lit items)</span></span>{/if}
				</button>
			{/each}
		</div>
		<div class="grow"></div>
		<div class="seg" role="group" aria-label="Tool">
			<button type="button" class="sb" class:is-on={tool === 'select'} aria-pressed={tool === 'select'} onclick={() => setTool('select')}
				><Icon name="cursor" size={16} /><span class="tl">Select</span></button
			>
			<button type="button" class="sb" class:is-on={tool === 'room'} aria-pressed={tool === 'room'} disabled={!floor} onclick={() => setTool('room')}
				><Icon name="room" size={16} /><span class="tl">Draw room</span></button
			>
			<button type="button" class="sb" class:is-on={tool === 'place'} aria-pressed={tool === 'place'} disabled={!floor} onclick={() => setTool('place')}
				><Icon name="pin" size={16} /><span class="tl">Place item</span></button
			>
		</div>
		<button type="button" class="sb planbtn" class:is-on={planOpen} aria-expanded={planOpen} disabled={!floor} onclick={() => (planOpen = !planOpen)}
			><Icon name="image" size={16} /><span class="tl">Floor plan</span></button
		>
		{#if onedit}
			<button type="button" class="btn editbtn" disabled={!floor} onclick={onedit}><Icon name="pencil" size={14} stroke={2.2} />Edit layout</button>
		{/if}
	</div>

	<!-- Pointer handling for pan and drawing; every action here also has a keyboard path
	     (rooms and items are buttons, zoom has buttons, corners take arrow keys). -->
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		class="grid"
		class:placing
		class:panning={drag?.kind === 'pan' && drag.moved}
		bind:this={grid}
		bind:clientWidth={cw}
		bind:clientHeight={ch}
		style:background-size="{20 * z}px {20 * z}px"
		style:background-position="{px}px {py}px"
		{onpointerdown}
		{onpointermove}
		{onpointerup}
		onpointercancel={() => (drag = null)}
		onpointerleave={() => (hover = null)}
		{onclick}
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
					style:opacity={opacity}
				/>
			{/if}

			{#each drawn as d (d.room.id)}
				{#if d.rect}
					<button
						type="button"
						class="room"
						class:is-lit={litRooms.has(d.room.id)}
						class:is-sel={selRoom?.id === d.room.id}
						class:is-mute={roomMode && selRoom?.id !== d.room.id}
						class:is-ext={d.room.kind === 'exterior'}
						class:no-pick={placing}
						style:left="{sx(d.rect.x)}px"
						style:top="{sy(d.rect.y)}px"
						style:width="{d.rect.w * z}px"
						style:height="{d.rect.h * z}px"
						aria-label={roomAria(d.room)}
						aria-pressed={selRoom?.id === d.room.id}
						onclick={() => pickRoom(d.room)}><span class="rn">{d.room.name}</span></button
					>
				{/if}
			{/each}
			<svg class="polys" width={cw} height={ch} aria-hidden={drawn.every((d) => d.rect) ? 'true' : undefined}>
				{#each drawn as d (d.room.id)}
					{#if !d.rect}
						{@const minX = Math.min(...d.pts.map((p) => p[0]))}
						{@const minY = Math.min(...d.pts.map((p) => p[1]))}
						<g
							class="poly"
							class:is-lit={litRooms.has(d.room.id)}
							class:is-sel={selRoom?.id === d.room.id}
							class:is-mute={roomMode && selRoom?.id !== d.room.id}
							class:is-ext={d.room.kind === 'exterior'}
							class:no-pick={placing}
							role="button"
							tabindex="0"
							aria-label={roomAria(d.room)}
							aria-pressed={selRoom?.id === d.room.id}
							onclick={() => pickRoom(d.room)}
							onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), pickRoom(d.room))}
						>
							<polygon points={d.pts.map((p) => `${sx(p[0])},${sy(p[1])}`).join(' ')} />
							{#if selRoom?.id === d.room.id}
								<polygon class="ring" points={d.pts.map((p) => `${sx(p[0])},${sy(p[1])}`).join(' ')} />
							{/if}
							<text x={sx(minX) + 10} y={sy(minY) + 19}>{d.room.name}</text>
						</g>
					{/if}
				{/each}
			</svg>

			{#if ghostRect}
				<div
					class="ghostroom"
					style:left="{sx(ghostRect.x)}px"
					style:top="{sy(ghostRect.y)}px"
					style:width="{ghostRect.w * z}px"
					style:height="{ghostRect.h * z}px"
				>
					<span class="mono">New room</span>
				</div>
			{:else if tool === 'room' && noRooms}
				<div class="ghostroom first" aria-hidden="true"><span class="mono">New room</span></div>
			{/if}

			{#if showCard}
				<div class="cardwrap">
					<div class="mapcard ovl">
						<div class="mh">
							<h2>Map the {midSentence(floor.name)}</h2>
							<p>Trace over a floor plan image, or draw rooms straight onto the grid. Rough is fine — rooms only need to be close enough to tap.</p>
						</div>
						<input
							bind:this={cardInput}
							class="sr"
							type="file"
							accept={PLAN_ACCEPT.join(',')}
							tabindex="-1"
							aria-hidden="true"
							onchange={(e) => cardFile(e.currentTarget.files?.[0])}
						/>
						<div class="opts">
							<button
								type="button"
								class="opt drop"
								class:over={cardOver}
								disabled={cardBusy}
								onclick={() => cardInput?.click()}
								ondragover={(e) => {
									e.preventDefault();
									cardOver = true;
								}}
								ondragleave={() => (cardOver = false)}
								ondrop={cardDrop}
							>
								<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
									><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg
								>
								<span class="ot">Upload a floor plan</span>
								<span class="os">{cardBusy ? 'Uploading…' : 'Drop a PNG, JPG or WebP here'}</span>
							</button>
							<button type="button" class="opt" onclick={() => setTool('room')}>
								<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"
									><rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="3 2.5" /></svg
								>
								<span class="ot">Draw rooms</span>
								<span class="os">Drag rectangles on the grid</span>
							</button>
						</div>
						{#if cardError}<span class="err" role="alert">{cardError}</span>{/if}
						<span class="mfoot">No plan handy? A photo of a sketch works, or an export from a real-estate listing.</span>
					</div>
				</div>
			{/if}

			{#each floorItems as i (i.id)}
				{@const lit = litIds.has(i.id)}
				{@const mine = roomMode && i.roomId === selRoom?.id}
				{@const bs = ix.breakersOf(i)}
				<button
					type="button"
					class="it"
					class:is-lit={lit}
					class:is-dim={roomMode ? !mine && !lit : fade && litBs.length > 0 && !lit}
					class:is-pick={selItem?.id === i.id}
					style:left="{sx(i.x!) - 16}px"
					style:top="{sy(i.y!) - 16}px"
					aria-label={itemAria(i)}
					aria-pressed={selItem?.id === i.id}
					onclick={() => pickItem(i)}
				>
					<Icon name={i.type} size={16} />
					{#if mine}<span class="bdg" class:warn={!bs.length}>{slotsText(ix, bs, '+')}</span>{/if}
				</button>
			{/each}

			{#if ghostType && hover && !drag}
				<div class="ghost" style:left="{sx(hover[0]) - 16}px" style:top="{sy(hover[1]) - 16}px">
					<div class="gm"><Icon name={ghostType} size={16} /></div>
					<span>Click to place</span>
				</div>
			{/if}
		{:else}
			<div class="nofloor ovl">No floors yet. Add one in Settings → Floors.</div>
		{/if}

		<div class="stackr ovl">
			{#if tool === 'room'}
				<div class="banner">
					{#if pendingRect}
						<form
							class="nameform"
							onsubmit={(e) => {
								e.preventDefault();
								saveRoom();
							}}
						>
							<label for="new-room" class="nl"><strong>Name this room</strong></label>
							<div class="nrow">
								<input id="new-room" class="inp" bind:this={nameInput} bind:value={newName} onkeydown={nameKey} placeholder="e.g. Kitchen" />
								<button type="submit" class="btn btn-pri h36">Save</button>
								<button type="button" class="btn h36" onclick={() => (pendingRect = null)}>Cancel</button>
							</div>
							{#if nameError}<span class="err" role="alert">{nameError}</span>{/if}
						</form>
					{:else}
						<span class="bt"><strong>Drag on the grid</strong> to draw {noRooms ? 'your first' : 'a'} room. Release to name it.</span>
						<button type="button" class="btn h36" onclick={() => setTool('select')}>Done</button>
					{/if}
				</div>
			{:else if tool === 'place'}
				<div class="banner col">
					<span class="bt"><strong>Place an item</strong> where it really is, then pick its breaker.</span>
					<div class="types" role="group" aria-label="Item type">
						{#each ITEM_TYPES as t (t)}
							<button type="button" class="pt" class:is-on={placeType === t} aria-pressed={placeType === t} onclick={() => (placeType = t)}
								>{ITEM_TYPE_LABELS[t].one}</button
							>
						{/each}
					</div>
				</div>
			{/if}
			{#if movingItem}
				<div class="banner">
					<span class="bt"><strong>Click the map</strong> where {movingItem.name} really is.</span>
					<button type="button" class="btn h36" onclick={() => (moving = null)}>Cancel</button>
				</div>
			{/if}
			{#if planOpen && floor}
				<PlanPopover {floor} src={planSrc} {traced} bind:opacity onclose={() => (planOpen = false)} />
			{/if}
		</div>

		<div class="bottom">
			{#if chip}
				<div class="stchip inv ovl" role="status">
					<span class="dot"></span>
					<span class="ct">{chip.title}</span>
					<span class="cmeta">{chip.meta}</span>
					{#each others as o (o.f.id)}
						<button type="button" class="chipbtn" onclick={() => go(sel, o.f.id)}>{o.n} on {o.f.name} →</button>
					{/each}
					<button type="button" class="chipbtn" onclick={() => go(NONE)}>Clear</button>
				</div>
			{:else if !showCard}
				<div class="hintchip ovl">Pick a circuit, click a room, or click an item.</div>
			{/if}
			{#if !showCard}
				<div class="zoom ovl">
					<button type="button" class="zb" aria-label="Zoom out" onclick={() => zoomAt(1 / 1.25)}>−</button>
					<span class="mono zt" aria-live="polite">{zoomText}</span>
					<button type="button" class="zb" aria-label="Zoom in" onclick={() => zoomAt(1.25)}>+</button>
					<button type="button" class="zb fit" aria-label="Fit floor to screen" onclick={fit}><Icon name="fit" size={16} /></button>
				</div>
			{/if}
		</div>
	</div>
</section>

<style>
	.mapcol {
		container-type: inline-size;
		flex: 1 1 0;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.bar {
		height: 60px;
		flex-shrink: 0;
		padding: 0 16px;
		display: flex;
		align-items: center;
		gap: 12px;
		background: var(--raised);
		border-bottom: 1px solid var(--line-2);
	}
	.bar .sb {
		padding: 0 14px;
	}
	.bar .sb:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.grow {
		flex-grow: 1;
	}
	/* The toolbar holds floors, tools, Floor plan and Edit layout; when the canvas is narrow
	   (the 1440 reference leaves it 820px) the tool labels give way to their icons. */
	@container (max-width: 960px) {
		.bar .tl {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip: rect(0 0 0 0);
			white-space: nowrap;
		}
		.bar .sb:has(.tl) {
			padding: 0 11px;
		}
	}
	.editbtn {
		height: 38px;
		padding: 0 12px;
	}
	.planbtn {
		border: 1px solid var(--field);
	}
	/* The dot eats into the button's right padding so the toolbar barely grows when dots appear. */
	.fdot {
		width: 7px;
		height: 7px;
		flex-shrink: 0;
		margin: 0 -6px 0 -2px;
		border-radius: 50%;
		background: var(--amber);
		box-shadow: 0 0 0 2px var(--surface);
		position: relative;
	}

	.grid {
		flex-grow: 1;
		min-height: 0;
		position: relative;
		overflow: hidden;
		touch-action: none;
		user-select: none;
		background-color: var(--grid-bg);
		background-image:
			linear-gradient(var(--grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--grid-line) 1px, transparent 1px);
	}
	.grid.placing {
		cursor: crosshair;
	}
	.grid.panning {
		cursor: grabbing;
	}
	.plan {
		position: absolute;
		pointer-events: none;
		max-width: none;
	}

	/* Rooms */
	.room {
		position: absolute;
		border: 2px solid var(--wall);
		background: var(--room);
		transition:
			background 0.3s,
			border-color 0.3s,
			opacity 0.3s;
		padding: 0;
		margin: 0;
		font: inherit;
		color: inherit;
		cursor: pointer;
		text-align: left;
	}
	.room:hover {
		border-color: var(--ink);
	}
	.room.is-ext {
		border-style: dashed;
	}
	.room.is-lit {
		background: color-mix(in srgb, var(--amber) 15%, transparent);
		border-color: var(--room-lit-bd);
	}
	.room.is-sel {
		box-shadow: inset 0 0 0 3px var(--ink);
		background: var(--surface);
	}
	.room.is-mute {
		opacity: 0.5;
	}
	.room.no-pick,
	.poly.no-pick {
		cursor: crosshair;
	}
	.room:focus-visible {
		outline: 3px solid var(--focus);
		outline-offset: -3px;
	}
	.rn {
		position: absolute;
		left: 10px;
		top: 8px;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		font-stretch: 85%;
		color: var(--soft);
		pointer-events: none;
		white-space: nowrap;
		max-width: calc(100% - 16px);
		overflow: hidden;
		text-overflow: ellipsis;
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
		stroke-width: 2;
		transition:
			fill 0.3s,
			stroke 0.3s;
	}
	.poly:hover polygon {
		stroke: var(--ink);
	}
	.poly.is-ext polygon {
		stroke-dasharray: 6 4;
	}
	.poly.is-lit polygon {
		fill: color-mix(in srgb, var(--amber) 15%, transparent);
		stroke: var(--room-lit-bd);
	}
	.poly.is-sel polygon {
		fill: var(--surface);
	}
	.poly polygon.ring {
		fill: none;
		stroke: var(--ink);
		stroke-width: 3;
		pointer-events: none;
	}
	.poly.is-mute {
		opacity: 0.5;
	}
	.poly:focus-visible {
		outline: none;
	}
	.poly:focus-visible polygon {
		stroke: var(--focus);
		stroke-width: 3;
	}
	.poly text {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		font-stretch: 85%;
		fill: var(--soft);
		pointer-events: none;
	}
	.poly.is-lit text {
		fill: var(--room-lit-ink);
	}
	.poly.is-sel text {
		fill: var(--ink);
	}

	.ghostroom {
		position: absolute;
		border: 2px dashed var(--ink);
		background: color-mix(in srgb, var(--amber) 12%, transparent);
		display: flex;
		align-items: center;
		justify-content: flex-end;
		padding: 0 10px;
		pointer-events: none;
	}
	/* The example rectangle shown before the first room is drawn. */
	.ghostroom.first {
		left: 60px;
		top: 60px;
		width: 300px;
		height: 240px;
		align-items: flex-end;
		padding: 8px;
	}

	/* "Map the floor" card, on a floor with no rooms */
	.cardwrap {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 16px;
		pointer-events: none;
		z-index: 5;
	}
	.mapcard {
		pointer-events: auto;
		cursor: default;
		width: 560px;
		max-width: 100%;
		background: var(--surface);
		border: 1px solid var(--line-2);
		border-radius: var(--r-2xl);
		padding: 28px;
		display: flex;
		flex-direction: column;
		gap: 20px;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.12);
		user-select: text;
	}
	.mh {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.mh h2 {
		font-size: 26px;
		font-weight: 800;
		font-stretch: 108%;
	}
	.mh p {
		margin: 0;
		font-size: 15px;
		line-height: 1.55;
		color: var(--soft);
	}
	.opts {
		display: flex;
		gap: 12px;
	}
	.opt {
		flex: 1 1 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		padding: 24px 18px;
		border: 1.5px solid var(--line-2);
		border-radius: var(--r-xl);
		background: var(--surface);
		font: inherit;
		color: var(--ink);
		text-align: center;
		cursor: pointer;
	}
	.opt:hover,
	.opt.over {
		border-color: var(--btn-bd-h);
	}
	.opt.drop {
		border-style: dashed;
	}
	.opt:disabled {
		cursor: default;
	}
	.opt:focus-visible {
		outline: 3px solid var(--focus);
		outline-offset: 2px;
	}
	.ot {
		font-size: 15px;
		font-weight: 700;
	}
	.os {
		font-size: 13px;
		color: var(--muted);
	}
	.mfoot {
		font-size: 13px;
		color: var(--muted);
		line-height: 1.5;
	}

	.ghostroom span {
		font-size: 11px;
		background: var(--ink);
		color: var(--surface);
		padding: 3px 6px;
		border-radius: var(--r-xs);
	}

	/* Item markers */
	.it {
		position: absolute;
		width: var(--map-marker);
		height: var(--map-marker);
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
			background 0.3s,
			transform 0.12s;
	}
	.it:hover {
		transform: scale(1.12);
		z-index: 3;
	}
	.it.is-lit {
		background: var(--amber);
		color: var(--on-amber);
		border-color: var(--on-amber);
		animation: lit 1.4s ease-out 2;
	}
	.it.is-dim {
		opacity: 0.28;
	}
	.it.is-pick {
		box-shadow:
			0 0 0 3px var(--surface),
			0 0 0 5.5px var(--ink);
		z-index: 2;
	}
	.placing .it {
		pointer-events: none;
	}
	@keyframes lit {
		0% {
			box-shadow: 0 0 0 0 color-mix(in srgb, var(--amber) 75%, transparent);
		}
		100% {
			box-shadow: 0 0 0 14px color-mix(in srgb, var(--amber) 0%, transparent);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.it.is-lit {
			animation: none;
		}
		.it,
		.room,
		.poly,
		.poly polygon {
			transition: none;
		}
	}
	.bdg {
		position: absolute;
		top: -9px;
		right: -13px;
		min-width: 18px;
		height: 17px;
		padding: 0 4px;
		border-radius: var(--r-sm);
		background: var(--handle);
		color: var(--hdr-fg);
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 600;
		display: flex;
		align-items: center;
		justify-content: center;
		pointer-events: none;
		box-shadow: 0 0 0 1.5px var(--surface);
		white-space: nowrap;
	}
	.bdg.warn {
		background: var(--warn);
		color: var(--surface);
	}

	.ghost {
		position: absolute;
		display: flex;
		align-items: center;
		gap: 8px;
		pointer-events: none;
		z-index: 5;
	}
	.ghost .gm {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		border: 2px dashed var(--ink);
		background: var(--ghost);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--ink);
	}
	.ghost span {
		font-size: 12px;
		font-weight: 600;
		background: var(--ink);
		color: var(--surface);
		padding: 4px 8px;
		border-radius: var(--r-sm);
		white-space: nowrap;
	}

	/* Overlays */
	.nofloor {
		position: absolute;
		left: 16px;
		top: 16px;
		background: var(--surface);
		border: 1px solid var(--line-2);
		border-radius: var(--r-xl);
		padding: 10px 14px;
		font-size: 13px;
		color: var(--soft);
	}
	.stackr {
		position: absolute;
		top: 16px;
		right: 16px;
		width: 360px;
		display: flex;
		flex-direction: column;
		gap: 10px;
		align-items: stretch;
		z-index: 6;
		cursor: default;
	}
	.banner {
		background: var(--surface);
		border: 1px solid var(--ink);
		border-radius: var(--r-xl);
		padding: 12px 12px 12px 16px;
		display: flex;
		align-items: center;
		gap: 12px;
		box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
	}
	.banner.col {
		flex-direction: column;
		align-items: stretch;
		gap: 10px;
		padding: 14px 16px;
	}
	.bt {
		flex-grow: 1;
		font-size: 14px;
		line-height: 1.4;
	}
	.h36 {
		height: 36px;
	}
	.nameform {
		flex-grow: 1;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.nl {
		font-size: 14px;
	}
	.nrow {
		display: flex;
		gap: 6px;
	}
	.nrow .inp {
		height: 36px;
		min-width: 0;
	}
	.nrow .btn {
		padding: 0 12px;
	}
	.err {
		font-size: 13px;
		color: var(--warn);
	}
	.types {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}
	.pt {
		height: 34px;
		padding: 0 10px;
		border: 1px solid var(--field);
		border-radius: var(--r-md);
		background: var(--surface);
		font: inherit;
		font-size: 13px;
		font-weight: 600;
		color: var(--ink);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.pt.is-on {
		background: var(--ink);
		color: var(--surface);
		border-color: var(--ink);
	}

	.bottom {
		position: absolute;
		left: 16px;
		right: 16px;
		bottom: 14px;
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 12px;
		pointer-events: none;
		z-index: 6;
	}
	.bottom > * {
		pointer-events: auto;
		cursor: default;
	}
	.stchip {
		display: flex;
		align-items: center;
		gap: 12px;
		border-radius: var(--r-xl);
		padding: 7px 7px 7px 14px;
		box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
		min-width: 0;
	}
	.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--amber);
		flex-shrink: 0;
	}
	.ct {
		font-size: 14px;
		font-weight: 700;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}
	.cmeta {
		font-size: 13px;
		color: var(--chip-muted);
		white-space: nowrap;
	}
	.stchip .chipbtn {
		cursor: pointer;
	}
	.hintchip {
		background: var(--surface);
		border: 1px solid var(--line-2);
		border-radius: var(--r-xl);
		padding: 10px 14px;
		font-size: 13px;
		color: var(--soft);
	}
	.zoom {
		display: flex;
		align-items: center;
		background: var(--surface);
		border: 1px solid var(--line-2);
		border-radius: var(--r-lg);
		overflow: hidden;
		flex-shrink: 0;
	}
	.zb {
		width: 40px;
		height: 40px;
		border: 0;
		background: transparent;
		font: inherit;
		font-size: 18px;
		color: var(--ink);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	.zb:hover {
		background: var(--bg);
	}
	.zb:focus-visible {
		outline-offset: -3px;
	}
	.zb.fit {
		border-left: 1px solid var(--line);
		width: 44px;
	}
	.zt {
		font-size: 12px;
		width: 48px;
		text-align: center;
	}
</style>
