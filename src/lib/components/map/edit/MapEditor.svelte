<script lang="ts">
	// Editing the map layout (docs/design/DESIGN.md §5.10, mockups MapEditRoom / MapEditScale).
	// Viewing and editing are separate modes, so a stray drag never moves a wall. Drags edit a
	// local draft and save on release; every saved change can be undone for this session.
	import { tick, untrack } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { mutate, type HouseIndex, type HouseItem } from '$lib/house';
	import {
		createRoom,
		deleteRoom,
		placeItem,
		removeFloorPlan,
		restoreLayout,
		setRoomShape,
		unplaceItem,
		updateFloor,
		updateRoom,
		type LayoutSnapshot
	} from '$lib/db/ops';
	import type { Room } from '$lib/db/schema';
	import { planUrl, prunePlans } from '$lib/plans';
	import {
		bboxOf,
		contains,
		dist,
		feet,
		nearestOnSegment,
		parseShape,
		pointsOf,
		roomAt,
		sizeText,
		translate,
		type Point,
		type Rect,
		type Shape
	} from '$lib/shape';
	import { PLAN_ACCEPT, planBox, slotsText, uploadPlan } from '../model';

	let {
		ix,
		floorId,
		initialRoom = null,
		ondone
	}: { ix: HouseIndex; floorId: number; initialRoom?: number | null; ondone: () => void } = $props();

	const GRID = 10;
	const SNAP = 8;
	const MIN = 60;

	const floor = $derived(ix.floorById.get(floorId)!);
	const upf = $derived(floor.unitsPerFt);
	const rooms = $derived(ix.house.rooms.filter((r) => r.floorId === floorId).sort((a, b) => a.id - b.id));
	const floorItems = $derived(ix.house.items.filter((i) => i.floorId === floorId));
	const unplaced = $derived(floorItems.filter((i) => i.x === null || i.y === null));
	/** Each item's room when editing started, for "Was Half bath". */
	const wasRoom = untrack(() => new Map(ix.house.items.map((i) => [i.id, i.roomId])));

	// ---- Selection and tools
	type ESel = { k: 'room'; id: number } | { k: 'item'; id: number } | { k: 'plan' } | null;
	type ETool = 'select' | 'rect' | 'poly' | 'scale';
	let sel = $state<ESel>(untrack(() => (initialRoom !== null ? { k: 'room', id: initialRoom } : null)));
	let tool = $state<ETool>('select');
	let placing = $state<number | null>(null);
	let carry = $state(true);

	const selId = (k: 'room' | 'item') => (sel && sel.k === k ? sel.id : null);
	const selRoom = $derived(rooms.find((r) => r.id === selId('room')) ?? null);
	const selItem = $derived(floorItems.find((i) => i.id === selId('item') && i.x !== null) ?? null);
	const planSel = $derived(sel?.k === 'plan');

	function setTool(t: ETool) {
		tool = t;
		placing = null;
		polyPts = [];
		if (t !== 'select') sel = null;
		if (t === 'scale') startMeasure();
	}

	// ---- Drafts: what a drag shows before it's saved
	let roomDraft = $state<{ id: number; shape: Shape } | null>(null);
	let itemDraft = $state<Record<number, Point>>({});
	let planDraft = $state<{ x: number; y: number } | null>(null);
	let planOpacity = $state(0.35);
	let planScale = $state(1);
	$effect(() => {
		planOpacity = floor.planOpacity;
		planScale = floor.planScale;
	});

	const shapeOf = (r: Room): Shape | null => (roomDraft?.id === r.id ? roomDraft.shape : parseShape(r.shape));
	const posOf = (i: HouseItem): Point | null => itemDraft[i.id] ?? (i.x === null || i.y === null ? null : [i.x, i.y]);
	const shapedRooms = $derived(rooms.map((r) => ({ ...r, shape: shapeOf(r) })));
	const roomNameAt = (p: Point) => roomAt(p, shapedRooms)?.name ?? 'Not in a room';
	const itemsInside = (s: Shape) =>
		floorItems.filter((i) => {
			const p = posOf(i);
			return p !== null && contains(s, p);
		});

	// ---- Undo: a snapshot of the floor's layout before each saved change
	let history = $state<LayoutSnapshot[]>([]);
	function snapshot(): LayoutSnapshot {
		return {
			floorId,
			rooms: rooms.map((r) => ({ ...r })),
			items: floorItems.map((i) => ({ id: i.id, x: i.x, y: i.y, roomId: i.roomId })),
			floor: {
				planImage: floor.planImage,
				planHeight: floor.planHeight,
				planOffsetX: floor.planOffsetX,
				planOffsetY: floor.planOffsetY,
				planScale: floor.planScale,
				planRotation: floor.planRotation,
				planLocked: floor.planLocked,
				planOpacity: floor.planOpacity,
				unitsPerFt: floor.unitsPerFt
			}
		};
	}
	async function commit<T>(change: () => Promise<T>): Promise<T> {
		history = [...history, snapshot()].slice(-50);
		try {
			return await mutate(change);
		} finally {
			roomDraft = null;
			itemDraft = {};
			planDraft = null;
		}
	}
	async function undo() {
		const s = history.at(-1);
		if (!s) return;
		history = history.slice(0, -1);
		const rid = selId('room');
		if (rid !== null && !s.rooms.some((r) => r.id === rid)) sel = null;
		await mutate(() => restoreLayout(s));
	}

	// ---- View: zoom and pan. Map units → screen px: x * z + px.
	let grid: HTMLDivElement | undefined = $state();
	let cw = $state(800);
	let ch = $state(600);
	let z = $state(1);
	let px = $state(0);
	let py = $state(20);
	const sx = (x: number) => x * z + px;
	const sy = (y: number) => y * z + py;
	function zoomAt(f: number, cx = cw / 2, cy = ch / 2) {
		const nz = Math.min(4, Math.max(0.25, z * f));
		px = cx - ((cx - px) * nz) / z;
		py = cy - ((cy - py) * nz) / z;
		z = nz;
	}
	function fit() {
		const pad = 20;
		const nz = Math.min(4, Math.max(0.25, Math.min((cw - pad * 2) / floor.planWidth, (ch - pad * 2) / floor.planHeight)));
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
	function toMap(e: { clientX: number; clientY: number }): Point {
		const r = grid!.getBoundingClientRect();
		return [(e.clientX - r.left - px) / z, (e.clientY - r.top - py) / z];
	}
	const clampX = (x: number) => Math.min(Math.max(x, 0), floor.planWidth);
	const clampY = (y: number) => Math.min(Math.max(y, 0), floor.planHeight);
	const toGrid = (v: number) => Math.round(v / GRID) * GRID;

	// ---- Snapping: a 10-unit grid, or another room's edge within 8 units (with a guide line)
	type Guide = { v?: number; h?: number };
	let guide = $state<Guide>({});
	let tip = $state<{ x: number; y: number; t: string } | null>(null);
	function edges(skip: number | null, axis: 0 | 1): number[] {
		const out: number[] = [];
		for (const r of shapedRooms) {
			if (r.id === skip || !r.shape) continue;
			const b = bboxOf(r.shape);
			if (axis === 0) out.push(b.x, b.x + b.w);
			else out.push(b.y, b.y + b.h);
		}
		return out;
	}
	function snapVal(v: number, cands: number[], free: boolean): { v: number; g: number | null } {
		if (free) return { v, g: null };
		let best: number | null = null;
		let bestD = SNAP;
		for (const c of cands) {
			const d = Math.abs(c - v);
			if (d <= bestD) {
				best = c;
				bestD = d;
			}
		}
		return best !== null ? { v: best, g: best } : { v: toGrid(v), g: null };
	}
	const sizeTip = (b: Rect) => (upf ? `${feet(b.w, upf)} × ${feet(b.h, upf)}` : null);

	// ---- Pointer interactions
	type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
	const HANDLES: [Handle, number, number, string][] = [
		['nw', 0, 0, 'nwse-resize'],
		['n', 0.5, 0, 'ns-resize'],
		['ne', 1, 0, 'nesw-resize'],
		['e', 1, 0.5, 'ew-resize'],
		['se', 1, 1, 'nwse-resize'],
		['s', 0.5, 1, 'ns-resize'],
		['sw', 0, 1, 'nesw-resize'],
		['w', 0, 0.5, 'ew-resize']
	];
	type Drag =
		| { k: 'pan'; x0: number; y0: number; px0: number; py0: number; moved: boolean }
		| { k: 'room'; id: number; h: Handle | 'move'; s: Point; o: Shape; inside: { id: number; p: Point }[]; moved: boolean }
		| { k: 'vertex'; id: number; index: number; o: Point[]; moved: boolean }
		| { k: 'item'; id: number; s: Point; o: Point; room: string; moved: boolean }
		| { k: 'new'; a: Point; b: Point }
		| { k: 'plan'; s: Point; o: Point; moved: boolean }
		| { k: 'measure'; end: 'a' | 'b' };
	let drag = $state<Drag | null>(null);
	let hover = $state<Point | null>(null);
	let draft = $state<Rect | null>(null);

	function capture(e: PointerEvent) {
		grid?.setPointerCapture(e.pointerId);
	}
	const inOverlay = (e: Event) => !!(e.target as Element).closest('.ovl');

	function ongridDown(e: PointerEvent) {
		if (e.button !== 0 || inOverlay(e)) return;
		const p = toMap(e);
		// Placing wins over whatever is under the pointer: an item usually goes inside a room.
		if (placing !== null) {
			const at: Point = e.shiftKey ? [clampX(p[0]), clampY(p[1])] : [clampX(toGrid(p[0])), clampY(toGrid(p[1]))];
			const id = placing;
			placing = null;
			sel = { k: 'item', id };
			commit(() => placeItem(id, floorId, at[0], at[1]));
			return;
		}
		if ((e.target as Element).closest('.room, .poly, .it, .hd, .mh, .pframe')) return;
		if (tool === 'rect') {
			drag = { k: 'new', a: p, b: p };
			capture(e);
			e.preventDefault();
			return;
		}
		if (tool === 'poly') {
			addPolyPoint(p, e.shiftKey);
			e.preventDefault();
			return;
		}
		drag = { k: 'pan', x0: e.clientX, y0: e.clientY, px0: px, py0: py, moved: false };
	}

	function roomDown(e: PointerEvent, r: Room) {
		if (e.button !== 0 || tool !== 'select' || placing !== null) return;
		e.stopPropagation();
		const s = shapeOf(r);
		sel = { k: 'room', id: r.id };
		if (!s) return;
		const inside = carry ? itemsInside(s).map((i) => ({ id: i.id, p: posOf(i)! })) : [];
		drag = { k: 'room', id: r.id, h: 'move', s: toMap(e), o: s, inside, moved: false };
		capture(e);
	}
	function handleDown(e: PointerEvent, r: Room, h: Handle) {
		if (e.button !== 0) return;
		e.stopPropagation();
		const s = shapeOf(r);
		if (!s || s.type !== 'rect') return;
		drag = { k: 'room', id: r.id, h, s: toMap(e), o: s, inside: [], moved: false };
		capture(e);
	}
	function vertexDown(e: PointerEvent, r: Room, index: number) {
		if (e.button !== 0) return;
		e.stopPropagation();
		const s = shapeOf(r);
		if (!s || s.type !== 'polygon') return;
		drag = { k: 'vertex', id: r.id, index, o: s.points.map((p) => [p[0], p[1]] as Point), moved: false };
		capture(e);
	}
	function itemDown(e: PointerEvent, i: HouseItem) {
		if (e.button !== 0 || tool !== 'select' || placing !== null) return;
		e.stopPropagation();
		const o = posOf(i);
		sel = { k: 'item', id: i.id };
		if (!o) return;
		drag = { k: 'item', id: i.id, s: toMap(e), o, room: roomNameAt(o), moved: false };
		capture(e);
	}
	function planDown(e: PointerEvent) {
		if (e.button !== 0) return;
		e.stopPropagation();
		drag = { k: 'plan', s: toMap(e), o: [floor.planOffsetX, floor.planOffsetY], moved: false };
		capture(e);
	}
	function measureDown(e: PointerEvent, end: 'a' | 'b') {
		if (e.button !== 0) return;
		e.stopPropagation();
		drag = { k: 'measure', end };
		capture(e);
	}

	function resized(o: Rect, h: Handle, dx: number, dy: number, skip: number, free: boolean): { r: Rect; g: Guide } {
		const r = { ...o };
		const g: Guide = {};
		const ex = edges(skip, 0);
		const ey = edges(skip, 1);
		if (h.includes('w')) {
			const s = snapVal(o.x + dx, ex, free);
			const nx = Math.min(s.v, o.x + o.w - MIN);
			r.w = o.x + o.w - nx;
			r.x = nx;
			if (s.g !== null) g.v = s.g;
		}
		if (h.includes('e')) {
			const s = snapVal(o.x + o.w + dx, ex, free);
			r.w = Math.max(MIN, s.v - o.x);
			if (s.g !== null) g.v = s.g;
		}
		if (h.includes('n')) {
			const s = snapVal(o.y + dy, ey, free);
			const ny = Math.min(s.v, o.y + o.h - MIN);
			r.h = o.y + o.h - ny;
			r.y = ny;
			if (s.g !== null) g.h = s.g;
		}
		if (h.includes('s')) {
			const s = snapVal(o.y + o.h + dy, ey, free);
			r.h = Math.max(MIN, s.v - o.y);
			if (s.g !== null) g.h = s.g;
		}
		return { r, g };
	}
	/** Moves a shape so its bounding box snaps: either edge to another room's, else its corner to the grid. */
	function moved(o: Shape, dx: number, dy: number, skip: number, free: boolean): { dx: number; dy: number; g: Guide } {
		const b = bboxOf(o);
		const g: Guide = {};
		const axis = (start: number, size: number, d: number, cands: number[]) => {
			const s1 = snapVal(start + d, cands, free);
			const s2 = snapVal(start + size + d, cands, free);
			if (s2.g !== null && s1.g === null) return { v: s2.v - size, g: s2.g };
			return { v: s1.v, g: s1.g };
		};
		const x = axis(b.x, b.w, dx, edges(skip, 0));
		const y = axis(b.y, b.h, dy, edges(skip, 1));
		if (x.g !== null) g.v = x.g;
		if (y.g !== null) g.h = y.g;
		return { dx: x.v - b.x, dy: y.v - b.y, g };
	}

	function ongridMove(e: PointerEvent) {
		const p = toMap(e);
		hover = inOverlay(e) ? null : p;
		const d = drag;
		if (!d) return;
		const free = e.shiftKey;
		if (d.k === 'pan') {
			if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 4) return;
			if (!d.moved) capture(e);
			d.moved = true;
			px = d.px0 + e.clientX - d.x0;
			py = d.py0 + e.clientY - d.y0;
		} else if (d.k === 'room') {
			const dx = p[0] - d.s[0];
			const dy = p[1] - d.s[1];
			if (!d.moved && Math.hypot(dx, dy) * z < 3) return;
			d.moved = true;
			let shape: Shape;
			if (d.h === 'move') {
				const m = moved(d.o, dx, dy, d.id, free);
				shape = translate(d.o, m.dx, m.dy);
				guide = m.g;
				const next: Record<number, Point> = {};
				for (const it of d.inside) next[it.id] = [it.p[0] + m.dx, it.p[1] + m.dy];
				itemDraft = next;
			} else {
				const res = resized(d.o as Rect, d.h, dx, dy, d.id, free);
				shape = { type: 'rect', ...res.r };
				guide = res.g;
			}
			roomDraft = { id: d.id, shape };
			const b = bboxOf(shape);
			const t = sizeTip(b);
			tip = t ? { x: b.x + b.w, y: b.y + b.h, t } : null;
		} else if (d.k === 'vertex') {
			d.moved = true;
			const pts = d.o.map((q) => [q[0], q[1]] as Point);
			const sxv = snapVal(p[0], edges(d.id, 0), free);
			const syv = snapVal(p[1], edges(d.id, 1), free);
			pts[d.index] = [clampX(sxv.v), clampY(syv.v)];
			guide = { v: sxv.g ?? undefined, h: syv.g ?? undefined };
			roomDraft = { id: d.id, shape: { type: 'polygon', points: pts } };
		} else if (d.k === 'item') {
			const dx = p[0] - d.s[0];
			const dy = p[1] - d.s[1];
			if (!d.moved && Math.hypot(dx, dy) * z < 3) return;
			d.moved = true;
			const nx = clampX(free ? d.o[0] + dx : toGrid(d.o[0] + dx));
			const ny = clampY(free ? d.o[1] + dy : toGrid(d.o[1] + dy));
			itemDraft = { [d.id]: [nx, ny] };
			const rn = roomNameAt([nx, ny]);
			tip = rn !== d.room ? { x: nx, y: ny, t: `→ ${rn}` } : null;
		} else if (d.k === 'new') {
			const ax = snapVal(d.a[0], edges(null, 0), free).v;
			const ay = snapVal(d.a[1], edges(null, 1), free).v;
			const bx = snapVal(p[0], edges(null, 0), free);
			const by = snapVal(p[1], edges(null, 1), free);
			d.b = p;
			guide = { v: bx.g ?? undefined, h: by.g ?? undefined };
			draft = { x: Math.min(ax, bx.v), y: Math.min(ay, by.v), w: Math.abs(bx.v - ax), h: Math.abs(by.v - ay) };
			const t = sizeTip(draft);
			tip = t ? { x: draft.x + draft.w, y: draft.y + draft.h, t } : null;
		} else if (d.k === 'plan') {
			d.moved = true;
			planDraft = { x: d.o[0] + p[0] - d.s[0], y: d.o[1] + p[1] - d.s[1] };
		} else if (d.k === 'measure') {
			const q: Point = [clampX(p[0]), clampY(p[1])];
			if (d.end === 'a') measure = { ...measure, a: q };
			else measure = { ...measure, b: q };
		}
	}

	let suppressClick = false;
	async function ongridUp() {
		const d = drag;
		drag = null;
		guide = {};
		tip = null;
		if (!d) return;
		if (d.k === 'pan') {
			if (d.moved) suppressClick = true;
			else if (tool === 'select') sel = null;
		} else if (d.k === 'room' && d.moved && roomDraft) {
			const shape = roomDraft.shape;
			const b0 = bboxOf(d.o);
			const b1 = bboxOf(shape);
			const c = d.h === 'move' ? { itemIds: d.inside.map((i) => i.id), dx: b1.x - b0.x, dy: b1.y - b0.y } : undefined;
			await commit(() => setRoomShape(d.id, shape, c));
		} else if (d.k === 'vertex' && d.moved && roomDraft) {
			const shape = roomDraft.shape;
			await commit(() => setRoomShape(d.id, shape));
		} else if (d.k === 'item' && d.moved) {
			const p = itemDraft[d.id];
			if (p) await commit(() => placeItem(d.id, floorId, p[0], p[1]));
		} else if (d.k === 'new') {
			const r = draft;
			draft = null;
			if (r && r.w >= MIN && r.h >= MIN) await addRoom({ type: 'rect', ...r });
		} else if (d.k === 'plan' && d.moved && planDraft) {
			const pd = planDraft;
			await commit(() => updateFloor(floorId, { planOffsetX: pd.x, planOffsetY: pd.y }));
		}
		roomDraft = null;
		itemDraft = {};
	}
	function ongridClick() {
		suppressClick = false;
	}

	/** "New room", or "New room 2" when that's taken. */
	function newRoomName() {
		const taken = new Set(rooms.map((r) => r.name.toLowerCase()));
		if (!taken.has('new room')) return 'New room';
		let n = 2;
		while (taken.has(`new room ${n}`)) n++;
		return `New room ${n}`;
	}
	let nameInput: HTMLInputElement | undefined = $state();
	async function addRoom(shape: Shape) {
		const name = newRoomName();
		const id = await commit(() => createRoom({ floorId, name, kind: 'interior', shape }));
		tool = 'select';
		sel = { k: 'room', id };
		await tick();
		nameInput?.focus();
		nameInput?.select();
	}

	// ---- Polygon tool: click to add corners, click the first corner to close
	let polyPts = $state<Point[]>([]);
	function addPolyPoint(p: Point, free: boolean) {
		if (polyPts.length >= 3 && dist(p, polyPts[0]) * z <= 10) {
			const points = polyPts;
			polyPts = [];
			addRoom({ type: 'polygon', points });
			return;
		}
		const q: Point = free ? [clampX(p[0]), clampY(p[1])] : [clampX(snapVal(p[0], edges(null, 0), false).v), clampY(snapVal(p[1], edges(null, 1), false).v)];
		polyPts = [...polyPts, q];
	}

	/** Double-clicking a polygon's edge adds a corner there. */
	function polyDblClick(e: MouseEvent, r: Room) {
		const s = shapeOf(r);
		if (!s || s.type !== 'polygon' || tool !== 'select') return;
		const p = toMap(e);
		let best = 0;
		let bestD = Infinity;
		let at: Point = p;
		s.points.forEach((a, i) => {
			const b = s.points[(i + 1) % s.points.length];
			const q = nearestOnSegment(p, a, b);
			const d = dist(p, q);
			if (d < bestD) {
				bestD = d;
				best = i;
				at = q;
			}
		});
		if (bestD * z > 12) return;
		const points = [...s.points];
		points.splice(best + 1, 0, [Math.round(at[0]), Math.round(at[1])]);
		commit(() => setRoomShape(r.id, { type: 'polygon', points }));
	}

	// ---- Keyboard: arrows nudge a grid step (Shift = 1 unit), Esc deselects
	function nudgeOf(e: KeyboardEvent): Point | null {
		const step = e.shiftKey ? 1 : GRID;
		const d: Record<string, Point> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
		return d[e.key] ?? null;
	}
	function roomKey(e: KeyboardEvent, r: Room) {
		if ((e.key === 'Enter' || e.key === ' ') && tool === 'select' && placing === null) {
			e.preventDefault();
			sel = { k: 'room', id: r.id };
			return;
		}
		const d = nudgeOf(e);
		if (!d) return;
		e.preventDefault();
		const s = shapeOf(r);
		if (!s) return;
		sel = { k: 'room', id: r.id };
		const c = carry ? { itemIds: itemsInside(s).map((i) => i.id), dx: d[0], dy: d[1] } : undefined;
		commit(() => setRoomShape(r.id, translate(s, d[0], d[1]), c));
	}
	function itemKey(e: KeyboardEvent, i: HouseItem) {
		const d = nudgeOf(e);
		if (!d) return;
		e.preventDefault();
		const p = posOf(i);
		if (!p) return;
		sel = { k: 'item', id: i.id };
		commit(() => placeItem(i.id, floorId, clampX(p[0] + d[0]), clampY(p[1] + d[1])));
	}
	function measureKey(e: KeyboardEvent, end: 'a' | 'b') {
		const d = nudgeOf(e);
		if (!d) return;
		e.preventDefault();
		const q = measure[end];
		measure = { ...measure, [end]: [clampX(q[0] + d[0]), clampY(q[1] + d[1])] };
	}
	function onkeydown(e: KeyboardEvent) {
		const inField = !!(e.target as Element).closest?.('input, textarea, select');
		if (e.key === 'Escape' && !e.defaultPrevented) {
			if (inField && (e.target as Element).closest('.insp')) return;
			if (drag?.k === 'new') {
				drag = null;
				draft = null;
			} else if (placing !== null) placing = null;
			else if (polyPts.length) polyPts = [];
			else if (tool !== 'select') setTool('select');
			else sel = null;
			return;
		}
		if (inField || e.metaKey || e.ctrlKey || e.altKey) {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !inField) {
				e.preventDefault();
				undo();
			}
			return;
		}
		const k = e.key.toLowerCase();
		if (k === 'v') setTool('select');
		else if (k === 'r') setTool('rect');
		else if (k === 'p') setTool('poly');
	}

	// ---- Plan image
	let planSrc = $state<string | null>(null);
	$effect(() => {
		const name = floor.planImage;
		planSrc = null;
		if (!name) return;
		let live = true;
		planUrl(name).then((u) => live && (planSrc = u));
		return () => (live = false);
	});
	const pb = $derived.by(() => {
		const b = planBox({ ...floor, planScale });
		return planDraft ? { ...b, x: planDraft.x, y: planDraft.y } : b;
	});
	/** The plan's frame on screen: its box turned by the rotation. */
	const pframe = $derived.by(() => {
		const turned = pb.rot % 180 !== 0;
		const w = turned ? pb.h : pb.w;
		const h = turned ? pb.w : pb.h;
		const cx = pb.x + pb.w / 2;
		const cy = pb.y + pb.h / 2;
		return { x: cx - w / 2, y: cy - h / 2, w, h };
	});
	function togglePlan() {
		placing = null;
		tool = 'select';
		sel = planSel ? null : { k: 'plan' };
	}
	const commitPlan = (patch: Parameters<typeof updateFloor>[1]) => commit(() => updateFloor(floorId, patch));
	let planInput: HTMLInputElement | undefined = $state();
	let planError = $state('');
	// Replacing or removing the image can be undone: the old image stays stored until the editor closes.
	// Closing waits for a plan change still in flight, so cleanup never sees a new image as unused.
	let planBusy: Promise<unknown> = Promise.resolve();
	async function planFile(file: File | undefined) {
		if (!file) return;
		const before = snapshot();
		const run = uploadPlan(floorId, file, true);
		planBusy = run;
		planError = await run;
		if (!planError) history = [...history, before].slice(-50);
		if (planInput) planInput.value = '';
	}
	async function removePlan() {
		if (!confirm(`Remove the floor plan image from ${floor.name}? Rooms and items stay.`)) return;
		const run = commit(() => removeFloorPlan(floorId, true));
		planBusy = run;
		await run;
	}
	$effect(() => () => void planBusy.catch(() => {}).then(prunePlans));

	// ---- Set scale: a measuring line with two draggable ends
	let measure = $state<{ a: Point; b: Point }>({ a: [0, 0], b: [0, 0] });
	let ftIn = $state('');
	let inIn = $state('0');
	/** The room the scale's sanity check and default line use: the selected one, else the biggest. */
	let checkRoomId = $state<number | null>(null);
	const checkRoom = $derived(rooms.find((r) => r.id === checkRoomId) ?? null);
	function startMeasure() {
		const withShape = shapedRooms.filter((r) => r.shape);
		const pick =
			withShape.find((r) => r.id === selRoom?.id) ??
			[...withShape].sort((a, b) => {
				const A = bboxOf(a.shape!);
				const B = bboxOf(b.shape!);
				return B.w * B.h - A.w * A.h;
			})[0];
		checkRoomId = pick?.id ?? null;
		if (pick?.shape) {
			const b = bboxOf(pick.shape);
			measure = { a: [b.x, b.y], b: [b.x + b.w, b.y] };
			ftIn = upf ? String(Math.round(b.w / upf)) : '';
		} else {
			measure = { a: [floor.planWidth * 0.25, 40], b: [floor.planWidth * 0.75, 40] };
		}
		inIn = '0';
	}
	const mLen = $derived(dist(measure.a, measure.b));
	const lenFt = $derived((Number(ftIn) || 0) + (Number(inIn) || 0) / 12);
	const perFt = $derived(lenFt > 0 && mLen > 0 ? mLen / lenFt : 0);
	const measureLabel = $derived(
		lenFt > 0 ? `${Number(ftIn) || 0}′${Number(inIn) ? ` ${Number(inIn)}″` : ''} · ${Math.round(mLen)} px` : `${Math.round(mLen)} px`
	);
	const scaleCheck = $derived.by(() => {
		const s = checkRoom ? shapeOf(checkRoom) : null;
		return perFt && s && checkRoom ? `${checkRoom.name} would be ${sizeText(s, perFt)}` : 'Sizes appear once the scale is set.';
	});
	async function applyScale() {
		if (!perFt) return;
		const v = perFt;
		await commitPlan({ unitsPerFt: v });
		tool = 'select';
		sel = checkRoom ? { k: 'room', id: checkRoom.id } : null;
	}

	// ---- Inspector actions
	let nameError = $state('');
	$effect(() => {
		void sel;
		nameError = '';
	});
	async function rename(r: Room, e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const name = input.value.trim();
		if (!name) {
			input.value = r.name;
			return;
		}
		if (name === r.name) return;
		if (rooms.some((o) => o.id !== r.id && o.name.toLowerCase() === name.toLowerCase())) {
			nameError = `There's already a ${name} on this floor.`;
			return;
		}
		nameError = '';
		await commit(() => updateRoom(r.id, { name }));
	}
	const setKind = (r: Room, kind: 'interior' | 'exterior') => r.kind !== kind && commit(() => updateRoom(r.id, { kind }));
	function toPolygon(r: Room) {
		const s = shapeOf(r);
		if (s?.type === 'rect') commit(() => setRoomShape(r.id, { type: 'polygon', points: pointsOf(s) }));
	}
	async function removeRoom(r: Room) {
		if (!confirm(`Delete ${r.name}? Its items stay where they are and show as “Not in a room”.`)) return;
		sel = null;
		await commit(() => deleteRoom(r.id));
	}
	async function unplace(i: HouseItem) {
		sel = null;
		await commit(() => unplaceItem(i.id));
	}
	function startPlace(i: HouseItem) {
		tool = 'select';
		polyPts = [];
		sel = null;
		placing = placing === i.id ? null : i.id;
	}

	// ---- Derived view bits
	const selShape = $derived(selRoom ? shapeOf(selRoom) : null);
	const selBox = $derived(selShape ? bboxOf(selShape) : null);
	const insideCount = $derived(selShape ? itemsInside(selShape).length : 0);
	const selItemPos = $derived(selItem ? posOf(selItem) : null);
	const selItemRoom = $derived(selItemPos ? roomNameAt(selItemPos) : '');
	const selItemWas = $derived.by(() => {
		if (!selItem) return null;
		const was = wasRoom.get(selItem.id) ?? null;
		const wasName = was === null ? 'Not in a room' : (ix.roomById.get(was)?.name ?? 'Not in a room');
		return wasName !== selItemRoom ? wasName : null;
	});
	const banner = $derived(
		placing !== null
			? 'Click where it really is. Esc cancels.'
			: tool === 'rect'
				? 'Drag on the grid to draw a room. Edges snap to other rooms.'
				: tool === 'poly'
					? 'Click to add corners. Click the first corner to close the shape.'
					: ''
	);
	const placingItem = $derived(placing !== null ? (floorItems.find((i) => i.id === placing) ?? null) : null);
	const whereUnplaced = (i: HouseItem) => {
		const bs = ix.breakersOf(i);
		return `${ix.roomName(i.roomId)}${bs.length ? ` · on ${slotsText(ix, bs)}` : ''}`;
	};
	const cursor = $derived(placing !== null || tool === 'rect' || tool === 'poly' ? 'crosshair' : 'default');
	const pts = (s: Point[]) => s.map((p) => `${sx(p[0])},${sy(p[1])}`).join(' ');
	const itemAria = (i: HouseItem) => `${i.name}, ${ix.typeLabel(i)}, in ${roomNameAt(posOf(i)!)}. Drag to move.`;
	const roomAria = (r: Room, s: Shape) => `${r.name}${upf ? `, ${sizeText(s, upf).replace(' × ', ' by ')}` : ''}. Drag to move; arrow keys nudge.`;
</script>

<svelte:window {onkeydown} />

<aside aria-label="Layout" class="layout">
	<div class="lscroll">
		<div class="lh"><h2>Rooms</h2><span class="mono cnt">{rooms.length}</span></div>
		{#each rooms as r (r.id)}
			{@const s = shapeOf(r)}
			<button
				type="button"
				class="lrow"
				class:is-sel={selRoom?.id === r.id}
				aria-pressed={selRoom?.id === r.id}
				onclick={() => {
					setTool('select');
					sel = { k: 'room', id: r.id };
				}}
			>
				<span class="sq" aria-hidden="true"></span><span class="ln">{r.name}</span><span class="mono lsz"
					>{s ? sizeText(s, upf) : ''}</span
				>
			</button>
		{:else}
			<p class="lp">No rooms yet. Draw one with the Room or Polygon tool.</p>
		{/each}
		<div class="lh np"><h2>Not placed</h2><span class="mono cnt">{unplaced.length}</span></div>
		<p class="lp">Items from tracing or the Items page that aren’t on the map yet.</p>
		{#each unplaced as i (i.id)}
			<div class="urow">
				<span class="ico u"><Icon name={i.type} size={16} /></span>
				<span class="ut"><span class="un">{i.name}</span><span class="uw">{whereUnplaced(i)}</span></span>
				<button type="button" class="btn ub" class:btn-pri={placing === i.id} aria-pressed={placing === i.id} onclick={() => startPlace(i)}
					>{placing === i.id ? 'Placing…' : 'Place'}<span class="sr"> {i.name}</span></button
				>
			</div>
		{:else}
			<span class="lp">Everything on this floor is placed.</span>
		{/each}
	</div>
</aside>

<section aria-label="Floor layout editor" class="edcol">
	<div class="bar">
		<span class="edit-pill"><Icon name="pencil" size={14} stroke={2.2} />Editing {floor.name}</span>
		<div class="seg" role="group" aria-label="Tool">
			<button type="button" class="sb" class:is-on={tool === 'select'} aria-pressed={tool === 'select'} title="Select and move (V)" onclick={() => setTool('select')}
				>Select</button
			>
			<button type="button" class="sb" class:is-on={tool === 'rect'} aria-pressed={tool === 'rect'} title="Rectangle room (R)" onclick={() => setTool('rect')}
				>Room</button
			>
			<button type="button" class="sb" class:is-on={tool === 'poly'} aria-pressed={tool === 'poly'} title="Polygon room (P)" onclick={() => setTool('poly')}
				>Polygon</button
			>
			<button type="button" class="sb" class:is-on={tool === 'scale'} aria-pressed={tool === 'scale'} title="Set scale" onclick={() => setTool('scale')}
				>Scale</button
			>
		</div>
		<button type="button" class="sb planbtn" class:is-on={planSel} aria-pressed={planSel} onclick={togglePlan}>Floor plan</button>
		<div class="grow"></div>
		<button type="button" class="ibtn undo" aria-label="Undo" title="Undo" disabled={!history.length} onclick={undo}><Icon name="undo" size={16} /></button>
		<button type="button" class="btn btn-pri done" onclick={ondone}>Done editing</button>
	</div>

	<!-- Pointer handling for drawing and dragging. Every action here also has a keyboard path:
	     rooms and items are buttons that take arrow keys, tools have buttons, Esc cancels. -->
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		class="grid"
		bind:this={grid}
		bind:clientWidth={cw}
		bind:clientHeight={ch}
		style:cursor
		style:background-size="{20 * z}px {20 * z}px"
		style:background-position="{px}px {py}px"
		onpointerdown={ongridDown}
		onpointermove={ongridMove}
		onpointerup={ongridUp}
		onpointercancel={() => {
			drag = null;
			roomDraft = null;
			itemDraft = {};
			planDraft = null;
			draft = null;
		}}
		onpointerleave={() => (hover = null)}
		onclick={ongridClick}
	>
		{#if planSrc}
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
				style:opacity={planSel ? Math.max(planOpacity, 0.55) : planOpacity}
			/>
			{#if planSel && !floor.planLocked}
				<div
					class="pframe"
					role="presentation"
					style:left="{sx(pframe.x)}px"
					style:top="{sy(pframe.y)}px"
					style:width="{pframe.w * z}px"
					style:height="{pframe.h * z}px"
					onpointerdown={planDown}
				>
					<span class="tip ptip">Drag to line up with the rooms</span>
				</div>
			{/if}
		{/if}

		{#each rooms as r (r.id)}
			{@const s = shapeOf(r)}
			{#if s?.type === 'rect'}
				<button
					type="button"
					class="room"
					class:is-sel={selRoom?.id === r.id}
					class:is-ext={r.kind === 'exterior'}
					style:left="{sx(s.x)}px"
					style:top="{sy(s.y)}px"
					style:width="{s.w * z}px"
					style:height="{s.h * z}px"
					aria-label={roomAria(r, s)}
					aria-pressed={selRoom?.id === r.id}
					onpointerdown={(e) => roomDown(e, r)}
					onkeydown={(e) => roomKey(e, r)}
					onfocus={() => tool === 'select' && placing === null && (sel = { k: 'room', id: r.id })}><span class="rn">{r.name}</span></button
				>
			{/if}
		{/each}
		<svg class="polys" width={cw} height={ch}>
			{#each rooms as r (r.id)}
				{@const s = shapeOf(r)}
				{#if s?.type === 'polygon'}
					{@const b = bboxOf(s)}
					<g
						class="poly"
						class:is-sel={selRoom?.id === r.id}
						class:is-ext={r.kind === 'exterior'}
						role="button"
						tabindex="0"
						aria-label={roomAria(r, s)}
						aria-pressed={selRoom?.id === r.id}
						onpointerdown={(e) => roomDown(e, r)}
						onkeydown={(e) => roomKey(e, r)}
						ondblclick={(e) => polyDblClick(e, r)}
						onfocus={() => tool === 'select' && placing === null && (sel = { k: 'room', id: r.id })}
					>
						<polygon points={pts(s.points)} />
						<text x={sx(b.x) + 10} y={sy(b.y) + 19}>{r.name}</text>
					</g>
				{/if}
			{/each}
			{#if drag?.k === 'new' && draft}
				<rect class="draft" x={sx(draft.x)} y={sy(draft.y)} width={draft.w * z} height={draft.h * z} />
			{/if}
			{#if polyPts.length}
				{@const all = hover ? [...polyPts, hover] : polyPts}
				<polyline class="draft" points={pts(all)} />
				{#each polyPts as p, n (n)}
					<circle cx={sx(p[0])} cy={sy(p[1])} r={n === 0 ? 6 : 5} class={n === 0 ? 'pfirst' : 'pcorner'} />
				{/each}
			{/if}
			{#if tool === 'scale'}
				<line class="mline" x1={sx(measure.a[0])} y1={sy(measure.a[1])} x2={sx(measure.b[0])} y2={sy(measure.b[1])} />
			{/if}
		</svg>

		{#if selRoom && selShape && tool === 'select'}
			{#if selShape.type === 'rect'}
				{#each HANDLES as [h, fx, fy, cur] (h)}
					<button
						type="button"
						class="hd"
						style:left="{sx(selShape.x + selShape.w * fx)}px"
						style:top="{sy(selShape.y + selShape.h * fy)}px"
						style:cursor={cur}
						aria-label="Resize {selRoom.name} from {h.toUpperCase()}"
						onpointerdown={(e) => handleDown(e, selRoom, h)}
					></button>
				{/each}
			{:else}
				{#each selShape.points as p, n (n)}
					<button
						type="button"
						class="hd"
						style:left="{sx(p[0])}px"
						style:top="{sy(p[1])}px"
						style:cursor="move"
						aria-label="Corner {n + 1} of {selRoom.name}"
						onpointerdown={(e) => vertexDown(e, selRoom, n)}
					></button>
				{/each}
			{/if}
			{#if upf && selBox}
				<span class="dim w" style:left="{sx(selBox.x + selBox.w / 2)}px" style:top="{sy(selBox.y) - 26}px">{feet(selBox.w, upf)}</span>
				<span class="dim" style:left="{sx(selBox.x + selBox.w) + 12}px" style:top="{sy(selBox.y + selBox.h / 2) - 10}px">{feet(selBox.h, upf)}</span>
			{/if}
		{/if}

		{#each floorItems as i (i.id)}
			{@const p = posOf(i)}
			{#if p}
				<button
					type="button"
					class="it"
					class:is-sel={selItem?.id === i.id}
					class:is-drag={drag?.k === 'item' && drag.id === i.id && drag.moved}
					style:left="{sx(p[0]) - 16}px"
					style:top="{sy(p[1]) - 16}px"
					aria-label={itemAria(i)}
					aria-pressed={selItem?.id === i.id}
					onpointerdown={(e) => itemDown(e, i)}
					onkeydown={(e) => itemKey(e, i)}
					onfocus={() => tool === 'select' && placing === null && (sel = { k: 'item', id: i.id })}
				>
					<Icon name={i.type} size={16} />
				</button>
			{/if}
		{/each}

		{#if guide.v !== undefined}<div class="guide v" style:left="{sx(guide.v)}px"></div>{/if}
		{#if guide.h !== undefined}<div class="guide h" style:top="{sy(guide.h)}px"></div>{/if}
		{#if tip}
			<span class="tip" style:left="{sx(tip.x) + (drag?.k === 'item' ? 22 : 8)}px" style:top="{sy(tip.y) + (drag?.k === 'item' ? -30 : 6)}px">{tip.t}</span>
		{/if}

		{#if tool === 'scale'}
			<button
				type="button"
				class="mh"
				style:left="{sx(measure.a[0])}px"
				style:top="{sy(measure.a[1])}px"
				aria-label="Measuring line start. Drag, or use the arrow keys."
				onpointerdown={(e) => measureDown(e, 'a')}
				onkeydown={(e) => measureKey(e, 'a')}
			></button>
			<button
				type="button"
				class="mh"
				style:left="{sx(measure.b[0])}px"
				style:top="{sy(measure.b[1])}px"
				aria-label="Measuring line end. Drag, or use the arrow keys."
				onpointerdown={(e) => measureDown(e, 'b')}
				onkeydown={(e) => measureKey(e, 'b')}
			></button>
			<span
				class="tip"
				style:left="{(sx(measure.a[0]) + sx(measure.b[0])) / 2 - 40}px"
				style:top="{(sy(measure.a[1]) + sy(measure.b[1])) / 2 + 14}px">{measureLabel}</span
			>
		{/if}

		{#if placingItem && hover}
			<div class="ghost" style:left="{sx(hover[0]) - 16}px" style:top="{sy(hover[1]) - 16}px"><Icon name={placingItem.type} size={16} /></div>
		{/if}

		{#if banner}
			<div class="banner ovl" role="status">
				<span>{banner}</span>
				<button
					type="button"
					class="btn bb"
					onclick={() => {
						placing = null;
						setTool('select');
					}}>Cancel</button
				>
			</div>
		{/if}
		<div class="hints ovl">
			<span><span class="mono k">Arrows</span> nudge 1 grid step</span><span><span class="mono k">Shift</span> no snapping</span><span
				><span class="mono k">Esc</span> cancel</span
			>
		</div>
		<div class="zoom ovl">
			<button type="button" class="zb" aria-label="Zoom out" onclick={() => zoomAt(1 / 1.25)}>−</button>
			<span class="mono zt" aria-live="polite">{Math.round(z * 100)}%</span>
			<button type="button" class="zb" aria-label="Zoom in" onclick={() => zoomAt(1.25)}>+</button>
			<button type="button" class="zb fit" aria-label="Fit floor to screen" onclick={fit}><Icon name="fit" size={16} /></button>
		</div>
	</div>
</section>

<aside aria-label="Selection" class="insp">
	<div class="iscroll">
		{#if tool === 'scale'}
			<div class="stack">
				<span class="ov">Set scale</span>
				<h2 class="h20">Measure one wall</h2>
				<span class="lead"
					>Drag the two amber dots to the ends of a wall you know, then type its length. Sizes show in feet everywhere after this.</span
				>
				<div class="two">
					<div class="fld"><label for="sc-ft">Feet</label><input id="sc-ft" class="inp" type="number" min="0" bind:value={ftIn} /></div>
					<div class="fld"><label for="sc-in">Inches</label><input id="sc-in" class="inp" type="number" min="0" max="11" bind:value={inIn} /></div>
				</div>
				<div class="readout">
					<span class="mono">{perFt ? `1 ft = ${perFt.toFixed(1)} px` : 'Enter a length'}</span><span class="rm">{scaleCheck}</span>
				</div>
				<button type="button" class="btn btn-pri" disabled={!perFt} onclick={applyScale}>Apply scale</button>
			</div>
		{:else if selRoom && selShape}
			{@const r = selRoom}
			<div class="stack s16">
				<span class="ov">Room · {floor.name}</span>
				<div class="fld">
					<label for="rm-name">Name</label>
					<input id="rm-name" class="inp" type="text" value={r.name} bind:this={nameInput} onchange={(e) => rename(r, e)} />
					{#if nameError}<span class="err" role="alert">{nameError}</span>{/if}
				</div>
				<div class="fld">
					<span class="k" id="rk">Kind</span>
					<div class="seg" role="group" aria-labelledby="rk">
						<button type="button" class="sb half" class:is-on={r.kind === 'interior'} aria-pressed={r.kind === 'interior'} onclick={() => setKind(r, 'interior')}
							>Interior</button
						>
						<button type="button" class="sb half" class:is-on={r.kind === 'exterior'} aria-pressed={r.kind === 'exterior'} onclick={() => setKind(r, 'exterior')}
							>Exterior area</button
						>
					</div>
				</div>
				<div class="two">
					<div class="fld"><span class="k">Size</span><span class="mono ro">{upf ? sizeText(selShape, upf) : '—'}</span></div>
					<div class="fld"><span class="k">Shape</span><span class="ro">{selShape.type === 'rect' ? 'Rectangle' : 'Polygon'}</span></div>
				</div>
				{#if !upf}
					<button type="button" class="btn start" onclick={() => setTool('scale')}>Set a scale to see sizes in feet</button>
				{/if}
				{#if selShape.type === 'rect'}
					<button type="button" class="btn start" onclick={() => toPolygon(r)}>Convert to polygon (add corners)</button>
				{:else}
					<span class="hint">Drag a corner to move it. Double-click an edge to add a corner.</span>
				{/if}
				<label class="chk"><input type="checkbox" bind:checked={carry} /><span>Move the {insideCount} items inside with the room</span></label>
				<div class="danger">
					<button type="button" class="btn btn-warn start" onclick={() => removeRoom(r)}>Delete room</button>
					<span class="hint">Its items stay where they are and show as “Not in a room”.</span>
				</div>
			</div>
		{:else if selItem}
			{@const i = selItem}
			<div class="stack s14">
				<span class="ov">{ix.typeLabel(i)} · {floor.name}</span>
				<h2>{i.name}</h2>
				<div class="roombox">
					<span class="k">Room (from where it sits)</span>
					<span class="rb">{selItemRoom}</span>
					{#if selItemWas}<span class="was">Was {selItemWas}</span>{/if}
				</div>
				<span class="hint">Drag it, or use the arrow keys. Its room updates from the position; breakers don’t change.</span>
				<button type="button" class="btn start" onclick={() => unplace(i)}>Remove from map</button>
			</div>
		{:else if planSel}
			<div class="stack s16">
				<span class="ov">Floor plan image</span>
				<input
					bind:this={planInput}
					class="sr"
					type="file"
					accept={PLAN_ACCEPT.join(',')}
					tabindex="-1"
					aria-hidden="true"
					onchange={(e) => planFile(e.currentTarget.files?.[0])}
				/>
				{#if floor.planImage}
					<span class="mono fname">{floor.planImage}</span>
					<div class="fld">
						<div class="lr"><label for="pl-op">Opacity</label><span class="mono pv">{Math.round(planOpacity * 100)}%</span></div>
						<input
							id="pl-op"
							type="range"
							min="0"
							max="100"
							step="5"
							value={Math.round(planOpacity * 100)}
							oninput={(e) => (planOpacity = Number(e.currentTarget.value) / 100)}
							onchange={() => commitPlan({ planOpacity })}
						/>
					</div>
					<div class="fld">
						<div class="lr"><label for="pl-sc">Size</label><span class="mono pv">{Math.round(planScale * 100)}%</span></div>
						<input
							id="pl-sc"
							type="range"
							min="50"
							max="150"
							step="1"
							value={Math.round(planScale * 100)}
							oninput={(e) => (planScale = Number(e.currentTarget.value) / 100)}
							onchange={() => commitPlan({ planScale })}
						/>
					</div>
					<div class="fld">
						<span class="k">Rotate</span>
						<div class="row">
							<button type="button" class="btn grow" onclick={() => commitPlan({ planRotation: (floor.planRotation + 270) % 360 })}>↺ 90°</button>
							<button type="button" class="btn grow" onclick={() => commitPlan({ planRotation: (floor.planRotation + 90) % 360 })}>↻ 90°</button>
						</div>
					</div>
					<span class="hint">Drag the image on the canvas to line it up. Rooms don’t move with it.</span>
					<label class="chk"
						><input type="checkbox" checked={floor.planLocked} onchange={(e) => commitPlan({ planLocked: e.currentTarget.checked })} /><span
							>Lock the plan so it can’t be dragged by accident</span
						></label
					>
					<div class="row">
						<button type="button" class="btn grow" onclick={() => planInput?.click()}>Replace</button>
						<button type="button" class="btn btn-warn grow" onclick={removePlan}>Remove</button>
					</div>
				{:else}
					<span class="hint">No floor plan image on {floor.name} yet.</span>
					<button type="button" class="btn" onclick={() => planInput?.click()}>Upload a floor plan</button>
				{/if}
				{#if planError}<span class="err" role="alert">{planError}</span>{/if}
			</div>
		{:else}
			<div class="stack s10">
				<h2 class="h20">Edit the layout</h2>
				<span class="hint lg"
					>Click a room to move or resize it, drag items to where they really are, or place the ones on the left. Circuits are hidden while you edit.</span
				>
			</div>
		{/if}
	</div>
</aside>

<style>
	/* Left: rooms and unplaced items */
	.layout {
		width: 300px;
		flex-shrink: 0;
		background: var(--raised);
		border-right: 1px solid var(--line-2);
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	.lscroll {
		flex-grow: 1;
		min-height: 0;
		overflow: auto;
		padding: 20px 12px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.lh {
		padding: 0 8px 6px;
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}
	.lh h2 {
		font-size: 18px;
		font-weight: 800;
		font-stretch: 108%;
	}
	.lh.np {
		padding-top: 18px;
		border-top: 1px solid var(--line);
		margin-top: 10px;
	}
	.cnt {
		font-size: 12px;
		color: var(--muted);
	}
	.lp {
		margin: 0 8px 6px;
		font-size: 13px;
		color: var(--muted);
		line-height: 1.45;
	}
	.lrow {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		min-height: 44px;
		padding: 6px 10px;
		border: 1px solid transparent;
		border-radius: var(--r-lg);
		background: transparent;
		font: inherit;
		color: var(--ink);
		text-align: left;
		cursor: pointer;
	}
	.lrow:hover {
		background: var(--hover);
	}
	.lrow.is-sel {
		background: var(--amber-soft);
		border-color: var(--amber);
	}
	.sq {
		width: 14px;
		height: 14px;
		border: 2px solid var(--wall);
		border-radius: 2px;
		flex-shrink: 0;
	}
	.ln {
		flex-grow: 1;
		font-size: 14px;
		font-weight: 600;
	}
	.lsz {
		font-size: 11px;
		color: var(--muted);
	}
	.urow {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 8px;
	}
	.ico.u {
		width: 28px;
		height: 28px;
	}
	.ut {
		flex-grow: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.un {
		font-size: 13px;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.uw {
		font-size: 11px;
		color: var(--muted);
	}
	.ub {
		height: 34px;
		padding: 0 10px;
		font-size: 13px;
	}

	/* Middle: toolbar and canvas */
	.edcol {
		flex: 1 1 0;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.bar {
		height: 60px;
		flex-shrink: 0;
		padding: 0 12px;
		display: flex;
		align-items: center;
		gap: 10px;
		background: var(--raised);
		border-bottom: 1px solid var(--line-2);
	}
	.edit-pill {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		height: 30px;
		padding: 0 12px;
		border-radius: 15px;
		background: var(--amber-soft);
		border: 1px solid var(--amber);
		font-size: 13px;
		font-weight: 700;
		color: var(--amber-ink);
		white-space: nowrap;
	}
	.planbtn {
		border: 1px solid var(--field);
	}
	.grow {
		flex-grow: 1;
	}
	.undo {
		width: 38px;
		height: 38px;
	}
	.done {
		height: 38px;
	}
	.grid {
		flex-grow: 1;
		min-height: 0;
		position: relative;
		overflow: hidden;
		touch-action: none;
		user-select: none;
		background-color: var(--grid-bg);
		background-image: linear-gradient(var(--grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--grid-line) 1px, transparent 1px);
	}
	.plan {
		position: absolute;
		pointer-events: none;
		max-width: none;
		transform-origin: center;
	}
	.pframe {
		position: absolute;
		border: 2px dashed var(--amber);
		cursor: move;
		z-index: 7;
		touch-action: none;
	}
	.ptip {
		left: 8px;
		top: 8px;
	}
	.room {
		position: absolute;
		border: 2px solid var(--wall);
		background: var(--room);
		padding: 0;
		margin: 0;
		font: inherit;
		color: inherit;
		text-align: left;
		cursor: move;
		touch-action: none;
	}
	.room:hover {
		border-color: var(--ink);
	}
	.room.is-sel {
		border-color: var(--amber);
		box-shadow: 0 0 0 1px var(--amber);
		z-index: 1;
	}
	.room.is-ext {
		border-style: dashed;
	}
	.room:focus-visible {
		outline: 3px solid var(--focus);
		outline-offset: 2px;
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
		cursor: move;
	}
	.poly polygon {
		fill: var(--room);
		stroke: var(--wall);
		stroke-width: 2;
	}
	.poly:hover polygon {
		stroke: var(--ink);
	}
	.poly.is-ext polygon {
		stroke-dasharray: 6 4;
	}
	.poly.is-sel polygon {
		stroke: var(--amber);
		stroke-width: 3;
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
	.poly.is-sel text {
		fill: var(--ink);
	}
	.draft {
		fill: color-mix(in srgb, var(--amber) 12%, transparent);
		stroke: var(--amber);
		stroke-width: 2;
		stroke-dasharray: 6 5;
	}
	.pfirst {
		fill: var(--amber);
	}
	.pcorner {
		fill: none;
		stroke: var(--amber);
		stroke-width: 2;
	}
	.mline {
		stroke: var(--amber);
		stroke-width: 3;
	}
	.hd {
		position: absolute;
		width: 14px;
		height: 14px;
		margin: -7px 0 0 -7px;
		border: 2px solid var(--amber);
		background: var(--surface);
		border-radius: 3px;
		padding: 0;
		z-index: 3;
		touch-action: none;
	}
	.hd:hover {
		background: var(--amber);
	}
	.dim {
		position: absolute;
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 600;
		background: var(--amber);
		color: var(--on-amber);
		padding: 2px 6px;
		border-radius: 3px;
		white-space: nowrap;
		pointer-events: none;
		z-index: 3;
	}
	.dim.w {
		transform: translateX(-50%);
	}
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
		cursor: grab;
		z-index: 2;
		touch-action: none;
	}
	.it.is-sel {
		box-shadow:
			0 0 0 3px var(--surface),
			0 0 0 5.5px var(--amber);
		z-index: 4;
	}
	.it.is-drag {
		cursor: grabbing;
		transform: scale(1.15);
		box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35);
	}
	.it:focus-visible {
		outline: 3px solid var(--focus);
		outline-offset: 3px;
	}
	.guide {
		position: absolute;
		pointer-events: none;
		z-index: 5;
	}
	.guide.v {
		top: 0;
		bottom: 0;
		width: 0;
		border-left: 1.5px dashed var(--amber);
	}
	.guide.h {
		left: 0;
		right: 0;
		height: 0;
		border-top: 1.5px dashed var(--amber);
	}
	.tip {
		position: absolute;
		z-index: 6;
		font-size: 12px;
		font-weight: 600;
		background: var(--ink);
		color: var(--bg);
		padding: 4px 8px;
		border-radius: var(--r-sm);
		white-space: nowrap;
		pointer-events: none;
	}
	.mh {
		position: absolute;
		width: 18px;
		height: 18px;
		margin: -9px 0 0 -9px;
		border-radius: 50%;
		border: 2.5px solid var(--amber);
		background: var(--surface);
		padding: 0;
		z-index: 6;
		cursor: grab;
		touch-action: none;
	}
	.ghost {
		position: absolute;
		width: 32px;
		height: 32px;
		border-radius: 50%;
		border: 2px dashed var(--amber);
		background: var(--ghost);
		color: var(--ink);
		display: flex;
		align-items: center;
		justify-content: center;
		pointer-events: none;
		z-index: 6;
	}
	.banner {
		position: absolute;
		top: 14px;
		left: 50%;
		transform: translateX(-50%);
		background: var(--surface);
		border: 1px solid var(--ink);
		border-radius: var(--r-xl);
		padding: 10px 10px 10px 16px;
		display: flex;
		align-items: center;
		gap: 12px;
		box-shadow: 0 6px 20px rgba(0, 0, 0, 0.14);
		z-index: 8;
		white-space: nowrap;
		font-size: 14px;
		cursor: default;
	}
	.bb {
		height: 34px;
	}
	.hints {
		position: absolute;
		left: 14px;
		bottom: 12px;
		font-size: 12px;
		color: var(--muted);
		display: flex;
		gap: 14px;
		pointer-events: none;
	}
	.k {
		color: var(--soft);
	}
	.zoom {
		position: absolute;
		right: 16px;
		bottom: 14px;
		display: flex;
		align-items: center;
		background: var(--surface);
		border: 1px solid var(--line-2);
		border-radius: var(--r-lg);
		overflow: hidden;
		z-index: 6;
		cursor: default;
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

	/* Right: inspector */
	.insp {
		width: 320px;
		flex-shrink: 0;
		background: var(--surface);
		border-left: 1px solid var(--line-2);
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	.iscroll {
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
		gap: 16px;
	}
	.s14 {
		gap: 14px;
	}
	.s10 {
		gap: 10px;
	}
	.insp h2 {
		font-size: 22px;
		font-weight: 800;
		font-stretch: 105%;
		line-height: 1.2;
		overflow-wrap: anywhere;
	}
	.insp h2.h20 {
		font-size: 20px;
	}
	.lead {
		font-size: 14px;
		line-height: 1.5;
		color: var(--soft);
	}
	.two {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 12px;
	}
	.readout {
		padding: 12px 14px;
		border-radius: var(--r-lg);
		background: var(--bg);
		font-size: 13px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.rm {
		color: var(--muted);
	}
	.fld .k {
		color: var(--muted);
	}
	.half {
		flex: 1 1 0;
		justify-content: center;
	}
	.ro {
		height: 44px;
		display: flex;
		align-items: center;
		padding: 0 12px;
		background: var(--bg);
		border-radius: var(--r-md);
		font-size: 13px;
	}
	.start {
		justify-content: flex-start;
	}
	.hint {
		font-size: 13px;
		color: var(--muted);
		line-height: 1.45;
	}
	.hint.lg {
		font-size: 14px;
		line-height: 1.5;
	}
	.danger {
		padding-top: 14px;
		border-top: 1px solid var(--line);
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.danger .hint {
		font-size: 12px;
	}
	.err {
		font-size: 13px;
		color: var(--warn);
	}
	.roombox {
		padding: 12px 14px;
		border-radius: var(--r-lg);
		background: var(--bg);
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.roombox .k {
		font-size: 12px;
		font-weight: 600;
		color: var(--muted);
	}
	.rb {
		font-size: 15px;
		font-weight: 700;
	}
	.was {
		font-size: 12px;
		color: var(--amber-ink);
		font-weight: 600;
	}
	.fname {
		font-size: 14px;
		font-weight: 600;
	}
	.lr {
		display: flex;
		justify-content: space-between;
	}
	.lr .pv {
		font-size: 12px;
	}
	input[type='range'] {
		accent-color: var(--amber);
	}
	.row {
		display: flex;
		gap: 8px;
	}
</style>
