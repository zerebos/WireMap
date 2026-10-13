// Keyboard editing on the map (docs/design/DESIGN.md §5.21): snapping, the drawing cursor's moves,
// and the units the cursor chip, status line and inspector number fields count in.
import { feet, type Point } from '$lib/shape';

/** Map units per grid step: 6″ at the default scale of 20 units per foot. */
export const GRID = 10;
/** How close (map units) a point has to be to another room's edge to snap to it. */
export const SNAP = 8;
/** The smallest a room can be, in map units. */
export const MIN = 60;

export const toGrid = (v: number) => Math.round(v / GRID) * GRID;

/** Snaps to the nearest candidate edge within SNAP units (returned as a guide), else to the grid. */
export function snapVal(v: number, cands: number[], free: boolean): { v: number; g: number | null } {
	if (free) return { v, g: null };
	let best: number | null = null;
	let bestD = SNAP;
	for (const c of cands) {
		const d = Math.abs(c - v);
		if (d <= bestD) {
			best = c;
			bestD = d;
		}
	}
	return best !== null ? { v: best, g: best } : { v: toGrid(v), g: null };
}

/**
 * Where a key moves the drawing cursor, or null when the key doesn't move it. Arrows move one grid
 * step and snap like the pointer; Shift+arrows move one unit, free. Page Up/Down jump 10 steps
 * vertically, or horizontally with Shift. The cursor stays on the floor.
 */
export function cursorStep(
	p: Point,
	e: { key: string; shiftKey: boolean },
	edges: { x: number[]; y: number[] },
	size: { w: number; h: number }
): Point | null {
	const free = e.shiftKey && e.key.startsWith('Arrow');
	const step = free ? 1 : GRID;
	const page = GRID * 10;
	let dx = 0;
	let dy = 0;
	if (e.key === 'ArrowLeft') dx = -step;
	else if (e.key === 'ArrowRight') dx = step;
	else if (e.key === 'ArrowUp') dy = -step;
	else if (e.key === 'ArrowDown') dy = step;
	else if (e.key === 'PageUp') (e.shiftKey ? (dx = -page) : (dy = -page));
	else if (e.key === 'PageDown') (e.shiftKey ? (dx = page) : (dy = page));
	else return null;
	const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
	const x = dx ? clamp(snapVal(p[0] + dx, edges.x, free).v, size.w) : p[0];
	const y = dy ? clamp(snapVal(p[1] + dy, edges.y, free).v, size.h) : p[1];
	return [x, y];
}

const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places;

/** A length as the number fields show it: feet once a scale is set, otherwise grid steps. */
export const toField = (units: number, upf: number | null) => (upf ? round(units / upf, 2) : round(units / GRID, 1));
/** A number field's value back in map units. */
export const fromField = (value: number, upf: number | null) => round(upf ? value * upf : value * GRID, 2);

/** Grid steps, for floors with no scale yet. */
const steps = (units: number) => String(round(units / GRID, 1));

/** "5′, 33′", or "12, 56 steps" with no scale. */
export function posText(p: Point, upf: number | null): string {
	return upf ? `${feet(p[0], upf)}, ${feet(p[1], upf)}` : `${steps(p[0])}, ${steps(p[1])} steps`;
}
/** "5′ 6″ × 5′", or "11 × 10 steps" with no scale. */
export function sizeOf(w: number, h: number, upf: number | null): string {
	return upf ? `${feet(w, upf)} × ${feet(h, upf)}` : `${steps(w)} × ${steps(h)} steps`;
}

/** A length read aloud: "5 feet 6", "1 foot", "6 inches". */
export function spokenFeet(units: number, upf: number): string {
	const inches = Math.round((units / upf) * 12);
	const f = Math.floor(inches / 12);
	const n = inches % 12;
	if (!f && n) return `${n} inches`;
	const ft = `${f} ${f === 1 ? 'foot' : 'feet'}`;
	return n ? `${ft} ${n}` : ft;
}
/** "0 feet, 28 feet", or "12, 56 steps" with no scale. */
export function spokenPos(p: Point, upf: number | null): string {
	return upf ? `${spokenFeet(p[0], upf)}, ${spokenFeet(p[1], upf)}` : posText(p, null);
}
/** "5 feet 6 by 5 feet", or "11 by 10 steps" with no scale. */
export function spokenSize(w: number, h: number, upf: number | null): string {
	return upf ? `${spokenFeet(w, upf)} by ${spokenFeet(h, upf)}` : `${steps(w)} by ${steps(h)} steps`;
}

/** Text fields take letters, so single-letter shortcuts never fire in them (§7). */
export function isTextField(el: EventTarget | null): boolean {
	if (!(el instanceof Element)) return false;
	if (el.closest('textarea, select, [contenteditable="true"]')) return true;
	const input = el.closest('input');
	return !!input && !['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'file', 'color'].includes(input.type);
}
