// Every change the UI makes to the data, in one place. Pages call these through `mutate` from
// $lib/house so the house reloads afterwards.
import { and, eq, inArray, max } from 'drizzle-orm';
import { db } from './index';
import * as t from './schema';
import type { Breaker, Floor, Item, Panel, Room, Settings } from './schema';
import { savePlan, deletePlan } from '../plans';

// ---- Settings and panels

export async function updateSettings(patch: Partial<Omit<Settings, 'id'>>) {
	await db.update(t.settings).set(patch).where(eq(t.settings.id, 1));
}

export async function updatePanel(id: number, patch: Partial<Omit<Panel, 'id'>>) {
	await db.update(t.panels).set(patch).where(eq(t.panels.id, id));
}

export async function createPanel(values: typeof t.panels.$inferInsert): Promise<number> {
	const [row] = await db.insert(t.panels).values(values).returning({ id: t.panels.id }).all();
	return row.id;
}

// ---- Breakers

export async function updateBreaker(id: number, patch: Partial<Omit<Breaker, 'id' | 'panelId'>>) {
	await db.update(t.breakers).set(patch).where(eq(t.breakers.id, id));
}

export async function createBreaker(values: typeof t.breakers.$inferInsert): Promise<number> {
	const [row] = await db.insert(t.breakers).values(values).returning({ id: t.breakers.id }).all();
	return row.id;
}

export async function deleteBreaker(id: number) {
	await db.delete(t.breakers).where(eq(t.breakers.id, id));
}

// ---- Items

export type ItemValues = Partial<Omit<Item, 'id'>>;

/** Creates an item and returns its id. */
export async function createItem(values: ItemValues & { name: string }, breakerIds: number[] = []): Promise<number> {
	const [row] = await db.insert(t.items).values(values).returning({ id: t.items.id }).all();
	if (breakerIds.length) {
		await db.insert(t.itemBreakers).values(breakerIds.map((breakerId) => ({ itemId: row.id, breakerId })));
	}
	return row.id;
}

export async function updateItem(id: number, patch: ItemValues) {
	await db.update(t.items).set(patch).where(eq(t.items.id, id));
}

export async function deleteItems(ids: number[]) {
	if (ids.length) await db.delete(t.items).where(inArray(t.items.id, ids));
}

/** Replaces the breakers that feed an item. */
export async function setItemBreakers(itemId: number, breakerIds: number[]) {
	const del = db.delete(t.itemBreakers).where(eq(t.itemBreakers.itemId, itemId));
	if (!breakerIds.length) return void (await del);
	await db.batch([del, db.insert(t.itemBreakers).values(breakerIds.map((breakerId) => ({ itemId, breakerId })))]);
}

/** Puts several items on one breaker (or none), replacing what fed them. */
export async function moveItemsToBreaker(itemIds: number[], breakerId: number | null) {
	if (!itemIds.length) return;
	const del = db.delete(t.itemBreakers).where(inArray(t.itemBreakers.itemId, itemIds));
	if (breakerId === null) return void (await del);
	await db.batch([del, db.insert(t.itemBreakers).values(itemIds.map((itemId) => ({ itemId, breakerId })))]);
}

/** Moves an item from one breaker to another, keeping any other breakers it's on. */
export async function swapItemBreaker(itemId: number, from: number | null, to: number | null) {
	const ops = [];
	if (from !== null) {
		ops.push(db.delete(t.itemBreakers).where(and(eq(t.itemBreakers.itemId, itemId), eq(t.itemBreakers.breakerId, from))));
	}
	if (to !== null) ops.push(db.insert(t.itemBreakers).values({ itemId, breakerId: to }).onConflictDoNothing());
	if (ops.length) await db.batch(ops as [(typeof ops)[number], ...typeof ops]);
}

/**
 * Saves a trace in one write: the breaker's label, which items it feeds (marked items are moved
 * onto it from whatever fed them; items that were on it and aren't marked come off it), and when
 * it was checked.
 */
export async function saveTrace(breakerId: number, label: string, markedItemIds: number[]) {
	const current = await db
		.select({ itemId: t.itemBreakers.itemId })
		.from(t.itemBreakers)
		.where(eq(t.itemBreakers.breakerId, breakerId))
		.all();
	const unmarked = current.map((r) => r.itemId).filter((id) => !markedItemIds.includes(id));
	const ops = [
		db
			.update(t.breakers)
			.set({ label, isSpare: markedItemIds.length === 0, lastCheckedAt: Date.now() })
			.where(eq(t.breakers.id, breakerId))
	] as const;
	const rest = [];
	if (unmarked.length) {
		rest.push(
			db
				.delete(t.itemBreakers)
				.where(and(eq(t.itemBreakers.breakerId, breakerId), inArray(t.itemBreakers.itemId, unmarked)))
		);
	}
	if (markedItemIds.length) {
		rest.push(db.delete(t.itemBreakers).where(inArray(t.itemBreakers.itemId, markedItemIds)));
		rest.push(db.insert(t.itemBreakers).values(markedItemIds.map((itemId) => ({ itemId, breakerId }))));
	}
	await db.batch([...ops, ...rest]);
}

// ---- Floors

export async function createFloor(name: string, size?: { planWidth: number; planHeight: number }): Promise<number> {
	const top = await db.select({ level: max(t.floors.level) }).from(t.floors).get();
	const [row] = await db
		.insert(t.floors)
		.values({ name, level: (top?.level ?? -1) + 1, ...size })
		.returning({ id: t.floors.id })
		.all();
	return row.id;
}

export async function updateFloor(id: number, patch: Partial<Omit<Floor, 'id'>>) {
	await db.update(t.floors).set(patch).where(eq(t.floors.id, id));
}

/** Swaps a floor's place in the stack with the one above (+1) or below (-1). */
export async function moveFloor(id: number, dir: 1 | -1) {
	const all = await db.select().from(t.floors).all();
	all.sort((a, b) => a.level - b.level || a.id - b.id);
	const i = all.findIndex((f) => f.id === id);
	const j = i + dir;
	if (i < 0 || j < 0 || j >= all.length) return;
	[all[i], all[j]] = [all[j], all[i]];
	const ops = all.map((f, level) => db.update(t.floors).set({ level }).where(eq(t.floors.id, f.id)));
	await db.batch(ops as [(typeof ops)[number], ...typeof ops]);
}

/** Deletes a floor with its rooms, items and plan image. */
export async function deleteFloor(id: number) {
	const floor = await db.select().from(t.floors).where(eq(t.floors.id, id)).get();
	if (!floor) return;
	await db.batch([
		db.delete(t.items).where(eq(t.items.floorId, id)),
		db.delete(t.rooms).where(eq(t.rooms.floorId, id)),
		db.delete(t.floors).where(eq(t.floors.id, id))
	]);
	await deletePlan(floor.planImage);
}

/**
 * Sets a floor's plan image. The floor's drawing area keeps its width and takes the image's
 * aspect ratio, unless `keepSize`.
 */
export async function setFloorPlan(id: number, file: File, size?: { width: number; height: number }) {
	const floor = await db.select().from(t.floors).where(eq(t.floors.id, id)).get();
	if (!floor) return;
	const name = await savePlan(id, file);
	const patch: Partial<Floor> = { planImage: name };
	if (size && size.width > 0) patch.planHeight = Math.round((floor.planWidth * size.height) / size.width);
	await updateFloor(id, patch);
	await deletePlan(floor.planImage);
}

export async function removeFloorPlan(id: number) {
	const floor = await db.select().from(t.floors).where(eq(t.floors.id, id)).get();
	if (!floor) return;
	await updateFloor(id, { planImage: null });
	await deletePlan(floor.planImage);
}

// ---- Rooms

export async function createRoom(values: typeof t.rooms.$inferInsert): Promise<number> {
	const [row] = await db.insert(t.rooms).values(values).returning({ id: t.rooms.id }).all();
	return row.id;
}

export async function updateRoom(id: number, patch: Partial<Omit<Room, 'id'>>) {
	await db.update(t.rooms).set(patch).where(eq(t.rooms.id, id));
}

export async function deleteRoom(id: number) {
	await db.delete(t.rooms).where(eq(t.rooms.id, id));
}
