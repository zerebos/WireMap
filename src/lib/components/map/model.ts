// Shared logic for the Map screen (docs/design/DESIGN.md §5.2).
import type { Breaker, Room } from '$lib/db/schema';
import type { HouseIndex, HouseItem } from '$lib/house';
import { plural } from '$lib/house';
import { PROTECTION_LABELS } from '$lib/constants';
import { parseOutline, type Point } from '$lib/geometry';

/** One selection at a time; priority item > circuit > room. */
export type Sel = { kind: 'none' } | { kind: 'circuit' | 'item' | 'room'; id: number };
export const NONE: Sel = { kind: 'none' };

export type Tool = 'select' | 'room' | 'place';

/** "20A · GFCI", or "50A · 2-pole". */
export const specOf = (b: Breaker) => `${b.amps}A · ${b.poles === 2 ? '2-pole' : PROTECTION_LABELS[b.kind]}`;

/** A room's outline, or null when it isn't drawn. */
export const outlineOf = (r: Room): Point[] | null => parseOutline(r.outline);

/** The rectangle an outline describes, when it's an axis-aligned rectangle. */
export function rectOf(pts: Point[]): { x: number; y: number; w: number; h: number } | null {
	if (pts.length !== 4) return null;
	const xs = [...new Set(pts.map((p) => p[0]))];
	const ys = [...new Set(pts.map((p) => p[1]))];
	if (xs.length !== 2 || ys.length !== 2) return null;
	// Each corner must pair the two xs with the two ys, going around the edge.
	for (let i = 0; i < 4; i++) {
		const a = pts[i];
		const b = pts[(i + 1) % 4];
		if (a[0] !== b[0] && a[1] !== b[1]) return null;
	}
	const x = Math.min(...xs);
	const y = Math.min(...ys);
	return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export const rectOutline = (x: number, y: number, w: number, h: number): Point[] => [
	[x, y],
	[x + w, y],
	[x + w, y + h],
	[x, y + h]
];

/** "16", or "14 + 21" for an item on several breakers, or "?" for none. */
export function slotsText(ix: HouseIndex, bs: Breaker[], sep = ' + ') {
	return bs.length ? bs.map((b) => ix.slotOf(b)).join(sep) : '?';
}

/** Breakers the current selection lights: a circuit, or every breaker feeding the item. */
export function litBreakers(ix: HouseIndex, sel: Sel): Breaker[] {
	if (sel.kind === 'circuit') {
		const b = ix.breakerById.get(sel.id);
		return b ? [b] : [];
	}
	if (sel.kind === 'item') {
		const it = ix.house.items.find((i) => i.id === sel.id);
		return it ? ix.breakersOf(it) : [];
	}
	return [];
}

/** Items on any of these breakers, each once. */
export function itemsOn(ix: HouseIndex, breakerIds: Iterable<number>): HouseItem[] {
	const seen = new Map<number, HouseItem>();
	for (const b of breakerIds) for (const i of ix.itemsOf(b)) seen.set(i.id, i);
	return [...seen.values()].sort((a, b) => a.id - b.id);
}

export type Group = {
	key: string;
	breaker: Breaker | null;
	items: HouseItem[];
	/** "Also feeds 6 items in Primary bath (Upstairs), Hall bath (Upstairs) and 1 more", or ''. */
	elseText: string;
};

/**
 * A room's circuits, in slot order, with "No breaker" last. An item on several breakers is
 * listed under each (DESIGN.md §8.2).
 */
export function roomGroups(ix: HouseIndex, room: Room): Group[] {
	const inRoom = ix.itemsInRoom(room.id);
	const byB = new Map<number, HouseItem[]>();
	const none: HouseItem[] = [];
	for (const i of inRoom) {
		if (!i.breakerIds.length) none.push(i);
		for (const b of i.breakerIds) if (ix.breakerById.has(b)) byB.set(b, [...(byB.get(b) ?? []), i]);
	}
	const breakers = [...byB.keys()]
		.map((id) => ix.breakerById.get(id)!)
		.sort((a, b) => a.panelId - b.panelId || a.slot - b.slot);
	const groups: Group[] = breakers.map((b) => {
		const out = ix.itemsOf(b.id).filter((i) => i.roomId !== room.id);
		const names: string[] = [];
		for (const i of out) {
			const n = i.floorId === room.floorId ? ix.roomName(i.roomId) : `${ix.roomName(i.roomId)} (${ix.floorName(i.floorId)})`;
			if (!names.includes(n)) names.push(n);
		}
		const elseText = out.length
			? `Also feeds ${plural(out.length, 'item')} in ${names.slice(0, 2).join(', ')}${names.length > 2 ? ` and ${names.length - 2} more` : ''}`
			: '';
		return { key: `b${b.id}`, breaker: b, items: byB.get(b.id)!, elseText };
	});
	if (none.length) groups.push({ key: 'none', breaker: null, items: none, elseText: '' });
	return groups;
}

/** Distinct breakers feeding a room's items. */
export const roomBreakerCount = (groups: Group[]) => groups.filter((g) => g.breaker).length;

/** The floor where most of a breaker's items are (lowest floor on a tie). */
export function floorOfCircuit(ix: HouseIndex, breakerId: number): number | null {
	let best: number | null = null;
	let bestN = 0;
	for (const f of ix.house.floors) {
		const n = ix.itemsOf(breakerId).filter((i) => i.floorId === f.id).length;
		if (n > bestN) {
			best = f.id;
			bestN = n;
		}
	}
	return best;
}

/** The floor to show when nothing says otherwise: the one with the most items. */
export function defaultFloor(ix: HouseIndex): number | null {
	let best = ix.house.floors[0]?.id ?? null;
	let bestN = -1;
	for (const f of ix.house.floors) {
		const n = ix.house.items.filter((i) => i.floorId === f.id).length;
		if (n > bestN) {
			best = f.id;
			bestN = n;
		}
	}
	return best;
}
