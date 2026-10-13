<script lang="ts">
	// Editing the map layout (docs/design/DESIGN.md §5.10, mockups MapEditRoom / MapEditScale).
	// Viewing and editing are separate modes, so a stray drag never moves a wall. Drags edit a
	// local draft and save on release; every saved change can be undone for this session.
	import { tick, untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import Icon from '$lib/components/Icon.svelte';
	import { mutate, type HouseIndex, type HouseItem } from '$lib/house';
	import {
		createItem,
		createRoom,
		deleteItems,
		deleteRoom,
		placeItem,
		removeFloorPlan,
		restoreLayout,
		setItemBreakers,
		setRoomShape,
		unplaceItem,
		updateItem,
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
	import { ITEM_TYPES, ITEM_TYPE_LABELS, type ItemType } from '$lib/constants';
	import Shortcuts from './Shortcuts.svelte';
	import {
		GRID,
		MIN,
		cursorStep,
		fromField,
		isTextField,
		posText,
		sizeOf,
		snapVal,
		spokenPos,
		spokenSize,
		toField,
		toGrid
	} from './keys';

	let {
		ix,
		floorId,
		initialRoom = null,
		drawFirst = false,
		ondone
	}: {
		ix: HouseIndex;
		floorId: number;
		initialRoom?: number | null;
		/** Open with the Room tool picked ("Draw rooms" on the empty-floor card). */
		drawFirst?: boolean;
		ondone: () => void;
	} = $props();

	const floor = $derived(ix.floorById.get(floorId)!);
	const upf = $derived(floor.unitsPerFt);
	const rooms = $derived(ix.house.rooms.filter((r) => r.floorId === floorId).sort((a, b) => a.id - b.id));
	const floorItems = $derived(ix.house.items.filter((i) => i.floorId === floorId));
	const unplaced = $derived(floorItems.filter((i) => i.x === null || i.y === null));
	/** Each item's room when editing started, for "Was Half bath". */
	const wasRoom = untrack(() => new Map(ix.house.items.map((i) => [i.id, i.roomId])));

	// ---- Selection and tools
	type ESel = { k: 'room'; id: number } | { k: 'item'; id: number } | { k: 'plan' } | null;
	type ETool = 'select' | 'rect' | 'poly' | 'item' | 'scale';
	let sel = $state<ESel>(untrack(() => (initialRoom !== null ? { k: 'room', id: initialRoom } : null)));
	// A floor with no rooms yet opens straight into drawing when asked to, or when there's a plan to trace.
	let tool = $state<ETool>(untrack(() => ((drawFirst || !!floor.planImage) && !rooms.length ? 'rect' : 'select')));
	let placing = $state<number | null>(null);
	let carry = $state(true);

	const selId = (k: 'room' | 'item') => (sel && sel.k === k ? sel.id : null);
	const selRoom = $derived(rooms.find((r) => r.id === selId('room')) ?? null);
	const selItem = $derived(floorItems.find((i) => i.id === selId('item') && i.x !== null) ?? null);
	const planSel = $derived(sel?.k === 'plan');

	function setTool(t: ETool) {
		const changed = t !== tool;
		tool = t;
		placing = null;
		polyPts = [];
		kbCorner = null;
		if (t !== 'select') sel = null;
		if (t === 'scale') startMeasure();
		if (t === 'rect' || t === 'poly' || t === 'item') startCursor();
		if (changed) announce(toolSaid(t));
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
	/** Rooms in reading order, top-left first, so Tab meets them the way the eye does (§5.21). */
	const orderedRooms = $derived(
		rooms
			.map((r) => ({ r, b: parseShape(r.shape) }))
			.map(({ r, b }) => ({ r, b: b ? bboxOf(b) : { x: Infinity, y: Infinity, w: 0, h: 0 } }))
			.sort((a, b) => a.b.y - b.b.y || a.b.x - b.b.x || b.b.w * b.b.h - a.b.w * a.b.h || a.r.id - b.r.id)
			.map(({ r }) => r)
	);
	const itemsInside = (s: Shape) =>
		floorItems.filter((i) => {
			const p = posOf(i);
			return p !== null && contains(s, p);
		});

	// ---- Undo: a snapshot of the floor's layout before each saved change
	/** A snapshot to go back to, and the item the change created, which undo deletes. */
	type Step = LayoutSnapshot & { created?: number };
	let history = $state<Step[]>([]);
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
		if (s.created !== undefined && selId('item') === s.created) sel = null;
		await mutate(async () => {
			if (s.created !== undefined) await deleteItems([s.created]);
			await restoreLayout(s);
		});
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
		// The drawing tools draw over existing rooms too (a closet inside a bedroom); rooms and
		// items don't take the pointer from them.
		const drawing = tool === 'rect' || tool === 'poly' || tool === 'item';
		if (!drawing && (e.target as Element).closest('.room, .poly, .it, .hd, .mh, .pframe')) return;
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
		if (tool === 'item') {
			const at: Point = e.shiftKey ? [clampX(p[0]), clampY(p[1])] : [clampX(toGrid(p[0])), clampY(toGrid(p[1]))];
			e.preventDefault();
			addItem(at);
			return;
		}
		drag = { k: 'pan', x0: e.clientX, y0: e.clientY, px0: px, py0: py, moved: false };
	}

	// A double press near a polygon's edge adds a corner there, even where the edge sits under a
	// rectangle room's button: the edge is hit-tested here, before the room under the pointer gets the
	// event. Single presses go to whatever is under the pointer. Double presses are spotted by hand:
	// drags capture the pointer to the grid, so the browser's own dblclick never reaches a room.
	const EDGE_PX = 12;
	let lastPress: { t: number; x: number; y: number } | null = null;
	function edgeDist(s: Shape, p: Point): number {
		if (s.type !== 'polygon') return Infinity;
		let best = Infinity;
		s.points.forEach((a, i) => (best = Math.min(best, dist(p, nearestOnSegment(p, a, s.points[(i + 1) % s.points.length])))));
		return best * z;
	}
	function ongridDownCapture(e: PointerEvent) {
		if (e.button !== 0 || tool !== 'select' || placing !== null || inOverlay(e)) return;
		// Only presses on a room: empty grid near an edge still pans and deselects.
		if (!(e.target as Element).closest('.room, .poly')) return;
		const prev = lastPress;
		const dbl = !!prev && e.timeStamp - prev.t < 400 && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 5;
		lastPress = dbl ? null : { t: e.timeStamp, x: e.clientX, y: e.clientY };
		if (!dbl) return;
		// The polygon whose edge is closest, the selected one on a tie.
		const p = toMap(e);
		let hit: Room | null = null;
		let best = EDGE_PX;
		for (const r of selRoom ? [selRoom, ...rooms] : rooms) {
			const sh = shapeOf(r);
			const d = sh ? edgeDist(sh, p) : Infinity;
			if (d < best || (d === best && !hit)) [hit, best] = [r, d];
		}
		if (!hit) return;
		e.stopPropagation();
		// The room under the pointer would take focus and select itself; focus the polygon instead.
		e.preventDefault();
		grid?.querySelector<HTMLElement>(`a.poly[data-room="${hit.id}"]`)?.focus({ preventScroll: true });
		sel = { k: 'room', id: hit.id };
		polyDblClick(e, hit);
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
		// Moving the pointer hides the drawing cursor until the next arrow key. Browsers also send
		// moves when the page moves under a still pointer, so only a real move counts.
		if (!lastPointer || lastPointer[0] !== e.clientX || lastPointer[1] !== e.clientY) kbShow = false;
		lastPointer = [e.clientX, e.clientY];
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
			const t = sizeTip(bboxOf(shape));
			tip = t ? { x: p[0], y: p[1], t } : null;
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
			tip = t ? { x: p[0], y: p[1], t } : null;
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
	let layoutEl: HTMLElement | undefined = $state();
	async function addRoom(shape: Shape) {
		const name = newRoomName();
		const id = await commit(() => createRoom({ floorId, name, kind: 'interior', shape }));
		tool = 'select';
		sel = { k: 'room', id };
		await tick();
		nameInput?.focus();
		nameInput?.select();
	}

	// ---- Item tool: click to drop a new item of the picked type; it takes the room under it
	let newType = $state<ItemType>('outlet');
	let itemName: HTMLInputElement | undefined = $state();
	async function addItem(at: Point) {
		const type = newType;
		const before: Step = snapshot();
		const roomId = roomAt(at, shapedRooms)?.id ?? null;
		const id = await mutate(() =>
			createItem({ type, name: `New ${ITEM_TYPE_LABELS[type].one.toLowerCase()}`, floorId, roomId, x: Math.round(at[0]), y: Math.round(at[1]) })
		);
		history = [...history, { ...before, created: id }].slice(-50);
		tool = 'select';
		sel = { k: 'item', id };
		await tick();
		itemName?.focus();
		itemName?.select();
	}
	async function renameItem(i: HouseItem, e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const name = input.value.trim();
		if (!name) return void (input.value = i.name);
		if (name !== i.name) await mutate(() => updateItem(i.id, { name }));
	}
	async function pickBreaker(i: HouseItem, e: Event) {
		const v = (e.currentTarget as HTMLSelectElement).value;
		await mutate(() => setItemBreakers(i.id, v ? [Number(v)] : []));
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
	function polyDblClick(e: PointerEvent, r: Room) {
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
		if (bestD * z > EDGE_PX) return;
		const points = [...s.points];
		points.splice(best + 1, 0, [Math.round(at[0]), Math.round(at[1])]);
		commit(() => setRoomShape(r.id, { type: 'polygon', points }));
	}

	// ---- Keyboard drawing (§5.21): a cursor on the canvas that the arrow keys move and Enter acts at.
	// It shows only while the canvas has keyboard focus and a drawing tool or Place is on.
	let kc = $state<Point>([0, 0]);
	let kbCorner = $state<Point | null>(null);
	let canvasFocused = $state(false);
	/** The last thing to move the cursor was a key, not the pointer. */
	let kbShow = $state(false);
	let focusByKey = false;
	const kbTool = $derived(tool === 'rect' || tool === 'poly' || tool === 'item' || placing !== null);
	const kbOn = $derived(canvasFocused && kbShow && kbTool);
	const rectOf = (a: Point, b: Point): Rect => ({
		x: Math.min(a[0], b[0]),
		y: Math.min(a[1], b[1]),
		w: Math.abs(b[0] - a[0]),
		h: Math.abs(b[1] - a[1])
	});
	/** The room the cursor was last announced in. */
	let cursorRoom = '';
	/** Starts the cursor at a point (snapped), or in the middle of the view. */
	function startCursor(at?: Point) {
		const c: Point = at ?? [(cw / 2 - px) / z, (ch / 2 - py) / z];
		kc = [clampX(toGrid(c[0])), clampY(toGrid(c[1]))];
		kbCorner = null;
		cursorRoom = roomNameAt(kc);
	}
	/** Pans so the cursor stays in view, clear of the status line. */
	function keepInView(p: Point) {
		const m = 40;
		const x = sx(p[0]);
		const y = sy(p[1]);
		if (x < m) px += m - x;
		else if (x > cw - m) px -= x - (cw - m);
		if (y < m) py += m - y;
		else if (y > ch - m - 60) py -= y - (ch - m - 60);
	}
	function focusCanvas() {
		focusByKey = true;
		kbShow = true;
		grid?.focus({ preventScroll: true });
		focusByKey = false;
	}
	function canvasFocus(e: FocusEvent) {
		if (e.target !== grid) return;
		canvasFocused = true;
		// A mouse click focuses the canvas too, but never shows the cursor.
		kbShow = focusByKey || grid.matches(':focus-visible');
	}
	let lastPointer: [number, number] | null = null;

	// Announcements go to a separate, visually hidden live region, so the status line can follow
	// every arrow press without being read out each time.
	let said = $state('');
	let sayTimer: ReturnType<typeof setTimeout> | undefined;
	function announce(t: string) {
		said = '';
		clearTimeout(sayTimer);
		sayTimer = setTimeout(() => (said = t), 60);
	}
	$effect(() => () => clearTimeout(sayTimer));

	/** The status line (§5.21), or the same words for a screen reader. */
	function statusText(spoken: boolean): string {
		const at = (p: Point) => (spoken ? spokenPos(p, upf) : posText(p, upf));
		const size = (w: number, h: number) => (spoken ? spokenSize(w, h, upf) : sizeOf(w, h, upf));
		const where = roomNameAt(kc);
		if (tool === 'rect') {
			if (!kbCorner) return `Room · cursor at ${at(kc)} in ${where}. Arrow keys move, Enter sets the first corner.`;
			const r = rectOf(kbCorner, kc);
			return `Room · first corner at ${at(kbCorner)} · cursor at ${at(kc)}, ${size(r.w, r.h)}. Enter sets the other corner.`;
		}
		if (tool === 'poly') {
			const n = polyPts.length;
			return `Polygon · ${n} corner${n === 1 ? '' : 's'} · cursor at ${at(kc)}. Enter adds a corner, C closes, Backspace removes the last.`;
		}
		if (placingItem) return `Placing ${placingItem.name} · cursor at ${at(kc)} in ${where}. Enter drops it, Esc cancels.`;
		if (tool === 'item') return `New item · cursor at ${at(kc)} in ${where}. Enter drops it here.`;
		if (tool !== 'select') return 'Tab to a room or item, or press R, P or I to draw.';
		if (selItem && selItemPos) return `${selItem.name} · in ${selItemRoom} at ${at(selItemPos)}. Arrows move it; Delete takes it off the map.`;
		if (selRoom && selBox) {
			const resize = selShape?.type === 'rect' ? ', Alt+arrows resize' : '';
			return `${selRoom.name} selected · ${size(selBox.w, selBox.h)} at ${at([selBox.x, selBox.y])}. Arrows move${resize}.`;
		}
		return 'Tab to a room or item, or press R, P or I to draw.';
	}
	/** "Room tool. Cursor at 0 feet, 28 feet, in Living room. Arrow keys move, Enter sets the first corner." */
	function toolSaid(t: ETool | 'place'): string {
		const name = { select: 'Select', rect: 'Room', poly: 'Polygon', item: 'New item', scale: 'Scale', place: '' }[t];
		if (t === 'select' || t === 'scale') return `${name} tool.`;
		const rest = statusText(true).split(' · ').slice(1).join('. ');
		const lead = t === 'place' ? `Placing ${placingItem?.name ?? 'item'}.` : `${name} tool.`;
		return `${lead} ${rest.charAt(0).toUpperCase()}${rest.slice(1)}`;
	}

	function canvasKey(e: KeyboardEvent) {
		if (e.target !== grid || !kbTool || e.ctrlKey || e.metaKey || e.altKey) return;
		const next = cursorStep(kc, e, { x: edges(null, 0), y: edges(null, 1) }, { w: floor.planWidth, h: floor.planHeight });
		if (next) {
			e.preventDefault();
			kbShow = true;
			kc = next;
			keepInView(next);
			const rn = roomNameAt(next);
			if (rn !== cursorRoom) {
				cursorRoom = rn;
				announce(`In ${rn}.`);
			}
			return;
		}
		if (e.key === 'Enter') {
			e.preventDefault();
			// After the pointer, the first Enter only brings the cursor back.
			if (!kbOn) kbShow = true;
			else kbEnter();
		} else if (e.key === 'Backspace' && tool === 'poly' && kbOn) {
			e.preventDefault();
			if (!polyPts.length) return;
			polyPts = polyPts.slice(0, -1);
			announce(`Last corner removed. ${polyPts.length} corner${polyPts.length === 1 ? '' : 's'}.`);
		} else if (e.key.toLowerCase() === 'c' && tool === 'poly' && kbOn) {
			e.preventDefault();
			closeKbPoly();
		}
	}
	async function kbEnter() {
		const p = kc;
		if (placing !== null) {
			const id = placing;
			const name = placingItem?.name ?? 'Item';
			const index = unplaced.findIndex((i) => i.id === id);
			placing = null;
			sel = { k: 'item', id };
			await commit(() => placeItem(id, floorId, p[0], p[1]));
			announce(`${name} placed in ${roomNameAt(p)}.`);
			// The next Place button, so a list of items goes quickly; the canvas once none are left.
			await tick();
			const buttons = layoutEl?.querySelectorAll<HTMLButtonElement>('.ub') ?? [];
			const nextBtn = buttons[Math.min(index, buttons.length - 1)];
			if (nextBtn) nextBtn.focus();
			else focusCanvas();
			return;
		}
		if (tool === 'item') {
			announce(`New ${ITEM_TYPE_LABELS[newType].one.toLowerCase()} placed in ${roomNameAt(p)}.`);
			await addItem(p);
			return;
		}
		if (tool === 'rect') {
			if (!kbCorner) {
				kbCorner = p;
				announce(`First corner set at ${spokenPos(p, upf)}.`);
				return;
			}
			const r = rectOf(kbCorner, p);
			if (r.w < MIN || r.h < MIN) {
				announce(`Too small for a room. Make it at least ${spokenSize(MIN, MIN, upf)}.`);
				return;
			}
			kbCorner = null;
			announce(`New room created, ${spokenSize(r.w, r.h, upf)}.`);
			await addRoom({ type: 'rect', ...r });
			return;
		}
		if (tool === 'poly') {
			const last = polyPts.at(-1);
			if (polyPts.length >= 3 && dist(p, polyPts[0]) < 0.5) return closeKbPoly();
			if (last && dist(p, last) < 0.5) return;
			polyPts = [...polyPts, p];
			announce(`Corner ${polyPts.length} set.`);
		}
	}
	function closeKbPoly() {
		if (polyPts.length < 3) return announce('A polygon needs 3 corners.');
		const points = polyPts;
		polyPts = [];
		const b = bboxOf({ type: 'polygon', points });
		announce(`New room created, ${spokenSize(b.w, b.h, upf)}.`);
		addRoom({ type: 'polygon', points });
	}

	// ---- Shortcuts popover: the toolbar button, the status line button and ? open it
	let helpOpen = $state(false);
	let helpOpener: HTMLElement | null = null;
	function toggleHelp(opener: Element | null) {
		if (helpOpen) return closeHelp();
		helpOpener = opener instanceof HTMLElement ? opener : null;
		helpOpen = true;
	}
	function closeHelp(restore = true) {
		helpOpen = false;
		if (restore) helpOpener?.focus();
		helpOpener = null;
	}

	// ---- Keyboard: arrows nudge a grid step (Shift = 1 unit), Esc deselects
	function nudgeOf(e: KeyboardEvent): Point | null {
		const step = e.shiftKey ? 1 : GRID;
		const d: Record<string, Point> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
		return d[e.key] ?? null;
	}
	/** Keeps focus on a room's element when a change moves it in the reading order. */
	async function refocus(el: HTMLElement) {
		await tick();
		if (el.isConnected && document.activeElement !== el) el.focus({ preventScroll: true });
	}
	async function roomKey(e: KeyboardEvent, r: Room) {
		const editing = tool === 'select' && placing === null;
		if ((e.key === 'Enter' || e.key === ' ') && editing) {
			e.preventDefault();
			sel = { k: 'room', id: r.id };
			return;
		}
		if ((e.key === 'Delete' || e.key === 'Backspace') && editing) {
			e.preventDefault();
			sel = { k: 'room', id: r.id };
			if (await removeRoom(r)) {
				announce(`${r.name} deleted.`);
				focusCanvas();
			}
			return;
		}
		const d = nudgeOf(e);
		if (!d) return;
		e.preventDefault();
		const s = shapeOf(r);
		if (!s) return;
		const el = e.currentTarget as HTMLElement;
		sel = { k: 'room', id: r.id };
		if (e.altKey) {
			// Alt+arrows resize a rectangle from its right and bottom edges, snapping like the handles.
			if (s.type !== 'rect') return;
			const { r: next } = resized(s, d[0] ? 'e' : 's', d[0], d[1], r.id, e.shiftKey);
			if (next.w === s.w && next.h === s.h) return;
			await commit(() => setRoomShape(r.id, { type: 'rect', ...next }));
		} else {
			const c = carry ? { itemIds: itemsInside(s).map((i) => i.id), dx: d[0], dy: d[1] } : undefined;
			await commit(() => setRoomShape(r.id, translate(s, d[0], d[1]), c));
		}
		refocus(el);
	}
	async function itemKey(e: KeyboardEvent, i: HouseItem) {
		if ((e.key === 'Enter' || e.key === ' ') && tool === 'select' && placing === null) {
			e.preventDefault();
			sel = { k: 'item', id: i.id };
			return;
		}
		if ((e.key === 'Delete' || e.key === 'Backspace') && tool === 'select' && placing === null) {
			e.preventDefault();
			await unplace(i);
			announce(`${i.name} taken off the map.`);
			focusCanvas();
			return;
		}
		const d = nudgeOf(e);
		if (!d) return;
		e.preventDefault();
		const p = posOf(i);
		if (!p) return;
		sel = { k: 'item', id: i.id };
		commit(() => placeItem(i.id, floorId, clampX(p[0] + d[0]), clampY(p[1] + d[1])));
	}
	function vertexKey(e: KeyboardEvent, r: Room, index: number) {
		const d = nudgeOf(e);
		if (!d || e.altKey) return;
		e.preventDefault();
		const s = shapeOf(r);
		if (!s || s.type !== 'polygon') return;
		const points = s.points.map((q) => [q[0], q[1]] as Point);
		points[index] = [clampX(points[index][0] + d[0]), clampY(points[index][1] + d[1])];
		commit(() => setRoomShape(r.id, { type: 'polygon', points }));
	}
	function measureKey(e: KeyboardEvent, end: 'a' | 'b') {
		const d = nudgeOf(e);
		if (!d) return;
		e.preventDefault();
		const q = measure[end];
		measure = { ...measure, [end]: [clampX(q[0] + d[0]), clampY(q[1] + d[1])] };
	}
	function onkeydown(e: KeyboardEvent) {
		const inField = isTextField(e.target);
		if (e.key === 'Escape' && !e.defaultPrevented) {
			if ((e.target as Element).closest?.('.insp input, .insp textarea, .insp select')) return;
			if (drag?.k === 'new') {
				drag = null;
				draft = null;
			} else if (helpOpen) closeHelp(false);
			else if (kbCorner) {
				kbCorner = null;
				announce('First corner cleared.');
			} else if (placing !== null) {
				placing = null;
				announce('Placing cancelled.');
			} else if (polyPts.length) {
				polyPts = [];
				announce('Shape cleared.');
			} else if (tool !== 'select') setTool('select');
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
		if (e.key === '?') {
			e.preventDefault();
			toggleHelp(document.activeElement);
			return;
		}
		const k = e.key.toLowerCase();
		const t: ETool | null = k === 'v' ? 'select' : k === 'r' ? 'rect' : k === 'p' ? 'poly' : k === 'i' ? 'item' : null;
		if (!t) return;
		// Pressing a drawing tool's key again keeps the shape in progress.
		if (t !== tool || placing !== null) setTool(t);
		if (t !== 'select') focusCanvas();
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
		const run = uploadPlan(floor, file, true);
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
	async function removeRoom(r: Room): Promise<boolean> {
		if (!confirm(`Delete ${r.name}? Its items stay where they are and show as “Not in a room”.`)) return false;
		sel = null;
		await commit(() => deleteRoom(r.id));
		return true;
	}
	async function unplace(i: HouseItem) {
		sel = null;
		await commit(() => unplaceItem(i.id));
	}
	function startPlace(i: HouseItem, e: MouseEvent) {
		tool = 'select';
		polyPts = [];
		kbCorner = null;
		sel = null;
		placing = placing === i.id ? null : i.id;
		if (placing === null) return announce('Placing cancelled.');
		// The cursor starts in the middle of the item's room when that room is on this floor.
		const home = shapedRooms.find((r) => r.id === i.roomId)?.shape;
		const b = home ? bboxOf(home) : null;
		startCursor(b ? [b.x + b.w / 2, b.y + b.h / 2] : undefined);
		announce(toolSaid('place'));
		// Pressed from the keyboard (no pointer position): carry on at the canvas.
		if (e.detail === 0) focusCanvas();
	}

	// ---- Number fields (§5.21): feet once a scale is set, otherwise grid steps; one undo step each
	const unitWord = $derived(upf ? 'feet' : 'grid steps');
	const unitMark = $derived(upf ? '′' : '');
	async function setRect(r: Room, patch: Partial<Rect>) {
		const s = shapeOf(r);
		if (s?.type !== 'rect') return;
		const next = { ...s, ...patch };
		next.w = Math.max(MIN, next.w);
		next.h = Math.max(MIN, next.h);
		const dx = next.x - s.x;
		const dy = next.y - s.y;
		if (!dx && !dy && next.w === s.w && next.h === s.h) return;
		const c = carry && (dx || dy) ? { itemIds: itemsInside(s).map((i) => i.id), dx, dy } : undefined;
		await commit(() => setRoomShape(r.id, next, c));
	}
	/** The corner whose row has focus in the Corners list; it's highlighted on the canvas. */
	let cornerAt = $state<number | null>(null);
	let cornersFocused = $state(false);
	$effect(() => {
		void selId('room');
		cornerAt = null;
	});
	async function setCorner(r: Room, n: number, axis: 0 | 1, v: number) {
		const s = shapeOf(r);
		if (s?.type !== 'polygon' || s.points[n][axis] === v) return;
		const points = s.points.map((q) => [q[0], q[1]] as Point);
		points[n][axis] = v;
		await commit(() => setRoomShape(r.id, { type: 'polygon', points }));
	}
	const focusCorner = async (n: number) => {
		await tick();
		document.getElementById(`cx-${n}`)?.focus();
	};
	async function addCorner(r: Room, after: number) {
		const s = shapeOf(r);
		if (s?.type !== 'polygon') return;
		const a = s.points[after];
		const b = s.points[(after + 1) % s.points.length];
		const points = s.points.map((q) => [q[0], q[1]] as Point);
		points.splice(after + 1, 0, [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2)]);
		await commit(() => setRoomShape(r.id, { type: 'polygon', points }));
		cornerAt = after + 1;
		focusCorner(after + 1);
	}
	async function removeCorner(r: Room, n: number) {
		const s = shapeOf(r);
		if (s?.type !== 'polygon' || s.points.length <= 3) return;
		await commit(() => setRoomShape(r.id, { type: 'polygon', points: s.points.filter((_, k) => k !== n) }));
		cornerAt = Math.min(n, s.points.length - 2);
		focusCorner(cornerAt);
	}
	/** An item's typed position: a live preview while typing (its room follows), saved on change. */
	async function setItemAt(i: HouseItem, axis: 0 | 1, v: number, save: boolean) {
		const p = posOf(i);
		if (!p) return;
		const next: Point = [p[0], p[1]];
		next[axis] = axis ? clampY(v) : clampX(v);
		if (!save) return void (itemDraft = { [i.id]: next });
		if (next[0] === i.x && next[1] === i.y) return void (itemDraft = {});
		await commit(() => placeItem(i.id, floorId, next[0], next[1]));
	}

	// ---- Derived view bits
	const selShape = $derived(selRoom ? shapeOf(selRoom) : null);
	const selBox = $derived(selShape ? bboxOf(selShape) : null);
	const insideCount = $derived(selShape ? itemsInside(selShape).length : 0);
	const selItemPos = $derived(selItem ? posOf(selItem) : null);
	const selItemRoom = $derived(selItemPos ? roomNameAt(selItemPos) : '');
	const selItemWas = $derived.by(() => {
		if (!selItem || !wasRoom.has(selItem.id)) return null;
		const was = wasRoom.get(selItem.id) ?? null;
		const wasName = was === null ? 'Not in a room' : (ix.roomById.get(was)?.name ?? 'Not in a room');
		return wasName !== selItemRoom ? wasName : null;
	});
	const banner = $derived(
		placing !== null
			? 'Click where it really is. Esc cancels.'
			: tool === 'rect'
				? `Drag on the grid to draw ${rooms.length ? 'a' : 'your first'} room. Edges snap to other rooms.`
				: tool === 'poly'
					? 'Click to add corners. Click the first corner to close the shape.'
					: tool === 'item'
						? 'Click where the new item really is.'
						: ''
	);
	const placingItem = $derived(placing !== null ? (floorItems.find((i) => i.id === placing) ?? null) : null);
	const whereUnplaced = (i: HouseItem) => {
		const bs = ix.breakersOf(i);
		return `${ix.roomName(i.roomId)}${bs.length ? ` · on ${slotsText(ix, bs)}` : ''}`;
	};
	const cursor = $derived(placing !== null || tool === 'rect' || tool === 'poly' || tool === 'item' ? 'crosshair' : 'default');
	const status = $derived(statusText(false));
	const hints = $derived<[string, string][]>(
		tool === 'rect'
			? [
					['Enter', kbCorner ? 'finish' : 'corner'],
					['Esc', 'cancel']
				]
			: tool === 'poly'
				? [
						['Enter', 'corner'],
						['C', 'close'],
						['Esc', 'cancel']
					]
				: kbTool
					? [
							['Enter', 'drop'],
							['Esc', 'cancel']
						]
					: tool === 'select' && selShape?.type === 'rect'
						? [['Alt+arrows', 'resize']]
						: []
	);
	// While the cursor shows, the status line says what the banner would; the Item banner stays for its types.
	const showBanner = $derived(!!banner && !(kbOn && tool !== 'item'));
	const canvasLabel = $derived(
		`${floor.name} layout. ${kbTool ? 'Arrow keys move the drawing cursor, Enter acts.' : 'Press R, P or I to draw with the keyboard, or Tab to rooms and items.'}`
	);
	const pts = (s: Point[]) => s.map((p) => `${sx(p[0])},${sy(p[1])}`).join(' ');
	const itemAria = (i: HouseItem) => `${i.name}, ${ix.typeLabel(i)}, in ${roomNameAt(posOf(i)!)}. Drag to move.`;
	const roomAria = (r: Room, s: Shape) => `${r.name}${upf ? `, ${sizeText(s, upf).replace(' × ', ' by ')}` : ''}. Drag to move; arrow keys nudge.`;
</script>

<svelte:window {onkeydown} />

<!-- The toolbar comes first in the DOM so focus goes toolbar → left panel → canvas → inspector (§5.21);
     the grid puts it above the canvas. -->
<div class="ed">
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
		<button type="button" class="sb" class:is-on={tool === 'item'} aria-pressed={tool === 'item'} title="New item (I)" onclick={() => setTool('item')}
			>Item</button
		>
		<button type="button" class="sb" class:is-on={tool === 'scale'} aria-pressed={tool === 'scale'} title="Set scale" onclick={() => setTool('scale')}
			>Scale</button
		>
	</div>
	<button type="button" class="sb planbtn" class:is-on={planSel} aria-pressed={planSel} onclick={togglePlan}>Floor plan</button>
	<button
		type="button"
		class="ibtn tbtn push"
		aria-label="Keyboard shortcuts"
		title="Keyboard shortcuts (?)"
		aria-expanded={helpOpen}
		aria-controls="khelp"
		onclick={(e) => toggleHelp(e.currentTarget)}><Icon name="keyboard" size={18} /></button
	>
	<button type="button" class="ibtn tbtn" aria-label="Undo" title="Undo" disabled={!history.length} onclick={undo}><Icon name="undo" size={16} /></button>
	<button type="button" class="btn btn-pri done" onclick={ondone}>Done editing</button>
</div>

<aside aria-label="Layout" class="layout" bind:this={layoutEl}>
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
				<button type="button" class="btn ub" class:btn-pri={placing === i.id} aria-pressed={placing === i.id} onclick={(e) => startPlace(i, e)}
					>{placing === i.id ? 'Placing…' : 'Place'}<span class="sr"> {i.name}</span></button
				>
			</div>
		{:else}
			<span class="lp">Everything on this floor is placed.</span>
		{/each}
	</div>
</aside>

<section aria-label="Floor layout editor" class="edcol">
	{#if showBanner}
		<!-- Before the canvas, so Shift+Tab from the canvas reaches the item types and Cancel. -->
		<div class="banner ovl" role="status">
			<span>{banner}</span>
			{#if tool === 'item' && placing === null}
				<div class="seg types" role="group" aria-label="Item type">
					{#each ITEM_TYPES as t (t)}
						<button type="button" class="sb" class:is-on={newType === t} aria-pressed={newType === t} onclick={() => (newType = t)}
							><Icon name={t} size={14} />{ITEM_TYPE_LABELS[t].one}</button
						>
					{/each}
				</div>
			{/if}
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

	<!-- The canvas: one tab stop that holds the drawing cursor (§5.21), with the rooms, items and
	     handles inside it as their own buttons. Pointer handling for drawing and dragging lives here
	     too; every pointer action also has a keyboard path. -->
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
	<div
		class="grid"
		class:drawing={tool === 'rect' || tool === 'poly' || tool === 'item'}
		bind:this={grid}
		bind:clientWidth={cw}
		bind:clientHeight={ch}
		tabindex="0"
		role="group"
		aria-label={canvasLabel}
		aria-describedby="kstatus"
		style:cursor
		style:background-size="{20 * z}px {20 * z}px"
		style:background-position="{px}px {py}px"
		onfocus={canvasFocus}
		onblur={(e) => e.target === grid && (canvasFocused = false)}
		onkeydown={canvasKey}
		onpointerdowncapture={ongridDownCapture}
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
		ondragstart={(e) => e.preventDefault()}
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

		{#each orderedRooms as r (r.id)}
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
					><span class="rn">{r.name}</span></button
				>
			{:else if s?.type === 'polygon'}
				{@const b = bboxOf(s)}
				<svg class="polys" width={cw} height={ch}>
					<a
						class="poly"
						data-room={r.id}
						class:is-sel={selRoom?.id === r.id}
						class:is-ext={r.kind === 'exterior'}
						href="{resolve('/map')}?edit=1&floor={floorId}&room={r.id}"
						aria-label={roomAria(r, s)}
						aria-current={selRoom?.id === r.id ? 'true' : undefined}
						onpointerdown={(e) => roomDown(e, r)}
						onkeydown={(e) => roomKey(e, r)}
						onclick={(e) => e.preventDefault()}
					>
						<polygon points={pts(s.points)} />
						<text x={sx(b.x) + 10} y={sy(b.y) + 19}>{r.name}</text>
					</a>
				</svg>
			{/if}
		{/each}
		<svg class="polys drafts" width={cw} height={ch}>
			{#if drag?.k === 'new' && draft}
				<rect class="draft" x={sx(draft.x)} y={sy(draft.y)} width={draft.w * z} height={draft.h * z} />
			{/if}
			{#if kbOn && tool === 'rect' && kbCorner}
				{@const d = rectOf(kbCorner, kc)}
				<rect class="draft" x={sx(d.x)} y={sy(d.y)} width={d.w * z} height={d.h * z} />
			{/if}
			{#if polyPts.length}
				{@const end = kbOn ? kc : hover}
				{@const all = end ? [...polyPts, end] : polyPts}
				<polyline class="draft" points={pts(all)} />
				{#each polyPts as p, n (n)}
					{#if kbOn}
						<!-- The keyboard's corners: the first is a hollow ring, the others solid dots. -->
						<circle cx={sx(p[0])} cy={sy(p[1])} r={n === 0 ? 5.75 : 5} class={n === 0 ? 'kfirst' : 'pfirst'} />
					{:else}
						<circle cx={sx(p[0])} cy={sy(p[1])} r={n === 0 ? 6 : 5} class={n === 0 ? 'pfirst' : 'pcorner'} />
					{/if}
				{/each}
			{/if}
			{#if tool === 'scale'}
				<line class="mline" x1={sx(measure.a[0])} y1={sy(measure.a[1])} x2={sx(measure.b[0])} y2={sy(measure.b[1])} />
			{/if}
		</svg>

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
				>
					<Icon name={i.type} size={16} />
				</button>
			{/if}
		{/each}

		<!-- Handles after the items: a rectangle resizes from the keyboard with Alt+arrows on the room,
		     so only a polygon's corners are tab stops. -->
		{#if selRoom && selShape && tool === 'select'}
			{#if selShape.type === 'rect'}
				{#each HANDLES as [h, fx, fy, cur] (h)}
					<button
						type="button"
						class="hd"
						tabindex="-1"
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
						class:is-hi={cornersFocused && cornerAt === n}
						style:left="{sx(p[0])}px"
						style:top="{sy(p[1])}px"
						style:cursor="move"
						aria-label="Corner {n + 1} of {selRoom.name}. Drag, or use the arrow keys."
						onpointerdown={(e) => vertexDown(e, selRoom, n)}
						onkeydown={(e) => vertexKey(e, selRoom, n)}
					></button>
				{/each}
			{/if}
			{#if upf && selBox}
				<span class="dim w" style:left="{sx(selBox.x + selBox.w / 2)}px" style:top="{sy(selBox.y) - 26}px">{feet(selBox.w, upf)}</span>
				<span class="dim" style:left="{sx(selBox.x + selBox.w) + 12}px" style:top="{sy(selBox.y + selBox.h / 2) - 10}px">{feet(selBox.h, upf)}</span>
			{/if}
		{/if}

		{#if guide.v !== undefined}<div class="guide v" style:left="{sx(guide.v)}px"></div>{/if}
		{#if guide.h !== undefined}<div class="guide h" style:top="{sy(guide.h)}px"></div>{/if}
		{#if tip}
			<span class="tip" style:left="{sx(tip.x) + (drag?.k === 'item' ? 22 : 14)}px" style:top="{sy(tip.y) + (drag?.k === 'item' ? -30 : 14)}px">{tip.t}</span>
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

		{#if (placingItem || tool === 'item') && hover && !kbOn}
			<div class="ghost" style:left="{sx(hover[0]) - 16}px" style:top="{sy(hover[1]) - 16}px"><Icon name={placingItem?.type ?? newType} size={16} /></div>
		{/if}

		{#if kbOn}
			<!-- The drawing cursor: crosshair lines, an amber ring, and a chip with where it is. -->
			<div class="kx h" style:top="{sy(kc[1])}px"></div>
			<div class="kx v" style:left="{sx(kc[0])}px"></div>
			{#if tool === 'rect' && kbCorner}
				{@const d = rectOf(kbCorner, kc)}
				<span class="kdot" style:left="{sx(kbCorner[0])}px" style:top="{sy(kbCorner[1])}px"></span>
				<span class="dim w kdim" style:left="{sx(d.x + d.w / 2)}px" style:top="{sy(d.y) - 24}px">{sizeOf(d.w, d.h, upf)}</span>
			{/if}
			<span class="kring" style:left="{sx(kc[0])}px" style:top="{sy(kc[1])}px"></span>
			<span class="klab" style:left="{sx(kc[0]) + 16}px" style:top="{sy(kc[1]) + 12}px">{posText(kc, upf)} · {roomNameAt(kc)}</span>
		{/if}
	</div>

	<div class="kbar ovl">
		<p class="kt" id="kstatus">{status}</p>
		{#each hints as [k, t] (k)}<span class="khint"><span class="kk">{k}</span>{t}</span>{/each}
		<button type="button" class="btn kbtn" aria-expanded={helpOpen} aria-controls="khelp" onclick={(e) => toggleHelp(e.currentTarget)}
			><span class="kk">?</span>Shortcuts</button
		>
	</div>
	<div class="sr" aria-live="polite">{said}</div>
	{#if helpOpen}<Shortcuts id="khelp" onclose={() => closeHelp()} />{/if}
	<div class="zoom ovl">
		<button type="button" class="zb" aria-label="Zoom out" onclick={() => zoomAt(1 / 1.25)}>−</button>
		<span class="mono zt" aria-live="polite">{Math.round(z * 100)}%</span>
		<button type="button" class="zb" aria-label="Zoom in" onclick={() => zoomAt(1.25)}>+</button>
		<button type="button" class="zb fit" aria-label="Fit floor to screen" onclick={fit}><Icon name="fit" size={16} /></button>
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
				{#if selShape.type === 'rect'}
					{@const get = (k: 'x' | 'y' | 'w' | 'h') => () => (selShape.type === 'rect' ? selShape[k] : 0)}
					{@const set = (k: 'x' | 'y' | 'w' | 'h') => (v: number, save: boolean) => save && setRect(r, { [k]: v })}
					<div class="fld">
						<span class="k" id="pos-l">Position <span class="kn">(from the top-left corner of the floor)</span></span>
						<div class="numf" role="group" aria-labelledby="pos-l">
							{@render num('rx', `Left edge, ${unitWord}`, `x${unitMark}`, get('x'), set('x'))}
							{@render num('ry', `Top edge, ${unitWord}`, `y${unitMark}`, get('y'), set('y'))}
						</div>
					</div>
					<div class="fld">
						<span class="k" id="size-l">Size</span>
						<div class="numf" role="group" aria-labelledby="size-l">
							{@render num('rw', `Width, ${unitWord}`, `w${unitMark}`, get('w'), set('w'), MIN)}
							{@render num('rh', `Depth, ${unitWord}`, `d${unitMark}`, get('h'), set('h'), MIN)}
						</div>
						<span class="fh">{upf ? 'Rectangle · steps of 6″. Without a scale these count grid steps.' : 'Set a scale to use feet'}</span>
					</div>
				{:else}
					{@const pts = selShape.points}
					{@const after = cornerAt ?? pts.length - 1}
					<div
						class="fld"
						onfocusin={() => (cornersFocused = true)}
						onfocusout={(e) => {
							if (!e.currentTarget.contains(e.relatedTarget as Node | null)) cornersFocused = false;
						}}
					>
						<span class="k" id="cn-l">Corners</span>
						<div class="clist" role="group" aria-labelledby="cn-l">
							<div class="crow chead" aria-hidden="true"><span>#</span><span>x{unitMark}</span><span>y{unitMark}</span><span></span></div>
							{#each pts as p, n (n)}
								<div class="crow" class:is-on={cornerAt === n} onfocusin={() => (cornerAt = n)}>
									<span class="mono cn" class:dimn={cornerAt !== n}>{n + 1}</span>
									{#each [0, 1] as const as axis (axis)}
										<input
											id="c{axis ? 'y' : 'x'}-{n}"
											class="inp ci"
											type="number"
											step={upf ? 0.5 : 1}
											aria-label="Corner {n + 1} {axis ? 'down' : 'across'}, {unitWord}"
											value={toField(p[axis], upf)}
											onchange={async (e) => {
												const input = e.currentTarget;
												const v = input.valueAsNumber;
												if (Number.isFinite(v)) await setCorner(r, n, axis, fromField(v, upf));
												const now = shapeOf(r);
												if (now?.type === 'polygon' && now.points[n]) input.value = String(toField(now.points[n][axis], upf));
											}}
										/>
									{/each}
									<button
										type="button"
										class="ibtn cx"
										aria-label="Remove corner {n + 1}"
										disabled={pts.length <= 3}
										onclick={() => removeCorner(r, n)}>×</button
									>
								</div>
							{/each}
						</div>
						<button type="button" class="btn start" onclick={() => addCorner(r, after)}>+ Add a corner after {after + 1}</button>
						{#if !upf}<span class="fh">Set a scale to use feet</span>{/if}
					</div>
				{/if}
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
				<div class="fld">
					<label for="it-name">Name</label>
					<input id="it-name" class="inp" type="text" value={i.name} bind:this={itemName} onchange={(e) => renameItem(i, e)} />
				</div>
				<div class="roombox">
					<span class="k">Room (from where it sits)</span>
					<span class="rb">{selItemRoom}</span>
					{#if selItemWas}<span class="was">Was {selItemWas}</span>{/if}
				</div>
				{#if selItemPos}
					{@const get = (axis: 0 | 1) => () => (axis ? i.y : i.x) ?? 0}
					{@const set = (axis: 0 | 1) => (v: number, save: boolean) => setItemAt(i, axis, v, save)}
					<div class="fld">
						<span class="k" id="ipos-l">Position</span>
						<div class="numf" role="group" aria-labelledby="ipos-l">
							{@render num('ix', `Across, ${unitWord}`, `x${unitMark}`, get(0), set(0))}
							{@render num('iy', `Down, ${unitWord}`, `y${unitMark}`, get(1), set(1))}
						</div>
						{#if !upf}<span class="fh">Set a scale to use feet</span>{/if}
					</div>
				{/if}
				{#if i.breakerIds.length}
					<div class="fld"><span class="k">{i.breakerIds.length > 1 ? 'Breakers' : 'Breaker'}</span><span class="mono ro">{slotsText(ix, ix.breakersOf(i))}</span></div>
				{:else}
					<div class="fld">
						<label for="it-brk">Pick its breaker</label>
						<select id="it-brk" class="inp" value="" onchange={(e) => pickBreaker(i, e)}>
							<option value="">— No breaker —</option>
							{#each ix.house.breakers as o (o.id)}<option value={String(o.id)}>{ix.slotOf(o)} — {ix.labelOf(o)} ({o.amps}A)</option>{/each}
						</select>
					</div>
				{/if}
				<span class="hint">Drag it, use the arrow keys, or type a position. Its room updates from the position; breakers don’t change.</span>
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
</div>

{#snippet num(id: string, label: string, mark: string, get: () => number, apply: (units: number, save: boolean) => unknown, min?: number)}
	<div class="unit">
		<label class="sr" for={id}>{label}</label>
		<input
			{id}
			class="inp"
			type="number"
			step={upf ? 0.5 : 1}
			min={min !== undefined ? toField(min, upf) : undefined}
			value={toField(get(), upf)}
			oninput={(e) => {
				const v = e.currentTarget.valueAsNumber;
				if (Number.isFinite(v)) apply(fromField(v, upf), false);
			}}
			onchange={async (e) => {
				const input = e.currentTarget;
				const v = input.valueAsNumber;
				if (Number.isFinite(v)) await apply(fromField(v, upf), true);
				// Show what was kept: a size under the minimum, or a value that wasn't a number.
				input.value = String(toField(get(), upf));
			}}
		/>
		<span class="um" aria-hidden="true">{mark}</span>
	</div>
{/snippet}

<style>
	/* The editor: left panel, toolbar over the canvas, inspector */
	.ed {
		flex: 1 1 0;
		min-width: 0;
		min-height: 0;
		display: grid;
		grid-template-columns: 300px minmax(0, 1fr) 320px;
		grid-template-rows: 60px minmax(0, 1fr);
	}

	/* Left: rooms and unplaced items */
	.layout {
		grid-column: 1;
		grid-row: 1 / 3;
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
		grid-column: 2;
		grid-row: 2;
		min-width: 0;
		min-height: 0;
		position: relative;
		display: flex;
		flex-direction: column;
	}
	.bar {
		grid-column: 2;
		grid-row: 1;
		min-width: 0;
		height: 60px;
		padding: 0 12px;
		display: flex;
		align-items: center;
		/* 8px, not 10: the toolbar gained the shortcuts button and has to fit 820px at 1440 wide. */
		gap: 8px;
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
	.tbtn {
		width: 38px;
		height: 38px;
	}
	.push {
		margin-left: auto;
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
	.grid:focus {
		outline: none;
	}
	.grid:focus-visible {
		outline: 3px solid var(--focus);
		outline-offset: -3px;
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
	.grid.drawing :is(.room, .poly, .it) {
		cursor: crosshair;
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
	.hd:hover,
	.hd.is-hi {
		background: var(--amber);
	}
	.hd.is-hi {
		box-shadow: 0 0 0 3px var(--amber-soft);
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
		box-shadow: var(--shadow-drag);
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
		box-shadow: var(--shadow-banner);
		z-index: 8;
		white-space: nowrap;
		font-size: 14px;
		cursor: default;
	}
	.bb {
		height: 34px;
	}
	/* The drawing cursor (§5.21) */
	.kx {
		position: absolute;
		pointer-events: none;
		z-index: 9;
		opacity: 0.7;
	}
	.kx.h {
		left: 0;
		right: 0;
		height: 0;
		border-top: 1px dashed var(--amber);
	}
	.kx.v {
		top: 0;
		bottom: 0;
		width: 0;
		border-left: 1px dashed var(--amber);
	}
	.kring {
		position: absolute;
		width: 22px;
		height: 22px;
		margin: -11px 0 0 -11px;
		border: 2.5px solid var(--amber);
		border-radius: 50%;
		background: color-mix(in srgb, var(--amber) 18%, transparent);
		pointer-events: none;
		z-index: 10;
	}
	.kdot {
		position: absolute;
		width: 10px;
		height: 10px;
		margin: -5px 0 0 -5px;
		border-radius: 50%;
		background: var(--amber);
		pointer-events: none;
		z-index: 10;
	}
	.kfirst {
		fill: var(--surface);
		stroke: var(--amber);
		stroke-width: 2.5;
	}
	.klab {
		position: absolute;
		z-index: 10;
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 600;
		background: var(--amber);
		color: var(--on-amber);
		padding: 3px 7px;
		border-radius: var(--r-sm);
		white-space: nowrap;
		pointer-events: none;
	}
	.dim.kdim {
		z-index: 10;
	}
	.drafts {
		z-index: 8;
	}

	/* The status line replaces the old hint row */
	.kbar {
		position: absolute;
		left: 12px;
		right: 12px;
		bottom: 10px;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px 8px 8px 14px;
		border: 1px solid var(--line-2);
		border-radius: var(--r-xl);
		background: var(--surface);
		box-shadow: var(--shadow-pop);
		z-index: 11;
		cursor: default;
	}
	.kt {
		flex-grow: 1;
		font-size: 13px;
		line-height: 1.4;
		min-width: 0;
	}
	.khint {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--muted);
		white-space: nowrap;
	}
	.kbtn {
		height: 34px;
		padding: 0 10px;
		font-size: 13px;
	}
	.zoom {
		position: absolute;
		right: 16px;
		bottom: 72px;
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
		grid-column: 3;
		grid-row: 1 / 3;
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

	/* Number fields (§5.21) */
	.kn {
		font-weight: 500;
	}
	.numf {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
	}
	.unit {
		position: relative;
	}
	.unit .inp {
		padding-right: 28px;
		font-family: var(--font-mono);
		font-size: 13px;
	}
	.um {
		position: absolute;
		right: 10px;
		top: 50%;
		transform: translateY(-50%);
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--muted);
		pointer-events: none;
	}
	.fh {
		font-size: 12px;
		color: var(--muted);
	}
	.clist {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.crow {
		display: grid;
		grid-template-columns: 24px minmax(0, 1fr) minmax(0, 1fr) 36px;
		gap: 8px;
		align-items: center;
		padding: 2px 4px;
		border-radius: var(--r-md);
	}
	.crow.is-on {
		background: var(--amber-soft);
	}
	.chead {
		min-height: 24px;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.cn {
		font-size: 13px;
	}
	.cn.dimn {
		color: var(--muted);
	}
	.ci {
		height: 36px;
		font-family: var(--font-mono);
		font-size: 13px;
	}
	.cx {
		width: 36px;
		height: 36px;
		font-size: 16px;
	}
</style>
