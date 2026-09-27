// The whole house, loaded at once. Even a big house is ~100 KB of rows (floor plan images are
// loaded separately), so every page reads from this one snapshot and derives what it needs.
// After changing data, call `refresh()` (or use `mutate`) to reload it.
import { asc } from 'drizzle-orm';
import { invalidate } from '$app/navigation';
import { db } from './db';
import * as t from './db/schema';
import type { Breaker, Floor, Item, Panel, Room, Settings } from './db/schema';
import { slotLabel, compareBreakers, type Space } from './panel';
import { ITEM_TYPE_LABELS, PROTECTION_TAGS } from './constants';

export type HouseItem = Item & { breakerIds: number[] };
/** A breaker with the spaces it takes (breaker_spaces, DATA-MODEL.md "Occupancy"). */
export type HouseBreaker = Breaker & { spaces: Space[] };

export type House = {
	settings: Settings;
	/** The main panel (not fed by another breaker). Null only before first-run setup. */
	panel: Panel | null;
	panels: Panel[];
	/** All breakers, by panel then slot. */
	breakers: HouseBreaker[];
	/** Bottom floor first. */
	floors: Floor[];
	rooms: Room[];
	items: HouseItem[];
};

export const HOUSE = 'app:house';

export async function loadHouse(): Promise<House> {
	const [settingsRows, panels, breakers, floors, rooms, items, links, spaces] = await Promise.all([
		db.select().from(t.settings).limit(1).all(),
		db.select().from(t.panels).orderBy(asc(t.panels.id)).all(),
		db.select().from(t.breakers).orderBy(asc(t.breakers.panelId), asc(t.breakers.slot), asc(t.breakers.half)).all(),
		db.select().from(t.floors).orderBy(asc(t.floors.level), asc(t.floors.id)).all(),
		db.select().from(t.rooms).orderBy(asc(t.rooms.name)).all(),
		db.select().from(t.items).orderBy(asc(t.items.id)).all(),
		db.select().from(t.itemBreakers).all(),
		db.select().from(t.breakerSpaces).all()
	]);
	const spacesOf = new Map<number, Space[]>();
	for (const s of spaces) spacesOf.set(s.breakerId, [...(spacesOf.get(s.breakerId) ?? []), { slot: s.slot, half: s.half }]);
	const byItem = new Map<number, number[]>();
	for (const l of links) byItem.set(l.itemId, [...(byItem.get(l.itemId) ?? []), l.breakerId]);
	return {
		settings: settingsRows[0] ?? {
			id: 1,
			homeName: 'Home',
			startPage: 'panel',
			theme: 'system',
			showLegs: true,
			mapFadeOthers: true,
			guestReadOnly: false
		},
		panel: panels.find((p) => p.fedByBreakerId === null) ?? panels[0] ?? null,
		panels,
		breakers: breakers.map((b) => ({ ...b, spaces: spacesOf.get(b.id) ?? [] })),
		floors,
		rooms,
		items: items.map((i) => ({ ...i, breakerIds: byItem.get(i.id) ?? [] }))
	};
}

/** Reloads the house after a change. */
export const refresh = () => invalidate(HOUSE);

/** Runs a change, then reloads the house. */
export async function mutate<T>(change: () => Promise<T>): Promise<T> {
	const out = await change();
	await refresh();
	return out;
}

/** Lookups over a House. Build once per house with `$derived(index(house))`. */
export function index(house: House) {
	const breakerById = new Map(house.breakers.map((b) => [b.id, b]));
	const floorById = new Map(house.floors.map((f) => [f.id, f]));
	const roomById = new Map(house.rooms.map((r) => [r.id, r]));
	const panelById = new Map(house.panels.map((p) => [p.id, p]));
	const itemsByBreaker = new Map<number, HouseItem[]>();
	for (const i of house.items) {
		for (const b of i.breakerIds) itemsByBreaker.set(b, [...(itemsByBreaker.get(b) ?? []), i]);
	}
	const panelOf = (b: Breaker) => panelById.get(b.panelId)!;
	/** The subpanel a feeder breaker feeds, if it's a feeder. */
	const fedPanelOf = (b: Breaker) => house.panels.find((p) => p.fedByBreakerId === b.id) ?? null;
	/** The breaker feeding a subpanel; null for the main panel. */
	const feederOf = (p: Panel) => (p.fedByBreakerId === null ? null : (breakerById.get(p.fedByBreakerId) ?? null));
	/** The feeders between the main panel and a panel, top down (DATA-MODEL.md "Power path"). */
	const feedersAbove = (p: Panel): Breaker[] => {
		const out: Breaker[] = [];
		const seen = new Set<number>();
		for (let f = feederOf(p); f && !seen.has(f.id); f = feederOf(panelOf(f))) {
			seen.add(f.id);
			out.unshift(f);
		}
		return out;
	};
	/** Everything a feeder cuts: the panels it feeds (recursively), their breakers and items. */
	const downstream = (feeder: Breaker) => {
		const panels: Panel[] = [];
		const breakers: Breaker[] = [];
		const queue = [feeder];
		while (queue.length) {
			const sub = fedPanelOf(queue.shift()!);
			if (!sub || panels.includes(sub)) continue;
			panels.push(sub);
			const inside = house.breakers.filter((b) => b.panelId === sub.id);
			breakers.push(...inside);
			queue.push(...inside);
		}
		const ids = new Set(breakers.map((b) => b.id));
		const items = house.items.filter((i) => i.breakerIds.some((id) => ids.has(id)));
		return { panels, breakers, items };
	};
	/** Panels as a tree: the main panel, then each subpanel under the breaker's panel that feeds it. */
	const panelTree = () => {
		const out: { panel: Panel; depth: number }[] = [];
		const walk = (p: Panel, depth: number) => {
			if (out.some((o) => o.panel.id === p.id)) return;
			out.push({ panel: p, depth });
			const ids = new Set(house.breakers.filter((b) => b.panelId === p.id).map((b) => b.id));
			for (const sub of house.panels) if (sub.fedByBreakerId !== null && ids.has(sub.fedByBreakerId)) walk(sub, depth + 1);
		};
		for (const p of house.panels) if (p.fedByBreakerId === null) walk(p, 0);
		for (const p of house.panels) walk(p, 0);
		return out;
	};
	const floorName = (id: number | null) => (id === null ? '' : (floorById.get(id)?.name ?? ''));
	const roomName = (id: number | null) => (id === null ? 'Not in a room' : (roomById.get(id)?.name ?? 'Not in a room'));

	return {
		house,
		breakerById,
		floorById,
		roomById,
		panelById,
		/** Items fed by a breaker. */
		itemsOf: (breakerId: number) => itemsByBreaker.get(breakerId) ?? [],
		/** Breakers feeding an item, in slot order. */
		breakersOf: (item: HouseItem) =>
			item.breakerIds
				.map((id) => breakerById.get(id))
				.filter((b): b is HouseBreaker => !!b)
				.sort(compareBreakers),
		panelOf,
		fedPanelOf,
		feederOf,
		feedersAbove,
		downstream,
		panelTree,
		/** An item's breakers other than `breakerId`, as a tag: "+21", "+14 + 21", or ''. */
		plusOf: (item: HouseItem, breakerId: number) => {
			const others = item.breakerIds
				.filter((id) => id !== breakerId)
				.map((id) => breakerById.get(id))
				.filter((b): b is HouseBreaker => !!b)
				.sort(compareBreakers);
			return others.length ? `+${others.map((b) => slotLabel(b, panelOf(b))).join(' + ')}` : '';
		},
		/** "16" or "1/3". */
		slotOf: (b: Breaker) => slotLabel(b, panelOf(b)),
		/** "Bathrooms", or "Unlabeled". */
		labelOf: (b: Breaker) => b.label || 'Unlabeled',
		tagOf: (b: Breaker) => PROTECTION_TAGS[b.kind],
		floorName,
		roomName,
		/** "Half bath · Main floor". */
		whereOf: (i: HouseItem) => [roomName(i.roomId), floorName(i.floorId)].filter(Boolean).join(' · '),
		typeLabel: (i: HouseItem) => ITEM_TYPE_LABELS[i.type].one,
		/** No breaker, or not placed on the map. */
		needsAttention: (i: HouseItem) => i.breakerIds.length === 0 || i.x === null || i.y === null,
		itemsInRoom: (roomId: number) => house.items.filter((i) => i.roomId === roomId)
	};
}

export type HouseIndex = ReturnType<typeof index>;

/** "1 item", "9 items". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** An empty database goes to first-run setup, except Setup itself and Settings (so Restore works). */
export const needsSetup = (house: House, routeId: string | null) =>
	house.panel === null && routeId !== '/setup' && routeId !== '/settings';
