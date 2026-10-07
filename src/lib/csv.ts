// Items as CSV, for spreadsheets: the export, and the import with column mapping (DESIGN.md §5.20).
// The import is three pure steps: `parse` the text into rows, `guessColumns` from the header, and
// `plan` what the rows would add to the house. `toImport` hands a plan to `importItems` in ops.ts.
import type { House, HouseIndex } from './house';
import type { ImportInput, ImportRef } from './db/ops';
import { ITEM_TYPES, ITEM_TYPE_LABELS, type ItemType } from './constants';
import { slotLabel, spaceLabel, spacesOf } from './panel';

const cell = (v: string | number | null | undefined) => {
	const s = v === null || v === undefined ? '' : String(v);
	return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export function itemsCsv(house: House, ix: HouseIndex): string {
	const head = ['Name', 'Type', 'Floor', 'Room', 'Breakers', 'Breaker labels', 'Critical', 'Critical note', 'Notes'];
	const rows = house.items.map((i) => {
		const bs = ix.breakersOf(i);
		return [
			i.name,
			ix.typeLabel(i),
			ix.floorName(i.floorId),
			i.roomId === null ? '' : ix.roomName(i.roomId),
			bs.map(ix.slotOf).join(' + '),
			bs.map(ix.labelOf).join(' + '),
			i.critical ? 'Yes' : '',
			i.criticalNote,
			i.notes
		];
	});
	return [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

// ---- 1. Parse

/** One import takes at most this many rows. */
export const MAX_ROWS = 5000;

export type CsvProblem = 'unreadable' | 'empty' | 'too-big';

/** A file that can't be imported. `rows` is the row count for 'too-big'. */
export class CsvError extends Error {
	name = 'CsvError';
	constructor(
		readonly problem: CsvProblem,
		readonly rows = 0
	) {
		super(problem);
	}
}

const DELIMITERS = [',', ';', '\t'] as const;

/** Splits CSV text into records (RFC 4180: quoted fields may hold delimiters, "" for a quote, and line breaks). */
function records(text: string, delim: string, limit = Infinity): string[][] {
	const out: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;
	for (let i = 0; i < text.length && out.length < limit; i++) {
		const c = text[i];
		if (quoted) {
			if (c !== '"') field += c;
			else if (text[i + 1] === '"') {
				field += '"';
				i++;
			} else quoted = false;
		} else if (c === '"' && field === '') quoted = true;
		else if (c === delim) {
			row.push(field);
			field = '';
		} else if (c === '\n' || c === '\r') {
			if (c === '\r' && text[i + 1] === '\n') i++;
			row.push(field);
			out.push(row);
			row = [];
			field = '';
		} else field += c;
	}
	if (out.length < limit && (field !== '' || row.length)) {
		row.push(field);
		out.push(row);
	}
	return out;
}

const blank = (r: string[]) => r.every((c) => !c.trim());

/** Comma, semicolon or tab: whichever splits the first lines into the most columns, consistently. */
export function detectDelimiter(text: string): string {
	let best: string = ',';
	let bestN = 0;
	for (const d of DELIMITERS) {
		const sample = records(text, d, 20).filter((r) => !blank(r));
		if (!sample.length) continue;
		const n = Math.min(...sample.map((r) => r.length - 1));
		if (n > bestN) [best, bestN] = [d, n];
	}
	return best;
}

/**
 * Reads CSV text into rows of cells: the delimiter is detected, a BOM is dropped, blank rows are
 * ignored, every row gets the same number of columns, and columns empty in every row are dropped
 * from the end. Throws a CsvError for binary files, files with no rows, and more than MAX_ROWS.
 */
export function parse(text: string): string[][] {
	if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
	// Binary files (a PDF, a spreadsheet's own format) decode to NULs and replacement characters.
	const bad = (text.match(/�/g) ?? []).length;
	if (text.includes('\0') || bad > Math.max(3, text.length / 200)) throw new CsvError('unreadable');
	const rows = records(text, detectDelimiter(text)).filter((r) => !blank(r));
	let width = Math.max(0, ...rows.map((r) => r.length));
	while (width > 0 && rows.every((r) => !(r[width - 1] ?? '').trim())) width--;
	const out = rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ''));
	const data = out.length - (out.length && looksLikeHeader(out[0]) ? 1 : 0);
	if (data === 0) throw new CsvError('empty');
	if (data > MAX_ROWS) throw new CsvError('too-big', data);
	return out;
}

// ---- 2. Match columns

export type Target = 'ignore' | 'name' | 'type' | 'floor' | 'room' | 'breakers' | 'critical' | 'critical_note' | 'notes';

/** The "Use as" choices, in the order the select lists them. */
export const TARGETS: { value: Target; label: string }[] = [
	{ value: 'ignore', label: 'Don’t import' },
	{ value: 'name', label: 'Name' },
	{ value: 'type', label: 'Type' },
	{ value: 'floor', label: 'Floor' },
	{ value: 'room', label: 'Room' },
	{ value: 'breakers', label: 'Breaker(s)' },
	{ value: 'critical', label: 'Critical (yes/no)' },
	{ value: 'critical_note', label: 'Critical note' },
	{ value: 'notes', label: 'Notes' }
];

/** Header words for each target, most specific first ("Item type" is a type, "Breaker label" a breaker). */
const COLUMN_WORDS: [Exclude<Target, 'ignore'>, string[]][] = [
	['critical_note', []],
	['critical', ['critical']],
	['breakers', ['breaker', 'breakers', 'circuit', 'circuits', 'slot', 'slots']],
	['type', ['type', 'kind', 'category']],
	['floor', ['floor', 'level', 'story', 'storey']],
	['room', ['room', 'location', 'area']],
	['notes', ['notes', 'note', 'comments', 'comment']],
	['name', ['name', 'item', 'description']]
];

const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

function columnTarget(header: string, exact: boolean): Target {
	const w = words(header);
	if (w.includes('critical') && (w.includes('note') || w.includes('notes'))) return exact && w.length !== 2 ? 'ignore' : 'critical_note';
	for (const [target, list] of COLUMN_WORDS) {
		if (exact ? w.length === 1 && list.includes(w[0]) : w.some((x) => list.includes(x))) return target;
	}
	return 'ignore';
}

/**
 * What each column holds, from its name. Whole-name matches ("Floor") win over a word in a longer
 * name ("Floor level"), and each target goes to one column only: the first that matches.
 */
export function guessColumns(header: string[]): Target[] {
	const out: Target[] = header.map(() => 'ignore');
	const used = new Set<Target>();
	for (const exact of [true, false]) {
		header.forEach((h, i) => {
			if (out[i] !== 'ignore') return;
			const t = columnTarget(h, exact);
			if (t !== 'ignore' && !used.has(t)) {
				out[i] = t;
				used.add(t);
			}
		});
	}
	return out;
}

/** Row 1 is column names when any of them names something Breakerbook imports. */
export const looksLikeHeader = (row: string[]) => guessColumns(row).some((t) => t !== 'ignore');

// ---- 3. Plan

export type Mapping = { header: boolean; columns: Target[] };
export type TypeChoice = ItemType | 'skip';
/** An existing floor's id, a new floor named after the value, or no floor. */
export type FloorChoice = number | 'new' | 'none';
/** What the person picked on step 2. Values they didn't touch use the guesses. Keys are `valueKey(value)`. */
export type Choices = {
	types?: Record<string, TypeChoice>;
	/** The type for every row when no column holds types. */
	allType?: ItemType;
	floors?: Record<string, FloorChoice>;
	duplicates?: 'skip' | 'add';
};
/** How a value was matched: exactly, by a synonym or likeness (worth a check), or not at all. */
export type Match = 'exact' | 'guess' | 'none';
export type ValueGroup<C> = { key: string; value: string; rows: number; match: Match; choice: C };

export type PlanRow = {
	/** Row number in the file, counting the header. */
	line: number;
	name: string;
	/** The value in the type column. */
	typeValue: string;
	type: ItemType | null;
	/** The floor's name ("Attic" for a new one), or null for no floor. */
	floor: string | null;
	/** The file named a floor and the person chose No floor. */
	floorDropped: boolean;
	room: string | null;
	roomNew: boolean;
	/** The breaker cell as written. */
	breakers: string;
	breakerIds: number[];
	/** Part of the breaker cell matches no breaker. */
	breakerMissing: boolean;
	critical: boolean;
	criticalNote: string | null;
	notes: string | null;
	/** Same name and room as an item already in the house. */
	duplicate: boolean;
	skip: 'name' | 'type' | 'duplicate' | null;
	/** Set on rows that will be imported. */
	floorRef: ImportRef | null;
	roomRef: ImportRef | null;
};

export type Plan = {
	rows: PlanRow[];
	noType: boolean;
	noFloor: boolean;
	allType: ItemType;
	types: ValueGroup<TypeChoice>[];
	floors: ValueGroup<FloorChoice>[];
	duplicates: 'skip' | 'add';
	/** Floors and rooms the imported rows need that don't exist yet; ImportRef `new` indexes these. */
	newFloors: string[];
	newRooms: { name: string; floor: ImportRef }[];
	/** Imported rows whose breaker cell names a breaker that can't be found. */
	missing: { rows: number; values: string[] };
	/** Rows that look like items already in the house (counted whether or not they're skipped). */
	dupes: { rows: number; names: string[] };
	counts: { items: number; rooms: number; floors: number; noBreaker: number; skipped: number };
};

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
/** The key a type or floor value is grouped and chosen by: case and spacing don't matter. */
export const valueKey = norm;

/** Type values: the type's own names, then synonyms. Phrases are checked whole before single words. */
const TYPE_SYNONYMS: Record<ItemType, string[]> = {
	outlet: ['receptacle', 'receptacles', 'plug', 'plugs', 'gfci', 'gfi', 'socket', 'sockets', 'duplex'],
	light: ['fixture', 'fixtures', 'lamp', 'lamps', 'lighting', 'luminaire'],
	switch: ['light switch', 'dimmer', 'dimmers'],
	appliance: ['appliances']
};

export function guessType(value: string): { type: ItemType | null; match: Match } {
	const v = norm(value);
	for (const t of ITEM_TYPES) {
		const l = ITEM_TYPE_LABELS[t];
		if (v === t || v === l.one.toLowerCase() || v === l.many.toLowerCase()) return { type: t, match: 'exact' };
	}
	for (const t of ITEM_TYPES) if (TYPE_SYNONYMS[t].includes(v)) return { type: t, match: 'guess' };
	// One word that names exactly one type: "GFCI outlet", "Ceiling light".
	const hits = new Set<ItemType>();
	for (const w of words(v)) {
		for (const t of ITEM_TYPES) {
			const l = ITEM_TYPE_LABELS[t];
			if ([t, l.many.toLowerCase(), ...TYPE_SYNONYMS[t]].includes(w)) hits.add(t);
		}
	}
	return hits.size === 1 ? { type: [...hits][0], match: 'guess' } : { type: null, match: 'none' };
}

/** "Bsmt" → "Basement": every letter, in order, starting with the same one. */
const abbreviates = (short: string, long: string) => {
	if (!short || short[0] !== long[0]) return false;
	let i = 0;
	for (const c of long) if (c === short[i]) i++;
	return i === short.length;
};
const commonPrefix = (a: string, b: string) => {
	let i = 0;
	while (i < a.length && a[i] === b[i]) i++;
	return i;
};

/**
 * The house floor a value means: the same name (any case), then a name that starts with it or that
 * it starts with ("Main" → "Main floor"), then an abbreviation ("Bsmt" → "Basement"), then the only
 * floor sharing its first letters ("Upper" → "Upstairs"). Each step must point at one floor.
 */
export function guessFloor<F extends { id: number; name: string }>(value: string, floors: F[]): { id: number | null; match: Match } {
	const v = norm(value);
	const named = floors.map((f) => ({ id: f.id, n: norm(f.name) }));
	const one = (hits: typeof named) => (hits.length === 1 ? hits[0].id : null);
	const exact = one(named.filter((f) => f.n === v));
	if (exact !== null) return { id: exact, match: 'exact' };
	const tests: ((n: string) => boolean)[] = [
		(n) => n.startsWith(v) || v.startsWith(n),
		(n) => abbreviates(v.replace(/[^\p{L}\p{N}]/gu, ''), n.replace(/[^\p{L}\p{N}]/gu, '')),
		(n) => commonPrefix(n, v) >= 2
	];
	for (const test of tests) {
		const id = one(named.filter((f) => test(f.n)));
		if (id !== null) return { id, match: 'guess' };
	}
	return { id: null, match: 'none' };
}

/**
 * Finds breakers by what a person writes: display numbers on any panel ("16", "1/3", "17A",
 * "21A/23B", "G6"), one space of a breaker ("3" for 1/3), or a breaker's label. Several joined
 * with "+" give several breakers. Numbers come from slotLabel/spaceLabel, so they match the screen.
 */
export function breakerFinder(house: Pick<House, 'panels' | 'breakers'>) {
	const panels = new Map(house.panels.map((p) => [p.id, p]));
	const byNumber = new Map<string, number | null>();
	const byLabel = new Map<string, number | null>();
	// A key two breakers share (null) finds neither.
	const add = (m: Map<string, number | null>, key: string, id: number) => {
		if (!key) return;
		m.set(key, m.has(key) && m.get(key) !== id ? null : id);
	};
	const numKey = (s: string) => s.toUpperCase().replace(/\s+/g, '').replace(/^#/, '');
	for (const b of house.breakers) {
		const p = panels.get(b.panelId);
		if (!p) continue;
		add(byNumber, numKey(slotLabel(b, p)), b.id);
		for (const s of spacesOf(b, p)) add(byNumber, numKey(spaceLabel(s, p)), b.id);
		if (b.label) add(byLabel, norm(b.label), b.id);
	}
	const one = (s: string) => byNumber.get(numKey(s)) ?? byLabel.get(norm(s)) ?? null;
	return (value: string): { ids: number[]; missing: boolean } => {
		if (!value.trim()) return { ids: [], missing: false };
		const whole = one(value);
		if (whole !== null) return { ids: [whole], missing: false };
		const parts = value.split('+').map((s) => s.trim()).filter(Boolean);
		const ids = parts.map(one);
		return { ids: [...new Set(ids.filter((id): id is number => id !== null))], missing: ids.includes(null) };
	};
}

const YES = ['yes', 'y', 'true', '1', 'x'];
/** A name is one line, even when the cell held line breaks. */
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * What importing `rows` with this mapping and these choices would do, row by row, with the totals
 * for step 3. Nothing is written.
 */
export function plan(house: House, rows: string[][], mapping: Mapping, choices: Choices = {}): Plan {
	const col = (t: Target) => mapping.columns.indexOf(t);
	const at = {
		name: col('name'),
		type: col('type'),
		floor: col('floor'),
		room: col('room'),
		breakers: col('breakers'),
		critical: col('critical'),
		criticalNote: col('critical_note'),
		notes: col('notes')
	};
	const body = mapping.header ? rows.slice(1) : rows;
	const first = mapping.header ? 2 : 1;
	const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');

	// Distinct type and floor values, in the order they first appear, with their guesses.
	const group = <C>(i: number, guess: (v: string) => { choice: C; match: Match }, picked: Record<string, C> = {}) => {
		const out = new Map<string, ValueGroup<C>>();
		if (i < 0) return out;
		for (const r of body) {
			const v = get(r, i);
			const key = norm(v);
			if (!key && i === at.floor) continue;
			const g = out.get(key);
			if (g) g.rows++;
			else {
				const { choice, match } = guess(v);
				out.set(key, { key, value: v, rows: 1, match, choice: key in picked ? picked[key] : choice });
			}
		}
		return out;
	};
	const types = group<TypeChoice>(
		at.type,
		(v) => {
			const g = guessType(v);
			return { choice: g.type ?? 'skip', match: g.match };
		},
		choices.types
	);
	const floors = group<FloorChoice>(
		at.floor,
		(v) => {
			const g = guessFloor(v, house.floors);
			return { choice: g.id ?? 'new', match: g.match };
		},
		choices.floors
	);
	const allType = choices.allType ?? 'outlet';
	const duplicates = choices.duplicates ?? 'skip';

	const floorById = new Map(house.floors.map((f) => [f.id, f]));
	const level = (c: FloorChoice) => (typeof c === 'number' ? house.floors.findIndex((f) => f.id === c) : c === 'new' ? 1e6 : 2e6);
	const roomsOn = (floorId: number) => house.rooms.filter((r) => r.floorId === floorId);
	const find = breakerFinder(house);
	// Items already in the house, by name + floor + room, for spotting duplicates.
	const have = new Set(house.items.map((i) => `${norm(i.name)}|${i.floorId}|${i.roomId}`));
	// Without a floor column, a room is found by its name when only one floor has it.
	const uniqueRoom = (name: string) => {
		const hits = house.rooms.filter((r) => r.floorId !== null && norm(r.name) === norm(name));
		return hits.length === 1 ? hits[0] : null;
	};

	const newFloors: string[] = [];
	const newFloorIx = new Map<string, number>();
	const newRooms: { name: string; floor: ImportRef }[] = [];
	const newRoomIx = new Map<string, number>();
	const missingValues: string[] = [];
	const dupeNames: string[] = [];
	let missingRows = 0;
	let dupeRows = 0;

	const out = body.map((r, n): PlanRow => {
		const name = oneLine(get(r, at.name));
		const typeValue = get(r, at.type);
		const type = at.type < 0 ? allType : types.get(norm(typeValue))!.choice;
		const floorValue = get(r, at.floor);
		const fc: FloorChoice | null = at.floor >= 0 && floorValue ? floors.get(norm(floorValue))!.choice : null;
		const roomValue = oneLine(get(r, at.room));

		// Floor and room, as names for the preview and as an existing id or a new key.
		let floor: string | null = null;
		let floorId: number | null = null;
		let room: string | null = null;
		let roomId: number | null = null;
		if (typeof fc === 'number' && floorById.has(fc)) {
			floor = floorById.get(fc)!.name;
			floorId = fc;
		} else if (fc === 'new') floor = floors.get(norm(floorValue))!.value;
		else if (at.floor < 0 && roomValue) {
			const found = uniqueRoom(roomValue);
			if (found) [floorId, floor] = [found.floorId, floorById.get(found.floorId!)?.name ?? null];
		}
		if (floor !== null && roomValue) {
			const existing = floorId === null ? undefined : roomsOn(floorId).find((x) => norm(x.name) === norm(roomValue));
			room = existing?.name ?? roomValue;
			roomId = existing?.id ?? null;
		}
		const roomNew = room !== null && roomId === null;

		const brk = get(r, at.breakers);
		const { ids, missing } = find(brk);
		const floorNew = floor !== null && floorId === null;
		const duplicate = !!name && !floorNew && !roomNew && have.has(`${norm(name)}|${floorId}|${roomId}`);
		const critical = YES.includes(norm(get(r, at.critical)));
		const skip = !name ? 'name' : type === 'skip' ? 'type' : duplicate && duplicates === 'skip' ? 'duplicate' : null;
		if (duplicate && (!skip || skip === 'duplicate')) {
			dupeRows++;
			if (!dupeNames.includes(name)) dupeNames.push(name);
		}

		// Refs only for rows that will be imported, so unused new floors and rooms aren't created.
		let floorRef: ImportRef | null = null;
		let roomRef: ImportRef | null = null;
		if (!skip) {
			if (missing) {
				missingRows++;
				if (!missingValues.includes(brk)) missingValues.push(brk);
			}
			if (floorId !== null) floorRef = { id: floorId };
			else if (floor !== null) {
				const k = norm(floor);
				if (!newFloorIx.has(k)) newFloorIx.set(k, newFloors.push(floor) - 1);
				floorRef = { new: newFloorIx.get(k)! };
			}
			if (roomId !== null) roomRef = { id: roomId };
			else if (room !== null && floorRef) {
				const k = `${'id' in floorRef ? `f${floorRef.id}` : `n${floorRef.new}`}|${norm(room)}`;
				if (!newRoomIx.has(k)) newRoomIx.set(k, newRooms.push({ name: room, floor: floorRef }) - 1);
				roomRef = { new: newRoomIx.get(k)! };
			}
		}

		return {
			line: first + n,
			name,
			typeValue,
			type: type === 'skip' ? null : type,
			floor,
			floorDropped: fc === 'none',
			room,
			roomNew,
			breakers: brk,
			breakerIds: ids,
			breakerMissing: missing,
			critical,
			criticalNote: critical ? get(r, at.criticalNote) || null : null,
			notes: get(r, at.notes) || null,
			duplicate,
			skip,
			floorRef,
			roomRef
		};
	});

	const imported = out.filter((r) => !r.skip);
	return {
		rows: out,
		noType: at.type < 0,
		noFloor: at.floor < 0,
		allType,
		// Most rows first; floors bottom to top, with new floors and No floor last.
		types: [...types.values()].sort((a, b) => b.rows - a.rows),
		floors: [...floors.values()].sort((a, b) => level(a.choice) - level(b.choice)),
		duplicates,
		newFloors,
		newRooms,
		missing: { rows: missingRows, values: missingValues },
		dupes: { rows: dupeRows, names: dupeNames },
		counts: {
			items: imported.length,
			rooms: newRooms.length,
			floors: newFloors.length,
			noBreaker: imported.filter((r) => !r.breakerIds.length).length,
			skipped: out.length - imported.length
		}
	};
}

/** The rows a plan imports, as the write layer takes them. */
export function toImport(p: Plan): ImportInput {
	return {
		floors: p.newFloors,
		rooms: p.newRooms,
		items: p.rows
			.filter((r) => !r.skip)
			.map((r) => ({
				name: r.name,
				type: r.type!,
				floor: r.floorRef,
				room: r.roomRef,
				critical: r.critical,
				criticalNote: r.criticalNote,
				notes: r.notes,
				breakerIds: r.breakerIds
			}))
	};
}
