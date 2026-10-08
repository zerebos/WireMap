import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import seed from '../../docs/design/seed.json';
import { CsvError, guessColumns, guessFloor, guessType, looksLikeHeader, parse, plan, toImport, type Mapping } from './csv';
import { deriveSpaces } from './panel';
import type { House, HouseBreaker } from './house';
import type { Panel } from './db/schema';

// The example house (docs/design/seed.json) as loadHouse() would return it, plus a garage subpanel
// "G" and a tandem slot so subpanel and tandem numbers can be looked up.
function exampleHouse(): House {
	const main: Panel = { id: 1, name: 'Main panel', mainAmps: 200, slotCount: 40, numbering: 'odd_left_even_right', location: null, tandemSlots: '29-32', fedByBreakerId: null, shortCode: null } as Panel;
	const garage: Panel = { ...main, id: 2, name: 'Garage subpanel', mainAmps: 60, slotCount: 12, tandemSlots: null, fedByBreakerId: 100, shortCode: 'G' };
	let id = 0;
	const brk = (panel: Panel, slot: number, poles: number, label: string, half: 'A' | 'B' | null = null): HouseBreaker => {
		const b = { id: ++id, panelId: panel.id, slot, poles, half, amps: 20, kind: 'standard', label, color: null, isSpare: false, lastCheckedAt: null, notes: null, tieGroup: null } as unknown as HouseBreaker;
		return { ...b, spaces: deriveSpaces(b, panel) };
	};
	const breakers = seed.breakers.map((b) => brk(main, b.slot, b.poles, b.label ?? ''));
	breakers.push(brk(main, 31, 1, 'Porch', 'A'), brk(main, 31, 1, 'Closet', 'B'));
	breakers.push(brk(garage, 6, 1, 'Workbench'), brk(garage, 1, 2, 'Welder'));
	breakers.push({ ...brk(main, 34, 2, 'Garage feeder'), id: 100 });
	const bySlot = new Map(breakers.filter((b) => b.panelId === 1 && !b.half).map((b) => [b.slot, b.id]));
	const floors = seed.floors.map((f, n) => ({ id: n + 1, name: f.name, level: f.sort }));
	const floorId = new Map(seed.floors.map((f, n) => [f.id, n + 1]));
	const rooms = seed.rooms.map((r, n) => ({ id: n + 1, floorId: floorId.get(r.floor)!, name: r.name, kind: r.kind, shape: null }));
	const roomId = (floor: string, name: string) => rooms.find((r) => r.floorId === floorId.get(floor) && r.name === name)?.id ?? null;
	const items = seed.items.map((i, n) => ({
		id: n + 1,
		type: i.type,
		name: i.name,
		floorId: floorId.get(i.floor)!,
		roomId: roomId(i.floor, i.room),
		x: i.x,
		y: i.y,
		z: null,
		critical: !!i.critical,
		criticalNote: null,
		notes: null,
		breakerIds: i.breakers.map((s) => bySlot.get(s)!)
	}));
	return { settings: {} as House['settings'], panel: main, panels: [main, garage], breakers, floors, rooms, items } as unknown as House;
}

const house = exampleHouse();
const idOf = (label: string) => house.breakers.find((b) => b.label === label)!.id;
const auto = (rows: string[][]): Mapping => ({ header: looksLikeHeader(rows[0]), columns: looksLikeHeader(rows[0]) ? guessColumns(rows[0]) : rows[0].map(() => 'ignore') });

describe('parse', () => {
	test('reads quoted cells with commas, quotes and line breaks', () => {
		expect(parse('Name,Notes\r\n"Outlet, west","Says ""GFCI""\non it"\r\n')).toEqual([
			['Name', 'Notes'],
			['Outlet, west', 'Says "GFCI"\non it']
		]);
	});
	test('detects semicolons and tabs', () => {
		expect(parse('Name;Breaker\nOutlet, west;16\n')).toEqual([
			['Name', 'Breaker'],
			['Outlet, west', '16']
		]);
		expect(parse('Name\tBreaker\nRange\t1/3\n')).toEqual([
			['Name', 'Breaker'],
			['Range', '1/3']
		]);
	});
	test('a semicolon file whose cells hold commas stays semicolon', () => {
		expect(parse('Name;Notes\n"a";"x, y, z"\n"b";"1, 2"\n')[1]).toEqual(['a', 'x, y, z']);
	});
	test('drops a BOM, blank rows and empty trailing columns, and pads short rows', () => {
		expect(parse('﻿Name,Type,,\n\n,,,\nRange,appliance,,\nFan\n')).toEqual([
			['Name', 'Type'],
			['Range', 'appliance'],
			['Fan', '']
		]);
	});
	test('refuses binary files, files with no rows and files over 5,000 rows', () => {
		const problem = (text: string) => {
			try {
				parse(text);
			} catch (e) {
				return e instanceof CsvError ? [e.problem, e.rows] : e;
			}
		};
		expect(problem('%PDF-1.7\n\0\0\u0001stream')).toEqual(['unreadable', 0]);
		expect(problem('')).toEqual(['empty', 0]);
		expect(problem('Name,Type,Room\r\n')).toEqual(['empty', 0]);
		expect(problem('Name\n' + 'x\n'.repeat(5000))).toBeUndefined();
		expect(problem('Name\n' + 'x\n'.repeat(5001))).toEqual(['too-big', 5001]);
		expect(problem('x\n'.repeat(12480))).toEqual(['too-big', 12480]);
	});
});

describe('guessColumns', () => {
	test('matches names and synonyms', () => {
		expect(guessColumns(['Item', 'Kind', 'Level', 'Location', 'Circuit', 'Notes', 'Photo URL'])).toEqual([
			'name',
			'type',
			'floor',
			'room',
			'breakers',
			'notes',
			'ignore'
		]);
		expect(guessColumns(['description', 'category', 'story', 'area', 'slot', 'comments', 'critical', 'critical note'])).toEqual([
			'name',
			'type',
			'floor',
			'room',
			'breakers',
			'notes',
			'critical',
			'critical_note'
		]);
	});
	test('a whole-name match wins, and each target is used once', () => {
		expect(guessColumns(['Item type', 'Name', 'Item', 'Type'])).toEqual(['ignore', 'name', 'ignore', 'type']);
		expect(guessColumns(['Breaker label', 'Room name'])).toEqual(['breakers', 'room']);
	});
	test('a first row of data is not a header', () => {
		expect(looksLikeHeader(['Outlet by fridge', 'receptacle', 'Main', 'Kitchen', '12'])).toBe(false);
		expect(looksLikeHeader(['Item', 'Kind'])).toBe(true);
		expect(looksLikeHeader(['Item name', 'Breaker #'])).toBe(true);
		// One header word inside a cell is still data.
		expect(looksLikeHeader(['Living room lamp', 'light', 'Main', 'Living room', '7'])).toBe(false);
		expect(parse('Living room lamp,light,Main,Living room,7\n')).toEqual([['Living room lamp', 'light', 'Main', 'Living room', '7']]);
	});
});

describe('value guesses', () => {
	test('types: names exactly, synonyms as a guess, anything else not at all', () => {
		expect(guessType('Outlets')).toEqual({ type: 'outlet', match: 'exact' });
		expect(guessType('receptacle')).toEqual({ type: 'outlet', match: 'guess' });
		expect(guessType('Plug')).toEqual({ type: 'outlet', match: 'guess' });
		expect(guessType('GFCI')).toEqual({ type: 'outlet', match: 'guess' });
		expect(guessType('fixture')).toEqual({ type: 'light', match: 'guess' });
		expect(guessType('lamp')).toEqual({ type: 'light', match: 'guess' });
		expect(guessType('Ceiling light')).toEqual({ type: 'light', match: 'guess' });
		expect(guessType('smoke detector')).toEqual({ type: null, match: 'none' });
	});
	test('floors: same name, prefix, abbreviation', () => {
		const fs = house.floors;
		expect(guessFloor('main floor', fs)).toEqual({ id: 2, match: 'exact' });
		expect(guessFloor('Main', fs)).toEqual({ id: 2, match: 'guess' });
		expect(guessFloor('Bsmt', fs)).toEqual({ id: 1, match: 'guess' });
		expect(guessFloor('Upper', fs)).toEqual({ id: 3, match: 'guess' });
		expect(guessFloor('Attic', fs)).toEqual({ id: null, match: 'none' });
	});
});

describe('plan', () => {
	const rows = (csv: string) => parse(csv);
	const one = (csv: string, choices = {}) => {
		const r = rows(csv);
		return plan(house, r, auto(r), choices);
	};

	test('the mockup file: 59 items, 4 new rooms, 1 new floor, 2 without a breaker, 5 skipped', () => {
		const r = parse(readFileSync('src/lib/fixtures/house-inventory.csv', 'utf8'));
		const m = auto(r);
		expect(m.columns).toEqual(['name', 'type', 'floor', 'room', 'breakers', 'notes', 'ignore']);
		const p = plan(house, r, m);
		expect(r.length - 1).toBe(64);
		expect(p.counts).toEqual({ items: 59, rooms: 4, floors: 1, noBreaker: 2, skipped: 5 });
		expect(p.newFloors).toEqual(['Attic']);
		expect(p.newRooms.map((x) => x.name)).toEqual(['Pantry', 'Mudroom', 'Attic', 'Porch']);
		expect(p.missing).toEqual({ rows: 2, values: ['Kitchen 2', '32'] });
		expect(p.dupes).toEqual({ rows: 3, names: ['Dryer', 'Refrigerator', 'Sump pump'] });
		expect(p.types.map((t) => [t.value, t.rows, t.choice, t.match])).toEqual([
			['outlet', 28, 'outlet', 'exact'],
			['light', 17, 'light', 'exact'],
			['switch', 9, 'switch', 'exact'],
			['receptacle', 4, 'outlet', 'guess'],
			['appliance', 4, 'appliance', 'exact'],
			['smoke detector', 2, 'skip', 'none']
		]);
		expect(p.floors.map((f) => [f.value, f.rows, f.choice])).toEqual([
			['Bsmt', 14, 1],
			['Main', 31, 2],
			['Upper', 16, 3],
			['Attic', 3, 'new']
		]);
		// Changing the choices: smoke detectors become lights, duplicates come in, Attic gets no floor.
		const q = plan(house, r, m, { types: { 'smoke detector': 'light' }, duplicates: 'add', floors: { attic: 'none' } });
		expect(q.counts).toEqual({ items: 64, rooms: 4, floors: 0, noBreaker: 2, skipped: 0 });
		expect(q.newRooms.map((x) => x.name)).toEqual(['Pantry', 'Mudroom', 'Hall', 'Porch']);
		const fan = q.rows.find((x) => x.name === 'Attic fan')!;
		expect([fan.floor, fan.room, fan.floorDropped, fan.floorRef]).toEqual([null, null, true, null]);
	});

	test('breakers: subpanel, tandem, quad-style and 2-pole numbers, labels and + lists', () => {
		const p = one('Name,Breaker\nA,G6\nB,31A\nC,31b\nD,1/3\nE,3\nF,G1/3\nG,14 + 21\nH,Furnace\nI,furnace + G6\nJ,31\nK,14 + 99\nL,\n');
		const ids = Object.fromEntries(p.rows.map((x) => [x.name, [x.breakerIds, x.breakerMissing]]));
		expect(ids).toEqual({
			A: [[idOf('Workbench')], false],
			B: [[idOf('Porch')], false],
			C: [[idOf('Closet')], false],
			D: [[idOf('Range')], false],
			E: [[idOf('Range')], false],
			F: [[idOf('Welder')], false],
			G: [[idOf('Kitchen & dining lights'), idOf('Hall & stairs lights')], false],
			H: [[idOf('Furnace')], false],
			I: [[idOf('Furnace'), idOf('Workbench')], false],
			// A tandem slot holds two breakers, so its bare number finds neither.
			J: [[], true],
			K: [[idOf('Kitchen & dining lights')], true],
			L: [[], false]
		});
		expect(p.missing).toEqual({ rows: 1, values: ['31'] });
		expect(p.counts.noBreaker).toBe(2);
	});

	test('duplicates: same name and room on the same floor, any case', () => {
		const csv = 'Name,Floor,Room\ndryer,Main floor,laundry\nDryer,Main floor,Garage\nDryer,Upstairs,Laundry\nSUMP PUMP,Basement,Utility\n';
		const p = one(csv);
		expect(p.rows.map((x) => x.duplicate)).toEqual([true, false, false, true]);
		expect(p.counts).toMatchObject({ items: 2, skipped: 2 });
		expect(one(csv, { duplicates: 'add' }).counts).toMatchObject({ items: 4, skipped: 0 });
	});

	test('no type column: every row gets the one type picked', () => {
		const p = one('Name,Room\nA,Kitchen\nB,Office\n', { allType: 'light' });
		expect(p.noType).toBe(true);
		expect(p.types).toEqual([]);
		expect(p.rows.map((x) => x.type)).toEqual(['light', 'light']);
		// Without a floor column, a room is found when only one floor has it.
		expect(p.rows.map((x) => [x.floor, x.room, x.roomNew])).toEqual([
			['Main floor', 'Kitchen', false],
			['Upstairs', 'Office', false]
		]);
		// The same for a blank floor cell.
		expect(one('Name,Floor,Room\nA,,Kitchen\n').rows[0].room).toBe('Kitchen');
	});

	test('no header row: row 1 is imported too', () => {
		const r = rows('Outlet by fridge,receptacle,Main\nPantry light,light,Main\n');
		const m = auto(r);
		expect(m).toEqual({ header: false, columns: ['ignore', 'ignore', 'ignore'] });
		const p = plan(house, r, { header: false, columns: ['name', 'type', 'floor'] });
		expect(p.rows.map((x) => [x.line, x.name, x.type, x.floor])).toEqual([
			[1, 'Outlet by fridge', 'outlet', 'Main floor'],
			[2, 'Pantry light', 'light', 'Main floor']
		]);
	});

	test('names are trimmed to one line, nameless rows are skipped, critical takes yes/y/true/1/x', () => {
		const p = one('Name,Type,Critical,Critical note\n"  Chest\n freezer ",appliance,X,Garage\n,outlet,,\nFan,appliance,no,why\n');
		expect(p.rows.map((x) => [x.name, x.skip, x.critical, x.criticalNote])).toEqual([
			['Chest freezer', null, true, 'Garage'],
			['', 'name', false, null],
			['Fan', null, false, null]
		]);
	});

	test('toImport: new floors and rooms are referenced by index, existing ones by id', () => {
		const p = one('Name,Floor,Room,Breaker\nA,Attic,Loft,16\nB,Main,Kitchen,\nC,Attic,Loft,\n');
		const input = toImport(p);
		expect(input.floors).toEqual(['Attic']);
		expect(input.rooms).toEqual([{ name: 'Loft', floor: { new: 0 } }]);
		expect(input.items.map((i) => [i.name, i.floor, i.room, i.breakerIds])).toEqual([
			['A', { new: 0 }, { new: 0 }, [idOf('Bathrooms')]],
			['B', { id: 2 }, { id: house.rooms.find((r) => r.name === 'Kitchen')!.id }, []],
			['C', { new: 0 }, { new: 0 }, []]
		]);
	});
});
