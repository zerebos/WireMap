// The write layer against a real SQLite database: bun:sqlite behind Drizzle's sqlite-proxy
// driver, the same way the browser worker runs it. Run with `bun test`.
import { Database } from 'bun:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { eq } from 'drizzle-orm';
import * as schema from './schema';

let sqlite: Database;
const run = (sql: string, params: unknown[], method: string) => {
	const q = sqlite.query(sql);
	if (method === 'run') return (q.run(...(params as [])), []);
	const rows = q.values(...(params as [])) as unknown[][];
	return method === 'get' ? rows[0] : rows;
};
const db = drizzle(
	async (sql, params, method) => ({ rows: run(sql, params, method) as unknown[] }),
	async (statements) => {
		sqlite.run('BEGIN');
		try {
			const out = statements.map((s) => ({ rows: run(s.sql, s.params, s.method) as unknown[] }));
			sqlite.run('COMMIT');
			return out;
		} catch (e) {
			sqlite.run('ROLLBACK');
			throw e;
		}
	},
	{ schema }
);
mock.module('./index', () => ({ db }));
const ops = await import('./ops');
const t = schema;

let panel: number;
beforeEach(async () => {
	sqlite = new Database(':memory:');
	sqlite.run('PRAGMA foreign_keys = ON');
	for (const f of readdirSync('drizzle').filter((f) => f.endsWith('.sql')).sort()) {
		for (const stmt of readFileSync(`drizzle/${f}`, 'utf8').split('--> statement-breakpoint')) if (stmt.trim()) sqlite.run(stmt);
	}
	panel = await ops.createPanel({ name: 'Main panel', slotCount: 20, numbering: 'odd_left_even_right' });
});

const spaces = async () =>
	(await db.select().from(t.breakerSpaces).all()).map((r) => `${r.breakerId}:${r.slot}${r.half ?? ''}`).sort();
const count = async () => (await db.select().from(t.breakers).all()).length;
const add = (slot: number, poles = 1, half: 'A' | 'B' | null = null) =>
	ops.createBreaker({ panelId: panel, slot, poles, half, label: `at ${slot}` });

describe('occupancy is enforced in the write layer', () => {
	test('createBreaker refuses a taken space and writes nothing', async () => {
		await add(1, 2);
		const before = await spaces();
		await expect(add(3)).rejects.toThrow(ops.FitError);
		await expect(add(3)).rejects.toThrow('Slot 3 is already taken.');
		expect(await count()).toBe(1);
		expect(await spaces()).toEqual(before);
	});

	test('createBreaker refuses a 2-pole with no slot below', async () => {
		await expect(add(19, 2)).rejects.toThrow(ops.FitError);
		expect(await count()).toBe(0);
	});

	test('a tandem half fits beside the other half, not over a whole breaker', async () => {
		await add(5, 1, 'A');
		await add(5, 1, 'B');
		await expect(add(5, 1, 'A')).rejects.toThrow(ops.FitError);
		await add(7);
		await expect(add(7, 1, 'B')).rejects.toThrow(ops.FitError);
	});

	test('setSpaces refuses spaces another breaker has', async () => {
		const a = await add(1);
		await add(3);
		await expect(ops.setSpaces(a, [{ slot: 1, half: null }, { slot: 3, half: null }])).rejects.toThrow(ops.FitError);
		const b = await db.select().from(t.breakerSpaces).where(eq(t.breakerSpaces.breakerId, a)).all();
		expect(b.map((r) => r.slot)).toEqual([1]);
	});

	test('updateBreaker refuses a move or resize onto another breaker', async () => {
		const a = await add(1);
		await add(3);
		await add(2);
		await expect(ops.updateBreaker(a, { poles: 2 })).rejects.toThrow(ops.FitError);
		await expect(ops.updateBreaker(a, { slot: 2 })).rejects.toThrow(ops.FitError);
		const row = await db.select().from(t.breakers).where(eq(t.breakers.id, a)).get();
		expect([row!.slot, row!.poles]).toEqual([1, 1]);
		// A label still saves.
		await ops.updateBreaker(a, { label: 'Kitchen' });
		await ops.updateBreaker(a, { slot: 5 });
		expect(await spaces()).toContain(`${a}:5`);
	});

	test('createQuad refuses occupied spaces and writes none of its breakers', async () => {
		await add(3, 1);
		await expect(ops.createQuad(panel, 1, 3, { label: 'Out', amps: 20 }, { label: 'In', amps: 20 })).rejects.toThrow(ops.FitError);
		expect(await count()).toBe(1);
		const id = await ops.createQuad(panel, 5, 7, { label: 'Out', amps: 20 }, { b: { label: 'B', amps: 15 }, c: { label: 'C', amps: 15 } });
		expect(await count()).toBe(4);
		expect((await spaces()).filter((s) => s.startsWith(`${id}:`))).toEqual([`${id}:5A`, `${id}:7B`]);
	});

	test('makeQuad refuses when the inner spaces are taken', async () => {
		const a = await add(1, 2);
		await ops.createQuad(panel, 9, 11, { label: 'Out', amps: 20 }, { label: 'In', amps: 20 });
		const inner = await ops.makeQuad(a, 3);
		expect((await spaces()).filter((s) => s.startsWith(`${a}:`) || s.startsWith(`${inner}:`))).toEqual(
			[`${a}:1A`, `${a}:3B`, `${inner}:1B`, `${inner}:3A`].sort()
		);
		// A second slot that another breaker holds.
		const b = await add(13, 2);
		await add(17);
		const n = await count();
		await expect(ops.makeQuad(b, 17)).rejects.toThrow(ops.FitError);
		expect(await count()).toBe(n);
		expect((await spaces()).filter((s) => s.startsWith(`${b}:`))).toEqual([`${b}:13`, `${b}:15`]);
	});

	test('makeTandem splits a breaker and adds half B in one write', async () => {
		const a = await add(1);
		const b = await ops.makeTandem(a);
		expect(await spaces()).toEqual([`${a}:1A`, `${b}:1B`].sort());
	});

	test('swapQuadPairs flips every half and keeps the anchors right', async () => {
		const out = await ops.createQuad(panel, 1, 3, { label: 'Out', amps: 20 }, { label: 'In', amps: 20 });
		const inner = out + 1;
		await ops.swapQuadPairs([out, inner], 3);
		expect(await spaces()).toEqual([`${out}:1B`, `${out}:3A`, `${inner}:1A`, `${inner}:3B`].sort());
		const rows = await db.select().from(t.breakers).all();
		expect(rows.map((r) => `${r.id}:${r.slot}${r.half}`).sort()).toEqual([`${out}:1B`, `${inner}:1A`].sort());
	});

	test('createSubpanel with a new feeder refuses a taken slot and adds nothing', async () => {
		await add(3);
		const v = { name: 'Garage', shortCode: 'G', slotCount: 12, mainAmps: 60, location: null };
		await expect(ops.createSubpanel({ ...v, fedBy: { panelId: panel, slot: 1, amps: 60 } })).rejects.toThrow(ops.FitError);
		expect((await db.select().from(t.panels).all()).length).toBe(1);
		const id = await ops.createSubpanel({ ...v, fedBy: { panelId: panel, slot: 2, amps: 60 } });
		const sub = await db.select().from(t.panels).where(eq(t.panels.id, id)).get();
		const feeder = await db.select().from(t.breakers).where(eq(t.breakers.id, sub!.fedByBreakerId!)).get();
		expect([feeder!.slot, feeder!.poles, feeder!.label]).toEqual([2, 2, 'Garage']);
	});
});

test('a subpanel feeder can’t be made 1-pole or split, with a FitError', async () => {
	const id = await ops.createSubpanel({ name: 'Garage', shortCode: 'G', slotCount: 12, mainAmps: 60, location: null, fedBy: { panelId: panel, slot: 2, amps: 60 } });
	const sub = await db.select().from(t.panels).where(eq(t.panels.id, id)).get();
	await expect(ops.updateBreaker(sub!.fedByBreakerId!, { poles: 1 })).rejects.toThrow(ops.FitError);
	await expect(ops.makeTandem(sub!.fedByBreakerId!)).rejects.toThrow(ops.FitError);
});

describe('changing a panel’s shape', () => {
	test('shrinking with breakers in the removed slots is refused', async () => {
		await add(15);
		await expect(ops.updatePanel(panel, { slotCount: 12 })).rejects.toThrow('Slots 13–20 still have breakers. Move or remove them first.');
		const p = await db.select().from(t.panels).where(eq(t.panels.id, panel)).get();
		expect(p!.slotCount).toBe(20);
		await ops.updatePanel(panel, { slotCount: 16 });
		expect((await db.select().from(t.panels).where(eq(t.panels.id, panel)).get())!.slotCount).toBe(16);
	});

	test('a new numbering moves 2-pole second spaces, or is refused when they would clash', async () => {
		const a = await add(1, 2); // 1 + 3
		await ops.updatePanel(panel, { numbering: 'down_left_then_right' });
		expect(await spaces()).toEqual([`${a}:1`, `${a}:2`]);
		await add(3);
		await expect(ops.updatePanel(panel, { numbering: 'odd_left_even_right' })).rejects.toThrow(ops.FitError);
		expect(await spaces()).toContain(`${a}:2`);
	});
});

test('updatePanel refuses a new numbering while the panel has a quad', async () => {
	await ops.createQuad(panel, 1, 3, { label: 'Out', amps: 20 }, { label: 'In', amps: 20 });
	await expect(ops.updatePanel(panel, { numbering: 'down_left_then_right' })).rejects.toThrow('Quad breaker 1A/3B is placed for the current numbering.');
});

describe('multi-step writes are all or nothing', () => {
	test('updateBreakers saves drafts together, so one breaker can take a space another gives up', async () => {
		const range = await add(1, 2); // 1 + 3
		const b = await add(5);
		// Range goes to 1-pole and 5 moves up to 3, in one save.
		await ops.updateBreakers([
			{ id: range, patch: { poles: 1 } },
			{ id: b, patch: { slot: 3 } }
		]);
		expect(await spaces()).toEqual([`${range}:1`, `${b}:3`]);
	});

	test('updateBreakers refuses the whole save when one draft doesn’t fit', async () => {
		const a = await add(1);
		const b = await add(5);
		await add(7);
		await expect(
			ops.updateBreakers([
				{ id: a, patch: { label: 'Renamed' } },
				{ id: b, patch: { poles: 2 } }
			])
		).rejects.toThrow('Slot 7 is already taken.');
		const row = await db.select().from(t.breakers).where(eq(t.breakers.id, a)).get();
		expect(row!.label).toBe('at 1');
	});

	test('createBreakers adds every breaker or none', async () => {
		await add(9);
		await expect(
			ops.createBreakers(panel, [{ values: { slot: 1, label: 'a' } }, { values: { slot: 3, label: 'b' } }, { values: { slot: 9, half: 'A', label: 'c' } }])
		).rejects.toThrow(ops.FitError);
		expect(await count()).toBe(1);
		// Two halves of one slot, and a quad, in one go.
		const ids = await ops.createBreakers(panel, [
			{ values: { slot: 1, half: 'A', label: 'a' } },
			{ values: { slot: 1, half: 'B', label: 'b' } },
			...ops.quadBreakers(5, 7, { label: 'Out', amps: 20 }, { label: 'In', amps: 20 })
		]);
		expect(ids.length).toBe(4);
		expect((await spaces()).filter((s) => !s.startsWith(`1:`))).toEqual(
			[`${ids[0]}:1A`, `${ids[1]}:1B`, `${ids[2]}:5A`, `${ids[2]}:7B`, `${ids[3]}:5B`, `${ids[3]}:7A`].sort()
		);
	});

	test('two breakers on one panel can’t overlap each other in the same write', async () => {
		await expect(ops.createBreakers(panel, [{ values: { slot: 1, poles: 2 } }, { values: { slot: 3 } }])).rejects.toThrow(ops.FitError);
		expect(await count()).toBe(0);
	});

	test('createItem writes the item and its breakers together', async () => {
		const a = await add(1);
		const b = await add(3);
		const id = await ops.createItem({ name: 'Switch box' }, [a, b]);
		const rows = await db.select().from(t.itemBreakers).where(eq(t.itemBreakers.itemId, id)).all();
		expect(rows.map((r) => r.breakerId).sort()).toEqual([a, b].sort());
		await expect(ops.createItem({ name: 'Bad' }, [9999])).rejects.toThrow();
		expect((await db.select().from(t.items).all()).length).toBe(1);
	});

	test('renamePanel renames the feeder with the subpanel', async () => {
		const id = await ops.createSubpanel({ name: 'Garage', shortCode: 'G', slotCount: 12, mainAmps: 60, location: null, fedBy: { panelId: panel, slot: 2, amps: 60 } });
		await ops.renamePanel(id, 'Shop');
		const sub = await db.select().from(t.panels).where(eq(t.panels.id, id)).get();
		const feeder = await db.select().from(t.breakers).where(eq(t.breakers.id, sub!.fedByBreakerId!)).get();
		expect([sub!.name, feeder!.label]).toEqual(['Shop', 'Shop']);
	});

	test('setTied unties a group of two completely', async () => {
		const a = await add(1);
		const b = await add(3);
		const c = await add(5);
		await ops.setTied([a, b, c], true);
		await ops.setTied([a], false);
		const g = (await db.select().from(t.breakers).all()).map((r) => r.tieGroup);
		expect(g[0]).toBeNull();
		expect(g[1]).not.toBeNull();
		await ops.setTied([b], false);
		expect((await db.select().from(t.breakers).all()).every((r) => r.tieGroup === null)).toBe(true);
	});
});
