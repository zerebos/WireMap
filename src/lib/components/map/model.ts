// Shared logic for the Map screen (docs/design/DESIGN.md §5.2).
import { compareBreakers } from '$lib/panel';
import type { Breaker, Floor, Room } from '$lib/db/schema';
import type { HouseIndex, HouseItem } from '$lib/house';
import { mutate, plural } from '$lib/house';
import { setFloorPlan } from '$lib/db/ops';
import { PROTECTION_LABELS } from '$lib/constants';
import { parseShape, type Shape } from '$lib/shape';

/** One selection at a time; priority item > circuit > room. */
export type Sel = { kind: 'none' } | { kind: 'circuit' | 'item' | 'room'; id: number };
export const NONE: Sel = { kind: 'none' };

/** "20A · GFCI", or "50A · 2-pole". */
export const specOf = (b: Breaker) => `${b.amps}A · ${b.poles === 2 ? '2-pole' : PROTECTION_LABELS[b.kind]}`;

/** Where a floor's plan image sits, in map units, before its rotation about its centre. */
export function planBox(f: Floor) {
	return { x: f.planOffsetX, y: f.planOffsetY, w: f.planWidth * f.planScale, h: f.planHeight * f.planScale, rot: f.planRotation };
}

/** A room's shape, or null when it isn't drawn. */
export const shapeOfRoom = (r: Room): Shape | null => parseShape(r.shape);

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
		.sort(compareBreakers);
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

// ---- Floor plan upload (the plan popover and the empty-floor card share it)

/** Plan files we accept. A PDF is turned into a PNG of its first page. */
export const PLAN_ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];

const isPdf = (file: File) => file.type === 'application/pdf' || (!file.type && /\.pdf$/i.test(file.name));

/** The longest edge, in px, a PDF page is drawn at: about 2× the map's own size. */
const PDF_EDGE = 4000;

/** Draws page 1 of a PDF as a PNG. pdf.js loads only now, the first time a PDF is dropped. */
async function pdfToPng(file: File): Promise<File> {
	const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
	pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
	const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
	const doc = await task.promise;
	try {
		const page = await doc.getPage(1);
		const base = page.getViewport({ scale: 1 });
		const viewport = page.getViewport({ scale: PDF_EDGE / Math.max(base.width, base.height) });
		const canvas = document.createElement('canvas');
		canvas.width = Math.round(viewport.width);
		canvas.height = Math.round(viewport.height);
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('No canvas');
		await page.render({ canvasContext: ctx, viewport, background: 'white' }).promise;
		const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/png'));
		if (!blob) throw new Error('No image');
		return new File([blob], file.name.replace(/\.pdf$/i, '') + '.png', { type: 'image/png' });
	} finally {
		void task.destroy();
	}
}

/** Saves an image (or a PDF's first page) as the floor's plan. Resolves to an error message, or '' when it worked. */
export async function uploadPlan(floorId: number, file: File, keepOld = false): Promise<string> {
	const pdf = isPdf(file);
	if (!pdf && !PLAN_ACCEPT.includes(file.type)) return "That file isn't a PNG, JPG, WebP or PDF.";
	try {
		const img = pdf ? await pdfToPng(file) : file;
		const bmp = await createImageBitmap(img);
		const size = { width: bmp.width, height: bmp.height };
		bmp.close();
		await mutate(() => setFloorPlan(floorId, img, size, keepOld));
		return '';
	} catch {
		return pdf ? "Couldn't read that PDF." : "Couldn't read that image.";
	}
}

/** "Map the main floor": the floor's name as it reads mid-sentence. */
export const midSentence = (name: string) => (/^[A-Z][a-z]/.test(name) ? name[0].toLowerCase() + name.slice(1) : name);

/** Getting-started progress for a floor (DESIGN.md §5.9): rooms, placed items, items with a breaker. */
export function floorSteps(ix: HouseIndex, floorId: number | null) {
	const rooms = ix.house.rooms.some((r) => r.floorId === floorId);
	const placed = ix.house.items.filter((i) => i.floorId === floorId && i.x !== null && i.y !== null);
	return { rooms, placed: placed.length > 0, wired: placed.length > 0 && placed.every((i) => i.breakerIds.length > 0) };
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
