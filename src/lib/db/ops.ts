// Every change the UI makes to the data, in one place. Pages call these through `mutate` from
// $lib/house so the house reloads afterwards.
import { and, eq, inArray, max, notInArray, sql } from 'drizzle-orm';
import { db } from './index';
import * as t from './schema';
import type { Breaker, Floor, Item, Panel, Room, Settings } from './schema';
import { savePlan, deletePlan } from '../plans';
import { roomAt, type Shape } from '../shape';

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

export type SubpanelValues = {
	name: string;
	shortCode: string;
	slotCount: number;
	mainAmps: number | null;
	location: string | null;
	/** An existing 2-pole breaker, or a new 2-pole breaker at an open slot. */
	fedBy: { breakerId: number } | { panelId: number; slot: number; amps: number };
};

/**
 * Adds a subpanel (DESIGN.md §5.17). The feeder breaker's label becomes the subpanel's name;
 * "New breaker in an open slot" adds that 2-pole breaker first. Returns the new panel's id.
 */
export async function createSubpanel(v: SubpanelValues): Promise<number> {
	const feeder =
		'breakerId' in v.fedBy
			? v.fedBy.breakerId
			: await createBreaker({ panelId: v.fedBy.panelId, slot: v.fedBy.slot, poles: 2, amps: v.fedBy.amps, kind: 'standard', label: v.name });
	await updateBreaker(feeder, { label: v.name });
	return createPanel({
		name: v.name,
		shortCode: v.shortCode,
		slotCount: v.slotCount,
		mainAmps: v.mainAmps,
		location: v.location,
		numbering: 'odd_left_even_right',
		fedByBreakerId: feeder
	});
}

/** Renames a panel; a subpanel's feeder label follows its name. */
export async function renamePanel(id: number, name: string) {
	await updatePanel(id, { name });
	const p = await db.select().from(t.panels).where(eq(t.panels.id, id)).get();
	if (p?.fedByBreakerId != null) await updateBreaker(p.fedByBreakerId, { label: name });
}

/**
 * Deletes a subpanel and any subpanels fed from it. Their breakers go with them, so the items on
 * those breakers become "No breaker". The feeder in the parent panel stays.
 */
export async function deletePanel(id: number) {
	const doomed = [id];
	for (let i = 0; i < doomed.length; i++) {
		const inside = await db.select({ id: t.breakers.id }).from(t.breakers).where(eq(t.breakers.panelId, doomed[i])).all();
		if (!inside.length) continue;
		const subs = await db
			.select({ id: t.panels.id })
			.from(t.panels)
			.where(inArray(t.panels.fedByBreakerId, inside.map((b) => b.id)))
			.all();
		doomed.push(...subs.map((s) => s.id).filter((s) => !doomed.includes(s)));
	}
	await db.delete(t.panels).where(inArray(t.panels.id, doomed));
}

// ---- Breakers

export async function updateBreaker(id: number, patch: Partial<Omit<Breaker, 'id' | 'panelId'>>) {
	await db.update(t.breakers).set(patch).where(eq(t.breakers.id, id));
}

export async function createBreaker(values: typeof t.breakers.$inferInsert): Promise<number> {
	const [row] = await db.insert(t.breakers).values(values).returning({ id: t.breakers.id }).all();
	return row.id;
}

/**
 * Splits a full-size breaker into tandem halves (DESIGN.md §5.15): it becomes a 1-pole half A and
 * an empty, unlabeled half B is added. Returns half B's id. Running it again on a breaker that is
 * already a half changes nothing and returns its slot's B half.
 */
export async function makeTandem(id: number): Promise<number> {
	const b = await db.select().from(t.breakers).where(eq(t.breakers.id, id)).get();
	if (!b) throw new Error('No such breaker');
	if (b.half !== null) {
		const mate = await db
			.select({ id: t.breakers.id })
			.from(t.breakers)
			.where(and(eq(t.breakers.panelId, b.panelId), eq(t.breakers.slot, b.slot), eq(t.breakers.half, 'B')))
			.get();
		return mate?.id ?? b.id;
	}
	await db.update(t.breakers).set({ half: 'A', poles: 1 }).where(eq(t.breakers.id, id));
	return createBreaker({ panelId: b.panelId, slot: b.slot, half: 'B', poles: 1, amps: b.amps, kind: 'standard', label: '' });
}

export async function deleteBreaker(id: number) {
	await db.delete(t.breakers).where(eq(t.breakers.id, id));
}

/**
 * Handle-ties breakers together (a multi-wire circuit), or unties them. Tying merges any groups the
 * breakers already belong to, so an existing tie is never split; untying leaves no group of one.
 */
export async function setTied(breakerIds: number[], tied: boolean) {
	if (!breakerIds.length) return;
	const mine = await db.select({ g: t.breakers.tieGroup }).from(t.breakers).where(inArray(t.breakers.id, breakerIds)).all();
	const groups = [...new Set(mine.map((r) => r.g).filter((g): g is number => g !== null))];
	if (tied) {
		const top = await db.select({ g: max(t.breakers.tieGroup) }).from(t.breakers).get();
		const g = (top?.g ?? 0) + 1;
		await db.update(t.breakers).set({ tieGroup: g }).where(inArray(t.breakers.id, breakerIds));
		if (groups.length) await db.update(t.breakers).set({ tieGroup: g }).where(inArray(t.breakers.tieGroup, groups));
		return;
	}
	await db.update(t.breakers).set({ tieGroup: null }).where(inArray(t.breakers.id, breakerIds));
	if (!groups.length) return;
	const left = await db.select({ id: t.breakers.id, g: t.breakers.tieGroup }).from(t.breakers).where(inArray(t.breakers.tieGroup, groups)).all();
	const lone = groups.filter((g) => left.filter((r) => r.g === g).length === 1);
	if (lone.length) await db.update(t.breakers).set({ tieGroup: null }).where(inArray(t.breakers.tieGroup, lone));
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
 * onto it from whatever fed them, or added alongside for `keepItemIds`; items that were on it
 * and aren't marked come off it), and when it was checked.
 */
export async function saveTrace(breakerId: number, label: string, markedItemIds: number[], keepItemIds: number[] = []) {
	const current = await db
		.select({ itemId: t.itemBreakers.itemId })
		.from(t.itemBreakers)
		.where(eq(t.itemBreakers.breakerId, breakerId))
		.all();
	const currentIds = current.map((r) => r.itemId);
	const unmarked = currentIds.filter((id) => !markedItemIds.includes(id));
	// Items already on this breaker keep any other breakers they're on; newcomers move, unless
	// they're kept on both (a box where only part went dead).
	const added = markedItemIds.filter((id) => !currentIds.includes(id));
	const moved = added.filter((id) => !keepItemIds.includes(id));
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
	if (moved.length) rest.push(db.delete(t.itemBreakers).where(inArray(t.itemBreakers.itemId, moved)));
	if (added.length) rest.push(db.insert(t.itemBreakers).values(added.map((itemId) => ({ itemId, breakerId }))));
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
 * aspect ratio. With `keepOld`, the replaced image stays stored so undo can bring it back.
 */
export async function setFloorPlan(id: number, file: File, size?: { width: number; height: number }, keepOld = false) {
	const floor = await db.select().from(t.floors).where(eq(t.floors.id, id)).get();
	if (!floor) return;
	const name = await savePlan(id, file);
	const patch: Partial<Floor> = { planImage: name };
	if (size && size.width > 0) patch.planHeight = Math.round((floor.planWidth * size.height) / size.width);
	await updateFloor(id, patch);
	if (!keepOld) await deletePlan(floor.planImage);
}

export async function removeFloorPlan(id: number, keepOld = false) {
	const floor = await db.select().from(t.floors).where(eq(t.floors.id, id)).get();
	if (!floor) return;
	await updateFloor(id, { planImage: null });
	if (!keepOld) await deletePlan(floor.planImage);
}

// ---- Rooms and map layout

/** The room an item at (x, y) on a floor is in: derived from the rooms' shapes. */
async function roomFor(floorId: number, x: number, y: number): Promise<number | null> {
	const rs = await db.select().from(t.rooms).where(eq(t.rooms.floorId, floorId)).all();
	return roomAt([x, y], rs)?.id ?? null;
}

/** Re-derives the room of every placed item on a floor, after rooms change. */
export async function rederiveRooms(floorId: number) {
	const [rs, its] = await Promise.all([
		db.select().from(t.rooms).where(eq(t.rooms.floorId, floorId)).all(),
		db.select().from(t.items).where(eq(t.items.floorId, floorId)).all()
	]);
	const ops = its.flatMap((i) => {
		if (i.x === null || i.y === null) return [];
		const roomId = roomAt([i.x, i.y], rs)?.id ?? null;
		return roomId === i.roomId ? [] : [db.update(t.items).set({ roomId }).where(eq(t.items.id, i.id))];
	});
	if (ops.length) await db.batch(ops as [(typeof ops)[number], ...typeof ops]);
}

export async function createRoom(values: typeof t.rooms.$inferInsert): Promise<number> {
	const [row] = await db.insert(t.rooms).values(values).returning({ id: t.rooms.id }).all();
	if (values.floorId != null && values.shape) await rederiveRooms(values.floorId);
	return row.id;
}

export async function updateRoom(id: number, patch: Partial<Omit<Room, 'id'>>) {
	await db.update(t.rooms).set(patch).where(eq(t.rooms.id, id));
	if ('shape' in patch || 'floorId' in patch) {
		const room = await db.select().from(t.rooms).where(eq(t.rooms.id, id)).get();
		if (room?.floorId != null) await rederiveRooms(room.floorId);
	}
}

/** Moves or reshapes a room; `carry` moves those items by the same offset. */
export async function setRoomShape(id: number, shape: Shape, carry?: { itemIds: number[]; dx: number; dy: number }) {
	const ops = [db.update(t.rooms).set({ shape }).where(eq(t.rooms.id, id))];
	if (carry && carry.itemIds.length && (carry.dx || carry.dy)) {
		ops.push(
			db
				.update(t.items)
				.set({ x: sql`${t.items.x} + ${carry.dx}`, y: sql`${t.items.y} + ${carry.dy}` })
				.where(inArray(t.items.id, carry.itemIds)) as unknown as (typeof ops)[number]
		);
	}
	await db.batch(ops as [(typeof ops)[number], ...typeof ops]);
	const room = await db.select().from(t.rooms).where(eq(t.rooms.id, id)).get();
	if (room?.floorId != null) await rederiveRooms(room.floorId);
}

/** Deletes a room. Its items stay where they are and show as "Not in a room". */
export async function deleteRoom(id: number) {
	const room = await db.select().from(t.rooms).where(eq(t.rooms.id, id)).get();
	await db.delete(t.rooms).where(eq(t.rooms.id, id));
	if (room?.floorId != null) await rederiveRooms(room.floorId);
}

/** Puts an item on the map at (x, y) on a floor; its room comes from where it sits. */
export async function placeItem(id: number, floorId: number, x: number, y: number) {
	await db.update(t.items).set({ floorId, x, y, roomId: await roomFor(floorId, x, y) }).where(eq(t.items.id, id));
}

/** Takes an item off the map. It keeps its floor and room, and shows under "Not placed". */
export async function unplaceItem(id: number) {
	await db.update(t.items).set({ x: null, y: null }).where(eq(t.items.id, id));
}

/** A floor's layout, for undo: its rooms, where its items are, and the plan image and its transform. */
export type LayoutSnapshot = {
	floorId: number;
	rooms: Room[];
	items: Pick<Item, 'id' | 'x' | 'y' | 'roomId'>[];
	floor: Pick<Floor, 'planImage' | 'planHeight' | 'planOffsetX' | 'planOffsetY' | 'planScale' | 'planRotation' | 'planLocked' | 'planOpacity' | 'unitsPerFt'>;
};

/** Puts a floor's layout back the way a snapshot has it. */
export async function restoreLayout(s: LayoutSnapshot) {
	const keep = s.rooms.map((r) => r.id);
	const ops = [
		db
			.delete(t.rooms)
			.where(and(eq(t.rooms.floorId, s.floorId), keep.length ? notInArray(t.rooms.id, keep) : undefined)),
		...s.rooms.map((r) =>
			db.insert(t.rooms).values(r).onConflictDoUpdate({ target: t.rooms.id, set: { floorId: r.floorId, name: r.name, kind: r.kind, shape: r.shape } })
		),
		...s.items.map((i) => db.update(t.items).set({ x: i.x, y: i.y, roomId: i.roomId }).where(eq(t.items.id, i.id))),
		db.update(t.floors).set(s.floor).where(eq(t.floors.id, s.floorId))
	];
	await db.batch(ops as unknown as [(typeof ops)[0], ...(typeof ops)[0][]]);
}
