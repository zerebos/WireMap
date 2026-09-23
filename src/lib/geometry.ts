// Plane geometry for the floor map. Points are [x, y] in plan units.

export type Point = [number, number];

export const DEFAULT_METERS_PER_UNIT = 0.01;

export const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Ray-casting test; points exactly on an edge may land either way. */
export function pointInPolygon(p: Point, poly: Point[]): boolean {
	let inside = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const [xi, yi] = poly[i];
		const [xj, yj] = poly[j];
		if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
			inside = !inside;
		}
	}
	return inside;
}

/** Area in square plan units (shoelace formula). */
export function polygonArea(poly: Point[]): number {
	let a = 0;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
	}
	return Math.abs(a) / 2;
}

/** Where to put a room's label: the area centroid, or the vertex average if that falls outside. */
export function labelPoint(poly: Point[]): Point {
	let a = 0;
	let cx = 0;
	let cy = 0;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const f = poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
		a += f;
		cx += (poly[j][0] + poly[i][0]) * f;
		cy += (poly[j][1] + poly[i][1]) * f;
	}
	const avg: Point = [
		poly.reduce((s, p) => s + p[0], 0) / poly.length,
		poly.reduce((s, p) => s + p[1], 0) / poly.length
	];
	if (Math.abs(a) < 1e-9) return avg;
	const c: Point = [cx / (3 * a), cy / (3 * a)];
	return pointInPolygon(c, poly) ? c : avg;
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

/** Parses a stored outline, dropping anything that isn't a usable polygon. */
export function parseOutline(value: unknown): Point[] | null {
	if (!Array.isArray(value) || value.length < 3) return null;
	const pts = value.filter(
		(p): p is Point =>
			Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n))
	);
	return pts.length >= 3 ? pts : null;
}

/** Finds the room whose outline contains the point. Smaller rooms win when outlines overlap. */
export function roomAt<R extends { outline: Point[] | null }>(p: Point, rooms: R[]): R | null {
	let best: R | null = null;
	let bestArea = Infinity;
	for (const r of rooms) {
		if (!r.outline || !pointInPolygon(p, r.outline)) continue;
		const area = polygonArea(r.outline);
		if (area < bestArea) {
			best = r;
			bestArea = area;
		}
	}
	return best;
}

// Display units. Everything is stored in metres (via the floor's scale); this only affects labels.
export type LengthUnit = 'm' | 'ft';
export const FEET_PER_METER = 3.28084;

const METERS_PER: Record<string, number> = { m: 1, cm: 0.01, ft: 0.3048, in: 0.0254 };

/** Converts a length in m, cm, ft or in to metres. Unknown units are taken as metres. */
export const toMeters = (value: number, unit: string) => value * (METERS_PER[unit] ?? 1);

export function formatLength(meters: number, unit: LengthUnit): string {
	if (unit === 'm') return `${meters.toFixed(meters < 10 ? 2 : 1)} m`;
	const totalIn = Math.round(meters * FEET_PER_METER * 12);
	const ft = Math.floor(totalIn / 12);
	const inches = totalIn % 12;
	return inches ? `${ft}′ ${inches}″` : `${ft}′`;
}

export function formatArea(sqMeters: number, unit: LengthUnit): string {
	return unit === 'm'
		? `${sqMeters.toFixed(1)} m²`
		: `${Math.round(sqMeters * FEET_PER_METER * FEET_PER_METER)} ft²`;
}
