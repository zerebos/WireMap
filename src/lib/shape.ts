// Room shapes and plane geometry for the floor map (docs/design/DATA-MODEL.md, rooms.shape).
// Everything is in map units: one coordinate space per floor.

export type Point = [number, number];
export type Rect = { x: number; y: number; w: number; h: number };
export type Shape = ({ type: 'rect' } & Rect) | { type: 'polygon'; points: Point[] };

export const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Parses a stored shape, dropping anything unusable. */
export function parseShape(value: unknown): Shape | null {
	if (!value || typeof value !== 'object') return null;
	const v = value as Record<string, unknown>;
	const num = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
	if (v.type === 'rect') {
		return num(v.x) && num(v.y) && num(v.w) && num(v.h) && v.w > 0 && v.h > 0
			? { type: 'rect', x: v.x, y: v.y, w: v.w, h: v.h }
			: null;
	}
	if (v.type === 'polygon' && Array.isArray(v.points)) {
		const pts = v.points.filter((p): p is Point => Array.isArray(p) && p.length === 2 && num(p[0]) && num(p[1]));
		return pts.length >= 3 ? { type: 'polygon', points: pts.map((p) => [p[0], p[1]]) } : null;
	}
	return null;
}

/** Corners, clockwise from the top-left for a rectangle. */
export function pointsOf(s: Shape): Point[] {
	if (s.type === 'polygon') return s.points;
	return [
		[s.x, s.y],
		[s.x + s.w, s.y],
		[s.x + s.w, s.y + s.h],
		[s.x, s.y + s.h]
	];
}

export function bboxOf(s: Shape): Rect {
	if (s.type === 'rect') return { x: s.x, y: s.y, w: s.w, h: s.h };
	const xs = s.points.map((p) => p[0]);
	const ys = s.points.map((p) => p[1]);
	const x = Math.min(...xs);
	const y = Math.min(...ys);
	return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function translate(s: Shape, dx: number, dy: number): Shape {
	if (s.type === 'rect') return { ...s, x: s.x + dx, y: s.y + dy };
	return { type: 'polygon', points: s.points.map((p) => [p[0] + dx, p[1] + dy]) };
}

/** Ray-casting test; points exactly on an edge may land either way. */
export function pointInPolygon(p: Point, poly: Point[]): boolean {
	let inside = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const [xi, yi] = poly[i];
		const [xj, yj] = poly[j];
		if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
	}
	return inside;
}

export function contains(s: Shape, p: Point): boolean {
	if (s.type === 'rect') return p[0] >= s.x && p[0] <= s.x + s.w && p[1] >= s.y && p[1] <= s.y + s.h;
	return pointInPolygon(p, s.points);
}

/** Area in square map units (shoelace formula). */
export function areaOf(s: Shape): number {
	if (s.type === 'rect') return s.w * s.h;
	const poly = s.points;
	let a = 0;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
	return Math.abs(a) / 2;
}

/** The room whose shape contains the point. Smaller rooms win when shapes overlap. */
export function roomAt<R extends { shape: unknown }>(p: Point, rooms: R[]): R | null {
	let best: R | null = null;
	let bestArea = Infinity;
	for (const r of rooms) {
		const s = parseShape(r.shape);
		if (!s || !contains(s, p)) continue;
		const area = areaOf(s);
		if (area < bestArea) {
			best = r;
			bestArea = area;
		}
	}
	return best;
}

/** The closest point to `p` on segment a–b. */
export function nearestOnSegment(p: Point, a: Point, b: Point): Point {
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	const len2 = dx * dx + dy * dy;
	if (!len2) return a;
	const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
	return [a[0] + t * dx, a[1] + t * dy];
}

/** A length in feet and inches: "17′", "7′ 6″". */
export function feet(units: number, unitsPerFt: number): string {
	const inches = Math.round((units / unitsPerFt) * 12);
	const f = Math.floor(inches / 12);
	const n = inches % 12;
	return n ? `${f}′ ${n}″` : `${f}′`;
}

/** "17′ × 15′" (bounding box for a polygon), or '' when the floor has no scale. */
export function sizeText(s: Shape, unitsPerFt: number | null): string {
	if (!unitsPerFt) return '';
	const b = bboxOf(s);
	return `${feet(b.w, unitsPerFt)} × ${feet(b.h, unitsPerFt)}`;
}
