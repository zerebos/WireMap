// Every change the UI makes to the data, in one place. Pages call these through `mutate` from
// $lib/house so the house reloads afterwards.
import { and, eq, inArray, max, notInArray, sql, type SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { db } from './index';
import * as t from './schema';
import type { Breaker, Floor, Item, Panel, Room, Settings } from './schema';
import { savePlan, deletePlan } from '../plans';
import { roomAt, type Shape } from '../shape';
import { checkFit, deriveSpaces, panelProblem, reshapeProblem, respace, type Space } from '../panel';

// ---- Occupancy (DATA-MODEL.md): every write that places breakers checks the panel first

/** A write that would leave breakers overlapping or outside the panel. The message is for people. */
export class FitError extends Error {
	name = 'FitError';
}

type Query = BatchItem<'sqlite'>;
type Placement = Breaker & { spaces: Space[] };
type PanelState = { p: Panel; bs: Placement[] };

/** Runs statements as one all-or-nothing write. */
const batch = (qs: Query[]) => (qs.length ? db.batch(qs as [Query, ...Query[]]) : Promise.resolve([]));

/** A panel and its breakers with the spaces each takes. */
async function panelState(panelId: number): Promise<PanelState> {
	const p = await db.select().from(t.panels).where(eq(t.panels.id, panelId)).get();
	if (!p) throw new Error('No such panel');
	const bs = await db.select().from(t.breakers).where(eq(t.breakers.panelId, panelId)).all();
	const rows = bs.length
		? await db.select().from(t.breakerSpaces).where(inArray(t.breakerSpaces.breakerId, bs.map((b) => b.id))).all()
		: [];
	const spaces = (id: number) => rows.filter((r) => r.breakerId === id).map((r) => ({ slot: r.slot, half: r.half }));
	return { p, bs: bs.map((b) => ({ ...b, spaces: spaces(b.id) })) };
}

/** The first space, which is the breaker's anchor (breakers.slot and .half). */
const anchorOf = (spaces: Space[]) => [...spaces].sort((a, c) => a.slot - c.slot || (a.half ?? '').localeCompare(c.half ?? ''))[0];

/** The id of the breaker inserted just before, for statements in the same batch. */
const lastBreaker = sql`(select max(${t.breakers.id}) from ${t.breakers})`;

type Change =
	| { id: number; set?: Partial<Omit<Breaker, 'id' | 'panelId'>>; spaces?: Space[] }
	| { values: typeof t.breakers.$inferInsert; spaces: Space[] };

/**
 * Checks that every breaker `changes` places (existing breakers moved, new ones added) fits the panel
 * as it would be afterwards, then writes the changes and `extra` statements in one batch. Otherwise
 * it throws a FitError and writes nothing.
 * Returns the new breakers' ids in order, and the batch's results.
 */
async function commit(s: PanelState, changes: Change[], extra: Query[] = []) {
	const after = new Map(s.bs.map((b) => [b.id, b]));
	const placed: number[] = [];
	let temp = -1;
	for (const c of changes) {
		if ('values' in c) {
			const id = temp--;
			const a = anchorOf(c.spaces);
			after.set(id, { poles: 1, ...c.values, id, slot: a.slot, half: a.half, spaces: c.spaces } as Placement);
			placed.push(id);
			continue;
		}
		const b = after.get(c.id);
		if (!b) throw new Error('No such breaker');
		const spaces = c.spaces ?? b.spaces;
		const a = anchorOf(spaces);
		after.set(c.id, { ...b, ...c.set, slot: a.slot, half: a.half, spaces });
		if (c.spaces) placed.push(c.id);
	}
	// Only the breakers being placed are checked, so a panel that's already wrong somewhere can still be fixed.
	const all = [...after.values()];
	for (const id of placed) {
		const b = after.get(id)!;
		const why = checkFit(b, s.p, all) ?? panelProblem(s.p, [b]);
		if (why) throw new FitError(why);
	}

	const qs: Query[] = [];
	const inserts: number[] = [];
	for (const c of changes) {
		const a = anchorOf('values' in c ? c.spaces : (c.spaces ?? after.get(c.id)!.spaces));
		if ('values' in c) {
			inserts.push(qs.length);
			qs.push(db.insert(t.breakers).values({ ...c.values, slot: a.slot, half: a.half }).returning({ id: t.breakers.id }));
			qs.push(db.insert(t.breakerSpaces).values(c.spaces.map((r) => ({ breakerId: lastBreaker, slot: r.slot, half: r.half }))));
			continue;
		}
		const set = { ...c.set, ...(c.spaces ? { slot: a.slot, half: a.half } : {}) };
		if (Object.keys(set).length) qs.push(db.update(t.breakers).set(set).where(eq(t.breakers.id, c.id)));
		if (c.spaces) {
			qs.push(db.delete(t.breakerSpaces).where(eq(t.breakerSpaces.breakerId, c.id)));
			qs.push(db.insert(t.breakerSpaces).values(c.spaces.map((r) => ({ breakerId: c.id, slot: r.slot, half: r.half }))));
		}
	}
	const results = (await batch([...qs, ...extra])) as unknown[];
	const ids = inserts.map((i) => (results[i] as { id: number }[])[0].id);
	return { ids, results: results.slice(qs.length) };
}

// ---- Settings and panels

export async function updateSettings(patch: Partial<Omit<Settings, 'id'>>) {
	await db.update(t.settings).set(patch).where(eq(t.settings.id, 1));
}

/**
 * Updates a panel. A new slot count or numbering is refused with a FitError (`reshapeProblem`) when
 * a breaker would be left outside the panel or overlapping, or when a new numbering meets a quad. A
 * new numbering moves the second space of full-size 2-pole breakers.
 */
export async function updatePanel(id: number, patch: Partial<Omit<Panel, 'id'>>) {
	const update = db.update(t.panels).set(patch).where(eq(t.panels.id, id));
	if (!('slotCount' in patch) && !('numbering' in patch)) return void (await update);
	const s = await panelState(id);
	const next = { ...s.p, ...patch };
	const why = reshapeProblem(s.p, next, s.bs);
	if (why) throw new FitError(why);
	const qs: Query[] = [update];
	if (next.numbering !== s.p.numbering) {
		for (const b of respace(s.bs, next)) {
			if (b.poles !== 2 || b.half) continue;
			qs.push(db.delete(t.breakerSpaces).where(eq(t.breakerSpaces.breakerId, b.id)));
			qs.push(db.insert(t.breakerSpaces).values(b.spaces.map((r) => ({ breakerId: b.id, slot: r.slot, half: r.half }))));
		}
	}
	await batch(qs);
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
	// One batch, so a failed insert (say, a taken short code) leaves no stray or relabeled feeder.
	const panel = (fedByBreakerId: number | SQL) =>
		db
			.insert(t.panels)
			.values({
				name: v.name,
				shortCode: v.shortCode,
				slotCount: v.slotCount,
				mainAmps: v.mainAmps,
				location: v.location,
				numbering: 'odd_left_even_right',
				fedByBreakerId
			})
			.returning({ id: t.panels.id });
	let results: unknown[];
	if ('breakerId' in v.fedBy) {
		const feeder = v.fedBy.breakerId;
		// A feeder is a full-size 2-pole breaker (DESIGN.md §5.17).
		const b = await db.select().from(t.breakers).where(eq(t.breakers.id, feeder)).get();
		if (!b || b.poles !== 2 || b.half !== null) throw new Error('A subpanel has to be fed from a full-size 2-pole breaker.');
		results = (await batch([db.update(t.breakers).set({ label: v.name }).where(eq(t.breakers.id, feeder)), panel(feeder)])).slice(1);
	} else {
		const s = await panelState(v.fedBy.panelId);
		const values = { panelId: v.fedBy.panelId, slot: v.fedBy.slot, poles: 2, amps: v.fedBy.amps, kind: 'standard' as const, label: v.name };
		results = (await commit(s, [{ values, spaces: deriveSpaces(values, s.p) }], [panel(lastBreaker)])).results;
	}
	return (results[0] as { id: number }[])[0].id;
}

/** Renames a panel; a subpanel's feeder label follows its name. */
export async function renamePanel(id: number, name: string) {
	const p = await db.select().from(t.panels).where(eq(t.panels.id, id)).get();
	const qs: Query[] = [db.update(t.panels).set({ name }).where(eq(t.panels.id, id))];
	if (p?.fedByBreakerId != null) qs.push(db.update(t.breakers).set({ label: name }).where(eq(t.breakers.id, p.fedByBreakerId)));
	await batch(qs);
}

/**
 * Deletes a subpanel and any subpanels fed from it. Their breakers go with them, so the items on
 * those breakers become "No breaker". The feeder in the parent panel stays.
 */
export async function deletePanel(id: number) {
	// One transaction, so a subpanel added meanwhile can't be missed and left without its feeder.
	await db.transaction(async (tx) => {
		const doomed = [id];
		for (let i = 0; i < doomed.length; i++) {
			const inside = await tx.select({ id: t.breakers.id }).from(t.breakers).where(eq(t.breakers.panelId, doomed[i])).all();
			if (!inside.length) continue;
			const subs = await tx
				.select({ id: t.panels.id })
				.from(t.panels)
				.where(inArray(t.panels.fedByBreakerId, inside.map((b) => b.id)))
				.all();
			doomed.push(...subs.map((s) => s.id).filter((s) => !doomed.includes(s)));
		}
		await tx.delete(t.panels).where(inArray(t.panels.id, doomed));
	});
}

// ---- Breakers

const breakerById = (id: number) => db.select().from(t.breakers).where(eq(t.breakers.id, id)).get();

/**
 * Rewrites a breaker's breaker_spaces rows (DATA-MODEL.md "Occupancy"). Without `spaces`, they're
 * derived from its slot, poles and half; a quad passes its spaces explicitly.
 */
export async function setSpaces(id: number, spaces?: Space[]) {
	const b = await breakerById(id);
	if (!b) return;
	const s = await panelState(b.panelId);
	await commit(s, [{ id, spaces: spaces ?? deriveSpaces(b, s.p) }]);
}

export type BreakerPatch = Partial<Omit<Breaker, 'id' | 'panelId'>>;

export async function updateBreaker(id: number, patch: BreakerPatch) {
	await updateBreakers([{ id, patch }]);
}

/**
 * Saves edits to several breakers of one panel in one write. The panel is checked as it would be
 * with every edit applied, so one breaker can take a space another one gives up in the same save.
 */
export async function updateBreakers(edits: { id: number; patch: BreakerPatch }[]) {
	if (!edits.length) return;
	for (const { id, patch } of edits) if ((patch.poles !== undefined && patch.poles !== 2) || patch.half) await keepFeeder(id);
	const first = await breakerById(edits[0].id);
	if (!first) return;
	const s = await panelState(first.panelId);
	const byId = new Map(s.bs.map((b) => [b.id, b]));
	const changes: Change[] = edits.map(({ id, patch }) => {
		const before = byId.get(id);
		if (!before) throw new Error('These breakers aren’t all on one panel.');
		// Only a real move or resize re-derives the spaces, so saving a label keeps a quad pair's halves.
		const moved = (['slot', 'half', 'poles'] as const).some((k) => k in patch && patch[k] !== before[k]);
		return moved ? { id, set: patch, spaces: deriveSpaces({ ...before, ...patch }, s.p) } : { id, set: patch };
	});
	await commit(s, changes);
}

/** A breaker to add: its values, and its spaces when they aren't derived from slot, poles and half (a quad pair). */
export type NewBreaker = { values: Omit<typeof t.breakers.$inferInsert, 'panelId'>; spaces?: Space[] };

/**
 * Adds breakers to a panel in one write: all of them, or none when any one doesn't fit (a FitError).
 * Returns their ids in order.
 */
export async function createBreakers(panelId: number, list: NewBreaker[]): Promise<number[]> {
	if (!list.length) return [];
	const s = await panelState(panelId);
	const changes: Change[] = list.map(({ values, spaces }) => ({
		values: { ...values, panelId },
		spaces: spaces ?? deriveSpaces({ slot: values.slot, poles: values.poles ?? 1, half: values.half ?? null }, s.p)
	}));
	return (await commit(s, changes)).ids;
}

export async function createBreaker(values: typeof t.breakers.$inferInsert, spaces?: Space[]): Promise<number> {
	return (await createBreakers(values.panelId, [{ values, spaces }]))[0];
}

type QuadHalf = { label: string; amps: number; kind?: Breaker['kind'] };
/**
 * The breakers of a quad at `slot` and the slot below (DESIGN.md §5.18): two 2-pole pairs, or a
 * 2-pole outer pair and two 1-pole halves (sB, belowA). The outer pair comes first.
 */
export function quadBreakers(slot: number, below: number, outer: QuadHalf, inner: QuadHalf | { b: QuadHalf; c: QuadHalf }): NewBreaker[] {
	const kind = 'standard' as const;
	const out: NewBreaker[] = [
		{
			values: { kind, ...outer, slot, half: 'A', poles: 2 },
			spaces: [
				{ slot, half: 'A' },
				{ slot: below, half: 'B' }
			]
		}
	];
	if ('b' in inner) {
		out.push({ values: { kind, ...inner.b, slot, half: 'B', poles: 1 } });
		out.push({ values: { kind, ...inner.c, slot: below, half: 'A', poles: 1 } });
	} else {
		out.push({
			values: { kind, ...inner, slot, half: 'B', poles: 2 },
			spaces: [
				{ slot, half: 'B' },
				{ slot: below, half: 'A' }
			]
		});
	}
	return out;
}

/** Adds a quad (see `quadBreakers`). Returns the outer pair's id. */
export async function createQuad(
	panelId: number,
	slot: number,
	below: number,
	outer: QuadHalf,
	inner: QuadHalf | { b: QuadHalf; c: QuadHalf }
): Promise<number> {
	return (await createBreakers(panelId, quadBreakers(slot, below, outer, inner)))[0];
}

/**
 * Turns a full-size 2-pole breaker into the outer pair of a quad and adds an empty inner pair.
 * Returns the inner pair's id.
 */
export async function makeQuad(id: number, below: number): Promise<number> {
	await keepFeeder(id);
	const b = await breakerById(id);
	if (!b) throw new Error('No such breaker');
	const s = await panelState(b.panelId);
	const { ids } = await commit(s, [
		{
			id,
			spaces: [
				{ slot: b.slot, half: 'A' },
				{ slot: below, half: 'B' }
			]
		},
		{
			values: { panelId: b.panelId, slot: b.slot, half: 'B', poles: 2, amps: b.amps, kind: 'standard', label: '' },
			spaces: [
				{ slot: b.slot, half: 'B' },
				{ slot: below, half: 'A' }
			]
		}
	]);
	return ids[0];
}

/**
 * Brands differ on which handles pair up (§5.18): swapping outer and inner swaps the halves on the
 * quad's second slot for everything in it.
 */
export async function swapQuadPairs(ids: number[], below: number) {
	// Outer (sA + belowB) and inner (sB + belowA) trade places: every half in the quad flips.
	const first = ids.length ? await breakerById(ids[0]) : undefined;
	if (!first) return;
	const s = await panelState(first.panelId);
	const flip = (h: Space['half']) => (h === 'A' ? 'B' : h === 'B' ? 'A' : null);
	await commit(
		s,
		s.bs.filter((b) => ids.includes(b.id)).map((b) => ({ id: b.id, spaces: b.spaces.map((r) => ({ slot: r.slot, half: flip(r.half) })) }))
	);
}

/** A subpanel feeder stays a full-size 2-pole breaker (DESIGN.md §5.17). */
async function keepFeeder(id: number) {
	const fed = await db.select({ id: t.panels.id }).from(t.panels).where(eq(t.panels.fedByBreakerId, id)).get();
	if (fed) throw new FitError('A subpanel feeder has to stay a full-size 2-pole breaker.');
}

/**
 * Splits a full-size breaker into tandem halves (DESIGN.md §5.15): it becomes a 1-pole half A and
 * an empty, unlabeled half B is added. Returns half B's id. Running it again on a breaker that is
 * already a half changes nothing and returns its slot's B half.
 */
export async function makeTandem(id: number): Promise<number> {
	await keepFeeder(id);
	const b = await breakerById(id);
	if (!b) throw new Error('No such breaker');
	if (b.half !== null) {
		const mate = await db
			.select({ id: t.breakers.id })
			.from(t.breakers)
			.where(and(eq(t.breakers.panelId, b.panelId), eq(t.breakers.slot, b.slot), eq(t.breakers.half, 'B')))
			.get();
		return mate?.id ?? b.id;
	}
	const s = await panelState(b.panelId);
	const { ids } = await commit(s, [
		{ id, set: { half: 'A', poles: 1 }, spaces: [{ slot: b.slot, half: 'A' }] },
		{ values: { panelId: b.panelId, slot: b.slot, half: 'B', poles: 1, amps: b.amps, kind: 'standard', label: '' }, spaces: [{ slot: b.slot, half: 'B' }] }
	]);
	return ids[0];
}

export async function deleteBreaker(id: number) {
	// Delete the subpanel first (Settings → Panels), or it would point at a breaker that's gone.
	const fed = await db.select({ id: t.panels.id }).from(t.panels).where(eq(t.panels.fedByBreakerId, id)).get();
	if (fed) throw new Error('This breaker feeds a subpanel. Delete the subpanel first.');
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
		const qs: Query[] = [db.update(t.breakers).set({ tieGroup: g }).where(inArray(t.breakers.id, breakerIds))];
		if (groups.length) qs.push(db.update(t.breakers).set({ tieGroup: g }).where(inArray(t.breakers.tieGroup, groups)));
		return void (await batch(qs));
	}
	const left = groups.length
		? await db.select({ id: t.breakers.id, g: t.breakers.tieGroup }).from(t.breakers).where(inArray(t.breakers.tieGroup, groups)).all()
		: [];
	// A group left with one breaker once these come off it isn't a tie any more.
	const lone = groups.filter((g) => left.filter((r) => r.g === g && !breakerIds.includes(r.id)).length === 1);
	const qs: Query[] = [db.update(t.breakers).set({ tieGroup: null }).where(inArray(t.breakers.id, breakerIds))];
	if (lone.length) qs.push(db.update(t.breakers).set({ tieGroup: null }).where(inArray(t.breakers.tieGroup, lone)));
	await batch(qs);
}

// ---- Items

export type ItemValues = Partial<Omit<Item, 'id'>>;

/** Creates an item and returns its id. */
export async function createItem(values: ItemValues & { name: string }, breakerIds: number[] = []): Promise<number> {
	// One write: the item rows point at the item inserted just before them.
	const item = sql`(select max(${t.items.id}) from ${t.items})`;
	const qs: Query[] = [db.insert(t.items).values(values).returning({ id: t.items.id })];
	if (breakerIds.length) qs.push(db.insert(t.itemBreakers).values(breakerIds.map((breakerId) => ({ itemId: item, breakerId }))));
	const [rows] = (await batch(qs)) as [{ id: number }[]];
	return rows[0].id;
}

/** An existing row's id, or the index of a row the same import creates. */
export type ImportRef = { id: number } | { new: number };
export type ImportInput = {
	/** New floors, stacked on top of the existing ones in this order. */
	floors: string[];
	/** New rooms, without a shape. */
	rooms: { name: string; floor: ImportRef }[];
	/** New items, not placed on the map. */
	items: (Pick<Item, 'name' | 'type' | 'critical' | 'criticalNote' | 'notes'> & {
		floor: ImportRef | null;
		room: ImportRef | null;
		breakerIds: number[];
	})[];
};

/**
 * Adds a CSV import (DESIGN.md §5.20) in one write: new floors, then new rooms, then the items and
 * their item_breakers rows. If any statement fails, nothing is saved. New rows get their ids up
 * front so the rows after them can point at them within the same batch.
 */
export async function importItems(input: ImportInput) {
	const [f, r, i] = await Promise.all([
		db.select({ id: max(t.floors.id), level: max(t.floors.level) }).from(t.floors).get(),
		db.select({ id: max(t.rooms.id) }).from(t.rooms).get(),
		db.select({ id: max(t.items.id) }).from(t.items).get()
	]);
	const floorIds = input.floors.map((_, n) => (f?.id ?? 0) + 1 + n);
	const roomIds = input.rooms.map((_, n) => (r?.id ?? 0) + 1 + n);
	const itemIds = input.items.map((_, n) => (i?.id ?? 0) + 1 + n);
	const floorOf = (ref: ImportRef | null) => (ref === null ? null : 'id' in ref ? ref.id : floorIds[ref.new]);
	const roomOf = (ref: ImportRef | null) => (ref === null ? null : 'id' in ref ? ref.id : roomIds[ref.new]);
	// Big imports go in slices, to stay under SQLite's limit on parameters per statement.
	const slices = <T>(rows: T[], size = 500) => Array.from({ length: Math.ceil(rows.length / size) }, (_, n) => rows.slice(n * size, (n + 1) * size));

	const qs: Query[] = [];
	if (input.floors.length) {
		qs.push(db.insert(t.floors).values(input.floors.map((name, n) => ({ id: floorIds[n], name, level: (f?.level ?? -1) + 1 + n }))));
	}
	for (const s of slices(input.rooms.map((x, n) => ({ id: roomIds[n], name: x.name, floorId: floorOf(x.floor), kind: 'interior' as const, shape: null })))) {
		qs.push(db.insert(t.rooms).values(s));
	}
	const items = input.items.map(({ floor, room, breakerIds, ...values }, n) => ({ ...values, id: itemIds[n], floorId: floorOf(floor), roomId: roomOf(room) }));
	for (const s of slices(items)) qs.push(db.insert(t.items).values(s));
	const links = input.items.flatMap((x, n) => [...new Set(x.breakerIds)].map((breakerId) => ({ itemId: itemIds[n], breakerId })));
	for (const s of slices(links)) qs.push(db.insert(t.itemBreakers).values(s));
	await batch(qs);
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
			.set({
				label,
				isSpare: markedItemIds.length === 0,
				lastCheckedAt: Date.now()
			})
			.where(eq(t.breakers.id, breakerId))
	] as const;
	const rest = [];
	if (unmarked.length) {
		rest.push(db.delete(t.itemBreakers).where(and(eq(t.itemBreakers.breakerId, breakerId), inArray(t.itemBreakers.itemId, unmarked))));
	}
	if (moved.length) rest.push(db.delete(t.itemBreakers).where(inArray(t.itemBreakers.itemId, moved)));
	if (added.length) rest.push(db.insert(t.itemBreakers).values(added.map((itemId) => ({ itemId, breakerId }))));
	await db.batch([...ops, ...rest]);
}

// ---- Floors

export async function createFloor(name: string, size?: { planWidth: number; planHeight: number }): Promise<number> {
	const top = await db
		.select({ level: max(t.floors.level) })
		.from(t.floors)
		.get();
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
				.set({
					x: sql`${t.items.x} + ${carry.dx}`,
					y: sql`${t.items.y} + ${carry.dy}`
				})
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
	await db
		.update(t.items)
		.set({ floorId, x, y, roomId: await roomFor(floorId, x, y) })
		.where(eq(t.items.id, id));
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
		db.delete(t.rooms).where(and(eq(t.rooms.floorId, s.floorId), keep.length ? notInArray(t.rooms.id, keep) : undefined)),
		...s.rooms.map((r) =>
			db
				.insert(t.rooms)
				.values(r)
				.onConflictDoUpdate({
					target: t.rooms.id,
					set: {
						floorId: r.floorId,
						name: r.name,
						kind: r.kind,
						shape: r.shape
					}
				})
		),
		...s.items.map((i) => db.update(t.items).set({ x: i.x, y: i.y, roomId: i.roomId }).where(eq(t.items.id, i.id))),
		db.update(t.floors).set(s.floor).where(eq(t.floors.id, s.floorId))
	];
	await db.batch(ops as unknown as [(typeof ops)[0], ...(typeof ops)[0][]]);
}
