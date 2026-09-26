// Items as CSV, for spreadsheets. One row per item; an item on several breakers lists them all.
import { index, type House } from './house';
import { ITEM_TYPES, type ItemType } from './constants';
import { createItem, createRoom } from './db/ops';
import type { Breaker } from './db/schema';

const cell = (v: string | number | null | undefined) => {
	const s = v === null || v === undefined ? '' : String(v);
	return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export function itemsCsv(house: House): string {
	const ix = index(house);
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

/** Parses CSV text (RFC 4180: quoted fields may hold commas, quotes as "" and line breaks). */
export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;
	let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
	for (; i < text.length; i++) {
		const c = text[i];
		if (quoted) {
			if (c === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else quoted = false;
			} else field += c;
		} else if (c === '"') quoted = true;
		else if (c === ',') {
			row.push(field);
			field = '';
		} else if (c === '\n' || c === '\r') {
			if (c === '\r' && text[i + 1] === '\n') i++;
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else field += c;
	}
	if (field !== '' || row.length) {
		row.push(field);
		rows.push(row);
	}
	return rows;
}

export type ImportResult = { imported: number; skipped: number };

/**
 * Adds items from CSV with the columns name, type, floor, room, breaker, and optionally critical,
 * critical note and notes (any order, any case; other columns are ignored). Rows with an unknown type are skipped. Floors are matched by name
 * or left empty; rooms are matched on that floor or created; breakers are slot numbers
 * ("16", "14 + 21", "1/3") or labels on the main panel, else none. Throws when the header is wrong.
 */
export async function importItemsCsv(house: House, text: string): Promise<ImportResult> {
	const ix = index(house);
	const [head, ...body] = parseCsv(text);
	const cols = (head ?? []).map((h) => h.trim().toLowerCase());
	const col = (...names: string[]) => cols.findIndex((c) => names.includes(c));
	const at = { name: col('name'), type: col('type'), floor: col('floor'), room: col('room'), breaker: col('breaker', 'breakers'),
		critical: col('critical'),
		criticalNote: col('critical note'),
		notes: col('notes')
	};
	if (at.name < 0 || at.type < 0) throw new Error('The first row must name the columns: name, type, floor, room, breaker.');

	const norm = (s: string) => s.trim().toLowerCase();
	const panel = house.panel;
	const onPanel = panel ? house.breakers.filter((b) => b.panelId === panel.id) : [];
	function breakersFor(v: string): number[] {
		if (!v.trim()) return [];
		const byLabel = (s: string) => onPanel.find((b) => b.label && norm(b.label) === norm(s));
		const bySlot = (s: string) => {
			const t = s.trim();
			if (!/^\d+[AB]?(\s*\/\s*\d+[AB]?)?$/i.test(t)) return undefined;
			const n = parseInt(t.split('/')[0], 10);
			return (
				onPanel.find((b) => ix.slotOf(b).replace(/\s/g, '') === t.replace(/\s/g, '').toUpperCase()) ??
				onPanel.find((b) => !b.half && (b.slot === n || (b.poles === 2 && b.slot + 2 === n)))
			);
		};
		const whole = bySlot(v) ?? byLabel(v);
		if (whole) return [whole.id];
		const found = new Set<number>();
		for (const part of v.split('+')) {
			const b: Breaker | undefined = bySlot(part) ?? byLabel(part);
			if (b) found.add(b.id);
		}
		return [...found];
	}

	// Rooms created during this import, so later rows reuse them.
	const rooms = house.rooms.map((r) => ({ id: r.id, floorId: r.floorId, name: r.name }));
	let imported = 0;
	let skipped = 0;
	for (const r of body) {
		const get = (n: number) => (n >= 0 ? (r[n] ?? '').trim() : '');
		if (r.every((c) => !c.trim())) continue;
		const type = norm(get(at.type)) as ItemType;
		if (!ITEM_TYPES.includes(type)) {
			skipped++;
			continue;
		}
		const floorName = norm(get(at.floor));
		const floor = floorName ? house.floors.find((f) => norm(f.name) === floorName) : undefined;
		const floorId = floor?.id ?? null;
		let roomId: number | null = null;
		const roomName = get(at.room);
		if (floorId !== null && roomName) {
			let room = rooms.find((x) => x.floorId === floorId && norm(x.name) === norm(roomName));
			if (!room) {
				room = { id: await createRoom({ floorId, name: roomName, kind: 'interior', shape: null }), floorId, name: roomName };
				rooms.push(room);
			}
			roomId = room.id;
		}
		// A name is one line, even when the cell held line breaks.
		const critical = ['yes', 'y', 'true', '1', 'x'].includes(norm(get(at.critical)));
		await createItem(
			{
				name: get(at.name).replace(/\s+/g, ' '),
				type,
				floorId,
				roomId,
				critical,
				criticalNote: critical ? get(at.criticalNote) || null : null,
				notes: get(at.notes)
			},
			breakersFor(get(at.breaker))
		);
		imported++;
	}
	return { imported, skipped };
}
