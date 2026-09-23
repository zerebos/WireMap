<script lang="ts" module>
	import type { DeviceKind } from '$lib/constants';
	import type { Point } from '$lib/geometry';

	export type MapMode = 'select' | 'room' | 'add' | 'scale' | 'place';
	export type MapRoom = { id: number; name: string; outline: Point[] | null };
	export type MapDevice = {
		id: number;
		name: string;
		kind: DeviceKind;
		x: number;
		y: number;
		color: string | null;
		breakerId: number | null;
	};
	export type MapFloor = {
		id: number;
		planWidth: number;
		planHeight: number;
		planImage: string | null;
		metersPerUnit: number | null;
	};
</script>

<script lang="ts">
	import { DEVICE_KIND_INFO } from '$lib/constants';
	import {
		DEFAULT_METERS_PER_UNIT,
		dist,
		formatArea,
		formatLength,
		labelPoint,
		nearestOnSegment,
		polygonArea
	} from '$lib/geometry';
	import { units } from '$lib/units.svelte';

	let {
		floor,
		rooms,
		devices,
		selectedDeviceId = null,
		selectedRoomId = null,
		highlightBreakerId = null,
		mode = $bindable('select'),
		pendingOutline = null,
		pendingPoint = null,
		measureLine = null,
		placingLabel = null,
		onselectdevice,
		onselectroom,
		onmovedevice,
		onoutline,
		onpoint,
		onmeasure,
		oncancel
	}: {
		floor: MapFloor;
		rooms: MapRoom[];
		devices: MapDevice[];
		selectedDeviceId?: number | null;
		selectedRoomId?: number | null;
		highlightBreakerId?: number | null;
		mode?: MapMode;
		/** A just-drawn outline waiting for a name. */
		pendingOutline?: Point[] | null;
		/** Where a new item is about to go. */
		pendingPoint?: Point | null;
		/** The line being used to set the scale. */
		measureLine?: [Point, Point] | null;
		placingLabel?: string | null;
		onselectdevice: (id: number) => void;
		onselectroom: (id: number | null) => void;
		onmovedevice: (id: number, p: Point) => Promise<unknown>;
		/** A room outline was drawn (roomId null) or reshaped. */
		onoutline: (roomId: number | null, outline: Point[]) => Promise<unknown> | void;
		onpoint: (p: Point) => void;
		onmeasure: (line: [Point, Point]) => void;
		oncancel: () => void;
	} = $props();

	const uid = $props.id();
	const MARKER_PX = 11;
	const SNAP_PX = 10;
	const DRAG_PX = 4;

	let svg: SVGSVGElement | undefined = $state();
	let cw = $state(800);
	let ch = $state(600);
	let view = $state({ x: 0, y: 0, w: 2000, h: 1500 });

	const mpu = $derived(floor.metersPerUnit ?? DEFAULT_METERS_PER_UNIT);
	/** Plan units per screen pixel at the current zoom. */
	const upp = $derived(Math.max(view.w / Math.max(cw, 1), view.h / Math.max(ch, 1)));

	// Refit whenever a different floor (or a differently sized one) is shown, but keep the view
	// when the same floor's data refreshes after an edit.
	let fitted = '';
	$effect(() => {
		const key = `${floor.id}:${floor.planWidth}:${floor.planHeight}`;
		if (key === fitted) return;
		fitted = key;
		fit(floor.planWidth, floor.planHeight);
	});

	function fit(w = floor.planWidth, h = floor.planHeight) {
		const pad = Math.max(w, h) * 0.03;
		view = { x: -pad, y: -pad, w: w + pad * 2, h: h + pad * 2 };
	}

	// Screen ↔ plan mapping for a viewBox drawn with the default "xMidYMid meet".
	function frame(v = view) {
		const s = Math.min(cw / v.w, ch / v.h);
		return { s, ox: (cw - v.w * s) / 2, oy: (ch - v.h * s) / 2 };
	}
	function toPlan(clientX: number, clientY: number, v = view): Point {
		const r = svg!.getBoundingClientRect();
		const { s, ox, oy } = frame(v);
		return [v.x + (clientX - r.left - ox) / s, v.y + (clientY - r.top - oy) / s];
	}
	const clampToFloor = (p: Point): Point => [
		Math.min(Math.max(p[0], 0), floor.planWidth),
		Math.min(Math.max(p[1], 0), floor.planHeight)
	];

	function zoomAt(factor: number, clientX?: number, clientY?: number) {
		if (!svg) return;
		const r = svg.getBoundingClientRect();
		const cx = clientX ?? r.left + r.width / 2;
		const cy = clientY ?? r.top + r.height / 2;
		const size = Math.max(floor.planWidth, floor.planHeight);
		const w = Math.min(Math.max(view.w * factor, size * 0.02), size * 4);
		const f = w / view.w;
		const [px, py] = toPlan(cx, cy);
		view = { x: px - (px - view.x) * f, y: py - (py - view.y) * f, w: view.w * f, h: view.h * f };
	}

	$effect(() => {
		if (!svg) return;
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			zoomAt(Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), e.clientX, e.clientY);
		};
		svg.addEventListener('wheel', onWheel, { passive: false });
		return () => svg?.removeEventListener('wheel', onWheel);
	});

	// ---- Drawing state

	let draft = $state<Point[]>([]);
	let measure = $state<Point[]>([]);
	let hover = $state<Point | null>(null);
	/** Optimistic geometry shown while a save is in flight. */
	let movingDevice = $state<{ id: number; p: Point } | null>(null);
	let editing = $state<{ roomId: number; pts: Point[] } | null>(null);

	export function setMode(next: MapMode) {
		draft = [];
		measure = [];
		mode = next;
	}

	const outlineOf = (r: MapRoom) => (editing?.roomId === r.id ? editing.pts : r.outline);
	const selectedRoom = $derived(rooms.find((r) => r.id === selectedRoomId) ?? null);

	/**
	 * Snaps a point to nearby corners, then walls, then (on blank floors) a 10 cm grid. Shift keeps
	 * the line from `prev` horizontal or vertical. Alt turns snapping off.
	 */
	function snap(
		p: Point,
		opts: { shift?: boolean; alt?: boolean; prev?: Point; skip?: { roomId: number; index: number } } = {}
	): Point {
		if (opts.alt) return clampToFloor(p);
		const tol = SNAP_PX * upp;
		let best: Point | null = null;
		let bestD = tol;
		const consider = (q: Point) => {
			const d = dist(p, q);
			if (d < bestD) {
				best = q;
				bestD = d;
			}
		};
		for (const r of rooms) {
			const pts = outlineOf(r);
			pts?.forEach((q, i) => {
				if (opts.skip?.roomId !== r.id || opts.skip.index !== i) consider(q);
			});
		}
		draft.forEach(consider);
		if (best) return best;

		let q: Point = p;
		if (opts.shift && opts.prev) {
			const [px, py] = opts.prev;
			q = Math.abs(p[0] - px) > Math.abs(p[1] - py) ? [p[0], py] : [px, p[1]];
		} else {
			for (const r of rooms) {
				if (opts.skip?.roomId === r.id) continue;
				const pts = outlineOf(r);
				pts?.forEach((a, i) => consider(nearestOnSegment(p, a, pts[(i + 1) % pts.length])));
			}
			if (best) return best;
		}
		if (!floor.planImage) {
			const step = 0.1 / mpu;
			q = opts.shift && opts.prev
				? [
						q[0] === opts.prev[0] ? q[0] : Math.round(q[0] / step) * step,
						q[1] === opts.prev[1] ? q[1] : Math.round(q[1] / step) * step
					]
				: [Math.round(q[0] / step) * step, Math.round(q[1] / step) * step];
		}
		return clampToFloor(q);
	}

	// ---- Pointer handling. Every press starts a drag; a press that barely moves is a click.

	type Drag =
		| { kind: 'pan'; start: Point; view0: typeof view; roomId: number | null; moved: boolean }
		| { kind: 'device'; id: number; start: Point; p: Point; moved: boolean }
		| { kind: 'vertex'; roomId: number; index: number; pts: Point[]; start: Point; moved: boolean; inserted: boolean }
		| { kind: 'pinch'; d0: number; view0: typeof view; p0: Point };

	let drag = $state<Drag | null>(null);
	const pointers = new Map<number, Point>();
	let lastVertexTap = { roomId: 0, index: -1, at: 0 };

	const dataOf = (e: Event, attr: string) => {
		const el = (e.target as Element).closest(`[data-${attr}]`);
		return el ? Number(el.getAttribute(`data-${attr}`)) : null;
	};

	function pinchInfo() {
		const [a, b] = [...pointers.values()];
		return { d: dist(a, b), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as Point };
	}

	function onpointerdown(e: PointerEvent) {
		if (e.button !== 0 && e.pointerType === 'mouse') return;
		svg!.setPointerCapture(e.pointerId);
		pointers.set(e.pointerId, [e.clientX, e.clientY]);
		const start: Point = [e.clientX, e.clientY];

		if (pointers.size === 2) {
			const { d, mid } = pinchInfo();
			drag = { kind: 'pinch', d0: d, view0: { ...view }, p0: toPlan(mid[0], mid[1]) };
			return;
		}
		if (pointers.size > 2) return;

		if (mode === 'select') {
			const deviceId = dataOf(e, 'device');
			if (deviceId !== null) {
				const d = devices.find((x) => x.id === deviceId);
				if (d) drag = { kind: 'device', id: d.id, start, p: [d.x, d.y], moved: false };
				return;
			}
			const vertex = dataOf(e, 'vertex');
			const mid = dataOf(e, 'mid');
			if (selectedRoom && (vertex !== null || mid !== null)) {
				const pts = [...(outlineOf(selectedRoom) ?? [])];
				let index = vertex ?? 0;
				if (mid !== null) {
					const a = pts[mid];
					const b = pts[(mid + 1) % pts.length];
					pts.splice(mid + 1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
					index = mid + 1;
				}
				drag = { kind: 'vertex', roomId: selectedRoom.id, index, pts, start, moved: false, inserted: mid !== null };
				return;
			}
		}
		drag = { kind: 'pan', start, view0: { ...view }, roomId: dataOf(e, 'room'), moved: false };
	}

	function onpointermove(e: PointerEvent) {
		if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [e.clientX, e.clientY]);
		const p = toPlan(e.clientX, e.clientY);
		if (mode === 'room') hover = snap(p, { shift: e.shiftKey, alt: e.altKey, prev: draft.at(-1) });
		else if (mode === 'scale') hover = snap(p, { shift: e.shiftKey, alt: e.altKey, prev: measure[0] });
		else hover = p;

		if (!drag) return;
		if (drag.kind === 'pinch') {
			if (pointers.size < 2) return;
			const { d, mid } = pinchInfo();
			const size = Math.max(floor.planWidth, floor.planHeight);
			const f = Math.min(Math.max(drag.view0.w * (drag.d0 / d), size * 0.02), size * 4) / drag.view0.w;
			const v = { x: 0, y: 0, w: drag.view0.w * f, h: drag.view0.h * f };
			const at = toPlan(mid[0], mid[1], v);
			view = { ...v, x: drag.p0[0] - at[0], y: drag.p0[1] - at[1] };
			return;
		}
		if (!drag.moved && dist(drag.start, [e.clientX, e.clientY]) < DRAG_PX) return;
		drag.moved = true;
		if (drag.kind === 'pan') {
			const { s } = frame(drag.view0);
			view = {
				...drag.view0,
				x: drag.view0.x - (e.clientX - drag.start[0]) / s,
				y: drag.view0.y - (e.clientY - drag.start[1]) / s
			};
		} else if (drag.kind === 'device') {
			drag.p = clampToFloor(p);
		} else if (drag.kind === 'vertex') {
			const n = drag.pts.length;
			drag.pts[drag.index] = snap(p, {
				shift: e.shiftKey,
				alt: e.altKey,
				prev: drag.pts[(drag.index - 1 + n) % n],
				skip: { roomId: drag.roomId, index: drag.index }
			});
			editing = { roomId: drag.roomId, pts: drag.pts };
		}
	}

	async function onpointerup(e: PointerEvent) {
		pointers.delete(e.pointerId);
		const d = drag;
		if (!d) return;
		if (d.kind === 'pinch') {
			if (pointers.size < 2) drag = null;
			return;
		}
		drag = null;

		if (d.kind === 'device') {
			if (!d.moved) return onselectdevice(d.id);
			movingDevice = { id: d.id, p: d.p };
			try {
				await onmovedevice(d.id, d.p);
			} finally {
				movingDevice = null;
			}
		} else if (d.kind === 'vertex') {
			let pts = d.pts;
			if (!d.moved) {
				if (d.inserted) return;
				// Double-tap a corner to remove it.
				const now = performance.now();
				const again =
					lastVertexTap.roomId === d.roomId && lastVertexTap.index === d.index && now - lastVertexTap.at < 400;
				lastVertexTap = { roomId: d.roomId, index: d.index, at: now };
				if (!again || pts.length <= 3) return;
				pts = pts.filter((_, i) => i !== d.index);
			}
			editing = { roomId: d.roomId, pts };
			try {
				await onoutline(d.roomId, pts);
			} finally {
				editing = null;
			}
		} else if (!d.moved && e.type === 'pointerup') {
			click(toPlan(e.clientX, e.clientY), e, d.roomId);
		}
	}

	function click(p: Point, e: PointerEvent, roomId: number | null) {
		if (mode === 'select') {
			onselectroom(roomId);
		} else if (mode === 'room') {
			const sp = snap(p, { shift: e.shiftKey, alt: e.altKey, prev: draft.at(-1) });
			if (draft.length >= 3 && dist(sp, draft[0]) < SNAP_PX * upp) finishRoom();
			else if (!draft.length || dist(sp, draft.at(-1)!) > 0) draft.push(sp);
		} else if (mode === 'add' || mode === 'place') {
			onpoint(clampToFloor(p));
		} else if (mode === 'scale') {
			const sp = snap(p, { shift: e.shiftKey, alt: e.altKey, prev: measure[0] });
			if (!measure.length) measure = [sp];
			else if (dist(sp, measure[0]) > 0) {
				onmeasure([measure[0], sp]);
				setMode('select');
			}
		}
	}

	function finishRoom() {
		if (draft.length < 3) return;
		const pts = draft;
		setMode('select');
		onoutline(null, pts);
	}

	function cancel() {
		setMode('select');
		oncancel();
	}

	function onkeydown(e: KeyboardEvent) {
		const t = e.target as HTMLElement;
		if (t.closest('input, textarea, select, [contenteditable]')) return;
		if (e.key === 'Escape') {
			if (mode === 'room' && draft.length) draft = [];
			else cancel();
		} else if (e.key === 'Enter' && mode === 'room') {
			finishRoom();
		} else if ((e.key === 'Backspace' || e.key === 'Delete') && mode === 'room' && draft.length) {
			e.preventDefault();
			draft.pop();
		}
	}

	// ---- Rendering helpers

	const pts = (p: Point[]) => p.map((q) => `${q[0]},${q[1]}`).join(' ');
	const hue = (id: number) => (id * 67) % 360;
	const devicePos = (d: MapDevice): Point =>
		drag?.kind === 'device' && drag.id === d.id && drag.moved
			? drag.p
			: movingDevice?.id === d.id
				? movingDevice.p
				: [d.x, d.y];

	const grid = $derived.by(() => {
		// Pick a grid step (in metres) that stays at least ~12px apart on screen.
		const pxPerMeter = 1 / mpu / upp;
		const minor = [0.1, 0.5, 1, 5, 10].find((m) => m * pxPerMeter >= 12) ?? 10;
		return { minor: minor / mpu, major: (minor === 0.5 ? 5 : minor * 5) / mpu };
	});

	const hint = $derived.by(() => {
		switch (mode) {
			case 'room':
				return draft.length === 0
					? 'Click to place the first corner of the room.'
					: 'Click to add corners. Click the first corner or press Enter to finish. Shift keeps lines straight, Alt turns off snapping.';
			case 'add':
				return 'Click where the new item is.';
			case 'place':
				return `Click where ${placingLabel ?? 'the item'} goes.`;
			case 'scale':
				return measure.length
					? 'Now click the other end.'
					: 'Click both ends of a wall or line you know the length of.';
			default:
				return selectedRoom
					? 'Drag corners to reshape. Drag a midpoint to add a corner, double-click a corner to remove it.'
					: 'Drag to pan, scroll or pinch to zoom. Drag items to move them.';
		}
	});

	const tools: { mode: MapMode; label: string; title: string }[] = [
		{ mode: 'select', label: 'Select', title: 'Select, move and reshape' },
		{ mode: 'room', label: 'Draw room', title: 'Draw a room outline' },
		{ mode: 'add', label: 'Add item', title: 'Add a new item on the map' },
		{ mode: 'scale', label: 'Set scale', title: 'Measure a known length to set the scale' }
	];
</script>

<svelte:window {onkeydown} />

<div class="wrap">
	<div class="toolbar">
		<div class="group" role="toolbar" aria-label="Map tools">
			{#each tools as t (t.mode)}
				<button
					type="button"
					class:active={mode === t.mode}
					aria-pressed={mode === t.mode}
					title={t.title}
					onclick={() => setMode(mode === t.mode && t.mode !== 'select' ? 'select' : t.mode)}
				>
					{t.label}
				</button>
			{/each}
		</div>
		<div class="group">
			<button type="button" onclick={() => zoomAt(1 / 1.4)} aria-label="Zoom in">+</button>
			<button type="button" onclick={() => zoomAt(1.4)} aria-label="Zoom out">−</button>
			<button type="button" onclick={() => fit()}>Fit</button>
		</div>
	</div>

	<div class="canvas mode-{mode}" bind:clientWidth={cw} bind:clientHeight={ch}>
		<svg
			bind:this={svg}
			viewBox="{view.x} {view.y} {view.w} {view.h}"
			role="application"
			aria-label="Floor map"
			{onpointerdown}
			{onpointermove}
			{onpointerup}
			onpointercancel={onpointerup}
			onpointerleave={() => (hover = null)}
		>
			<defs>
				<pattern id="minor-{uid}" width={grid.minor} height={grid.minor} patternUnits="userSpaceOnUse">
					<path d="M {grid.minor} 0 L 0 0 0 {grid.minor}" class="grid-minor" stroke-width={upp} />
				</pattern>
				<pattern id="major-{uid}" width={grid.major} height={grid.major} patternUnits="userSpaceOnUse">
					<rect width={grid.major} height={grid.major} fill="url(#minor-{uid})" />
					<path d="M {grid.major} 0 L 0 0 0 {grid.major}" class="grid-major" stroke-width={upp} />
				</pattern>
			</defs>

			<rect class="floor" width={floor.planWidth} height={floor.planHeight} />
			{#if floor.planImage}
				<image
					href="/plans/{floor.planImage}"
					width={floor.planWidth}
					height={floor.planHeight}
					preserveAspectRatio="none"
				/>
			{:else}
				<rect width={floor.planWidth} height={floor.planHeight} fill="url(#major-{uid})" />
			{/if}
			<rect class="floor-edge" width={floor.planWidth} height={floor.planHeight} stroke-width={upp} />

			{#each rooms as r (r.id)}
				{@const outline = outlineOf(r)}
				{#if outline}
					<polygon
						data-room={r.id}
						class="room"
						class:selected={r.id === selectedRoomId}
						points={pts(outline)}
						style="--hue: {hue(r.id)}"
						stroke-width={(r.id === selectedRoomId ? 2.5 : 1.5) * upp}
					/>
				{/if}
			{/each}
			{#each rooms as r (r.id)}
				{@const outline = outlineOf(r)}
				{#if outline}
					{@const [lx, ly] = labelPoint(outline)}
					<text class="room-label" x={lx} y={ly} font-size={13 * upp}>
						<tspan x={lx} dy={-0.2 * 13 * upp}>{r.name}</tspan>
						<tspan x={lx} dy={1.25 * 12 * upp} font-size={11 * upp} class="area">
							{formatArea(polygonArea(outline) * mpu * mpu, units.length)}
						</tspan>
					</text>
				{/if}
			{/each}

			{#if pendingOutline}
				<polygon class="room pending" points={pts(pendingOutline)} stroke-width={2 * upp} />
			{/if}

			{#if mode === 'room' && draft.length}
				<polyline
					class="draft"
					points={pts(hover ? [...draft, hover] : draft)}
					stroke-width={2 * upp}
				/>
				{#each draft as p, i (i)}
					<circle
						class="draft-point"
						class:first={i === 0}
						cx={p[0]}
						cy={p[1]}
						r={(i === 0 && draft.length >= 3 ? 6 : 4) * upp}
						stroke-width={1.5 * upp}
					/>
				{/each}
				{#if hover && draft.length}
					<text class="measure-label" x={hover[0]} y={hover[1] - 12 * upp} font-size={12 * upp}>
						{formatLength(dist(draft.at(-1)!, hover) * mpu, units.length)}
					</text>
				{/if}
			{/if}

			{#if mode === 'select' && selectedRoom}
				{@const outline = outlineOf(selectedRoom)}
				{#if outline}
					{#each outline as p, i (i)}
						{@const q = outline[(i + 1) % outline.length]}
						<circle
							data-mid={i}
							class="handle mid"
							cx={(p[0] + q[0]) / 2}
							cy={(p[1] + q[1]) / 2}
							r={4.5 * upp}
							stroke-width={1.5 * upp}
						/>
					{/each}
					{#each outline as p, i (i)}
						<circle
							data-vertex={i}
							class="handle"
							cx={p[0]}
							cy={p[1]}
							r={6.5 * upp}
							stroke-width={2 * upp}
						/>
					{/each}
				{/if}
			{/if}

			{#each devices as d (d.id)}
				{@const [x, y] = devicePos(d)}
				{@const lit = highlightBreakerId !== null && d.breakerId === highlightBreakerId}
				{@const selected = d.id === selectedDeviceId}
				<g
					data-device={d.id}
					class="device"
					class:dim={highlightBreakerId !== null && !lit}
					class:lit
					class:selected
					transform="translate({x} {y}) scale({upp})"
					style="--tag: {d.color ?? 'var(--device)'}"
				>
					<title>{d.name}</title>
					{#if lit || selected}
						<circle class="ring" r={MARKER_PX + 5} />
					{/if}
					<circle class="dot" r={MARKER_PX} />
					<text class="icon" font-size="12">{DEVICE_KIND_INFO[d.kind].icon}</text>
					{#if selected || lit}
						<text class="device-label" y={MARKER_PX + 16} font-size="12">{d.name}</text>
					{/if}
				</g>
			{/each}

			{#if pendingPoint}
				<g class="device pending" transform="translate({pendingPoint[0]} {pendingPoint[1]}) scale({upp})">
					<circle class="dot" r={MARKER_PX} />
					<text class="icon" font-size="12">＋</text>
				</g>
			{/if}

			{#if mode === 'scale' && measure.length}
				<line
					class="measure"
					x1={measure[0][0]}
					y1={measure[0][1]}
					x2={(hover ?? measure[0])[0]}
					y2={(hover ?? measure[0])[1]}
					stroke-width={2.5 * upp}
				/>
			{/if}
			{#if measureLine}
				<line
					class="measure"
					x1={measureLine[0][0]}
					y1={measureLine[0][1]}
					x2={measureLine[1][0]}
					y2={measureLine[1][1]}
					stroke-width={2.5 * upp}
				/>
				{#each measureLine as p, i (i)}
					<circle class="measure-end" cx={p[0]} cy={p[1]} r={4 * upp} />
				{/each}
			{/if}
		</svg>
	</div>

	<div class="hint">
		<span>{hint}</span>
		{#if mode === 'room' && draft.length}
			<span class="actions">
				<button type="button" onclick={() => draft.pop()}>Undo corner</button>
				<button type="button" class="primary" disabled={draft.length < 3} onclick={finishRoom}>
					Finish room
				</button>
			</span>
		{/if}
		{#if mode !== 'select'}
			<button type="button" onclick={cancel}>Cancel</button>
		{/if}
	</div>
</div>

<style>
	.wrap {
		display: grid;
		gap: 0.5rem;
		min-width: 0;
		--device: #7b8594;
	}
	.toolbar {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.group {
		display: flex;
		gap: 0.3rem;
		flex-wrap: wrap;
	}
	.toolbar button.active {
		background: var(--accent);
		border-color: var(--accent);
		color: #fff;
	}

	.canvas {
		position: relative;
		height: min(72vh, 46rem);
		min-height: 20rem;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
	}
	@media (max-width: 960px) {
		.canvas {
			height: min(65vh, 90vw);
			min-height: 16rem;
		}
	}
	svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		touch-action: none;
		user-select: none;
		cursor: grab;
	}
	.mode-room svg,
	.mode-add svg,
	.mode-place svg,
	.mode-scale svg {
		cursor: crosshair;
	}

	.floor {
		fill: var(--surface);
	}
	.floor-edge {
		fill: none;
		stroke: var(--border);
	}
	.grid-minor {
		fill: none;
		stroke: color-mix(in srgb, var(--text) 7%, transparent);
	}
	.grid-major {
		fill: none;
		stroke: color-mix(in srgb, var(--text) 16%, transparent);
	}

	.room {
		fill: hsl(var(--hue) 60% 55% / 0.14);
		stroke: color-mix(in srgb, var(--text) 55%, transparent);
		stroke-linejoin: round;
		cursor: pointer;
	}
	.room.selected {
		fill: hsl(var(--hue) 60% 55% / 0.26);
		stroke: var(--accent);
	}
	.room.pending {
		fill: color-mix(in srgb, var(--accent) 15%, transparent);
		stroke: var(--accent);
		stroke-dasharray: 6 4;
		pointer-events: none;
	}
	.room-label {
		fill: var(--text);
		text-anchor: middle;
		font-weight: 600;
		pointer-events: none;
		paint-order: stroke;
		stroke: var(--surface);
		stroke-width: 3px;
		stroke-linejoin: round;
	}
	.room-label .area {
		font-weight: 400;
		fill: var(--muted);
	}

	.draft {
		fill: color-mix(in srgb, var(--accent) 10%, transparent);
		stroke: var(--accent);
		stroke-linejoin: round;
		pointer-events: none;
	}
	.draft-point {
		fill: var(--surface);
		stroke: var(--accent);
		pointer-events: none;
	}
	.draft-point.first {
		fill: var(--accent);
	}
	.measure-label {
		fill: var(--accent);
		text-anchor: middle;
		font-weight: 600;
		pointer-events: none;
		paint-order: stroke;
		stroke: var(--surface);
		stroke-width: 3px;
	}

	.handle {
		fill: var(--surface);
		stroke: var(--accent);
		cursor: move;
	}
	.handle.mid {
		fill: var(--accent);
		stroke: var(--surface);
		opacity: 0.7;
		cursor: copy;
	}

	.device {
		cursor: pointer;
		transition: opacity 0.15s;
	}
	.mode-select .device {
		cursor: grab;
	}
	.device .dot {
		fill: var(--tag);
		stroke: var(--surface);
		stroke-width: 2;
	}
	.device .ring {
		fill: none;
		stroke: var(--accent);
		stroke-width: 3;
	}
	.device.selected .ring {
		stroke-width: 4;
	}
	.device.dim {
		opacity: 0.28;
	}
	.device .icon {
		text-anchor: middle;
		dominant-baseline: central;
		pointer-events: none;
	}
	.device-label {
		fill: var(--text);
		text-anchor: middle;
		font-weight: 600;
		pointer-events: none;
		paint-order: stroke;
		stroke: var(--surface);
		stroke-width: 3px;
	}
	.device.pending {
		pointer-events: none;
	}
	.device.pending .dot {
		fill: var(--accent);
	}
	.device.pending .icon {
		fill: #fff;
	}

	.measure {
		stroke: var(--danger);
		stroke-linecap: round;
		pointer-events: none;
	}
	.measure-end {
		fill: var(--danger);
		pointer-events: none;
	}

	.hint {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
		font-size: 0.85rem;
		color: var(--muted);
		min-height: 2rem;
	}
	.hint > span:first-child {
		flex: 1;
		min-width: 12rem;
	}
	.actions {
		display: flex;
		gap: 0.3rem;
	}
	.hint button {
		padding: 0.25rem 0.6rem;
		font-size: 0.85rem;
	}
</style>
