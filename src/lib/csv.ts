// Items as CSV, for spreadsheets. One row per item; an item on several breakers lists them all.
import { index, type House } from './house';

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
