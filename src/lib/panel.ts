// Panel geometry (docs/design/DESIGN.md §6). Two columns of rows. With the default numbering,
// odd slots run down the left and even slots down the right; the alternative numbers down the
// left column, then down the right. A 2-pole breaker takes its slot and the one below it; a
// tandem half (§5.15) takes the upper (A) or lower (B) half of one slot.
//
// Which spaces a breaker takes is stored in breaker_spaces (DATA-MODEL.md "Occupancy"), because a
// quad breaker (§5.18) pairs across halves: outer = 21A + 23B, inner = 21B + 23A. The house loads
// them onto each breaker as `spaces`; without them (a new or resized breaker) they're derived.
// Everything that asks which spaces a breaker takes goes through `spacesOf`, and everything that
// prints a breaker's number goes through `slotLabel`.
import type { Half, Numbering } from './constants';

export type Side = 'left' | 'right';
type PanelShape = { slotCount: number; numbering: Numbering; tandemSlots?: string | null; shortCode?: string | null };
type Placed = { slot: number; poles: number; half?: Half | null; spaces?: Space[] };

/** One space a breaker takes: a whole slot (half null) or half of one. */
export type Space = { slot: number; half: Half | null };

export const rowCount = (p: PanelShape) => Math.ceil(p.slotCount / 2);

/** Where a slot physically is: its column and its 1-based row. */
export function position(slot: number, p: PanelShape): { side: Side; row: number } {
	if (p.numbering === 'down_left_then_right') {
		const half = rowCount(p);
		return slot <= half ? { side: 'left', row: slot } : { side: 'right', row: slot - half };
	}
	return { side: slot % 2 === 1 ? 'left' : 'right', row: Math.ceil(slot / 2) };
}

/** The slot at a column and 1-based row. */
export function slotAt(side: Side, row: number, p: PanelShape): number {
	if (p.numbering === 'down_left_then_right') return side === 'left' ? row : rowCount(p) + row;
	return side === 'left' ? row * 2 - 1 : row * 2;
}

/** The slot directly below. */
export const nextInColumn = (slot: number, p: PanelShape) =>
	p.numbering === 'down_left_then_right' ? slot + 1 : slot + 2;

/** Panel order for spaces: by slot, then half A before B. */
const bySpace = (a: Space, b: Space) => a.slot - b.slot || (a.half ?? '').localeCompare(b.half ?? '');

/** The spaces a breaker takes, in order: its stored spaces, or else derived from slot, poles and half. */
export function spacesOf(b: Placed, p: PanelShape): Space[] {
	if (b.spaces?.length) return [...b.spaces].sort(bySpace);
	return deriveSpaces(b, p);
}

/** The spaces a plain (non-quad) breaker takes: slot, plus the slot below for 2-pole, or one half. */
export function deriveSpaces(b: Placed, p: PanelShape): Space[] {
	if (b.poles === 2) return [{ slot: b.slot, half: null }, { slot: nextInColumn(b.slot, p), half: null }];
	return [{ slot: b.slot, half: b.half ?? null }];
}

/** Slots a breaker occupies (a tandem half counts its whole slot). */
export function occupiedSlots(b: Placed, p: PanelShape): number[] {
	return [...new Set(spacesOf(b, p).map((s) => s.slot))];
}

/** A quad pair (§5.18): a 2-pole breaker on half spaces of two slots. */
export function quadPair(b: Placed, p: PanelShape): 'outer' | 'inner' | null {
	const sp = spacesOf(b, p);
	if (sp.length !== 2 || sp.some((x) => x.half === null) || sp[0].slot === sp[1].slot) return null;
	return sp[0].half === 'A' ? 'outer' : 'inner';
}

/** A quad pair's spaces at `slot` and the slot below: outer = sA + (s+2)B, inner = sB + (s+2)A. */
export function quadSpaces(slot: number, p: PanelShape, pair: 'outer' | 'inner'): Space[] {
	const below = nextInColumn(slot, p);
	return pair === 'outer'
		? [
				{ slot, half: 'A' },
				{ slot: below, half: 'B' }
			]
		: [
				{ slot, half: 'B' },
				{ slot: below, half: 'A' }
			];
}

/** "17", "17B". */
export const spaceText = (s: Space) => `${s.slot}${s.half ?? ''}`;

/** Two spaces can't both be filled: same slot, and either is whole or they're the same half. */
const clashes = (a: Space, b: Space) => a.slot === b.slot && (a.half === null || b.half === null || a.half === b.half);

/** Panel order: by slot, then half A before B. */
export function compareBreakers(a: Placed & { panelId: number }, b: Placed & { panelId: number }): number {
	return a.panelId - b.panelId || a.slot - b.slot || (a.half ?? '').localeCompare(b.half ?? '');
}

/**
 * One place in a column of the panel face: a full-size breaker (starting here), a tandem slot
 * (its A and B halves, either of which may be empty), or an open slot.
 */
export type Cell<B> = {
	slot: number;
	breaker: B | null;
	halves: [B | null, B | null] | null;
	/** A quad (§5.18) over this slot and the one below: sA, sB, (s+2)A, (s+2)B. */
	quad: [B | null, B | null, B | null, B | null] | null;
};

/**
 * The panel face, column by column, top to bottom. A breaker appears once, at its first slot;
 * the slots it also covers are left out. Every view that draws the panel builds on this.
 */
export function faceColumns<B extends Placed>(p: PanelShape, breakers: B[]): Record<Side, Cell<B>[]> {
	const whole = new Map<number, B>();
	const halves = new Map<number, [B | null, B | null]>();
	for (const b of breakers) {
		for (const s of spacesOf(b, p)) {
			if (s.half === null) whole.set(s.slot, b);
			else {
				const pair = halves.get(s.slot) ?? [null, null];
				pair[s.half === 'A' ? 0 : 1] = b;
				halves.set(s.slot, pair);
			}
		}
	}
	// A quad takes its slot and the one below as one cell.
	const quadTops = new Set<number>();
	for (const b of breakers) if (quadPair(b, p)) quadTops.add(spacesOf(b, p)[0].slot);
	const column = (side: Side) => {
		const out: Cell<B>[] = [];
		const skip = new Set<number>();
		for (let row = 1; row <= rowCount(p); row++) {
			const slot = slotAt(side, row, p);
			if (slot > p.slotCount || skip.has(slot)) continue;
			if (quadTops.has(slot)) {
				const below = nextInColumn(slot, p);
				const a = halves.get(slot) ?? [null, null];
				const c = halves.get(below) ?? [null, null];
				skip.add(below);
				out.push({ slot, breaker: null, halves: null, quad: [a[0], a[1], c[0], c[1]] });
				continue;
			}
			const b = whole.get(slot);
			if (b && b.slot !== slot) continue;
			out.push({ slot, breaker: b ?? null, halves: b ? null : (halves.get(slot) ?? null), quad: null });
		}
		return out;
	};
	return { left: column('left'), right: column('right') };
}

/** Rows alternate legs: L1 on odd rows, L2 on even rows. */
export const legOfRow = (row: number) => (row % 2 === 1 ? 'L1' : 'L2');
export const legOf = (slot: number, p: PanelShape) => legOfRow(position(slot, p).row);

/**
 * A breaker's number: "16", "1/3" for a 2-pole breaker, "17B" for a tandem half. A subpanel's short
 * code prefixes it once: "G6", "G3/5" (DESIGN.md §5.17).
 */
export const slotLabel = (b: Placed, p: PanelShape) => (p.shortCode ?? '') + spacesOf(b, p).map(spaceText).join('/');

/** An open space's number, with the panel's prefix: "G9", "17A". */
export const spaceLabel = (s: Space, p: PanelShape) => (p.shortCode ?? '') + spaceText(s);

/** A panel's name without "panel"/"subpanel": "Main", "Garage". */
export const panelShort = (p: { name: string }) => p.name.replace(/\s+(sub)?panel$/i, '').trim() || p.name;

/** "Leg L2", or "Legs L1 + L2" for a 2-pole breaker. */
export function legsText(b: Placed, p: PanelShape): string {
	const legs = occupiedSlots(b, p).map((s) => legOf(s, p));
	return legs.length === 2 ? `Legs ${legs.join(' + ')}` : `Leg ${legs[0]}`;
}

/** "Left, row 5", or "Left, row 1–2" for a 2-pole breaker. */
export function physicalPosition(b: Placed, p: PanelShape): string {
	const { side, row } = position(b.slot, p);
	const where = side === 'left' ? 'Left' : 'Right';
	const pair = quadPair(b, p);
	if (pair) return `${where}, rows ${row}–${row + 1} · ${pair} pair`;
	if (b.poles === 2) return `${where}, row ${row}–${row + 1}`;
	if (b.half) return `${where}, row ${row} · ${b.half === 'A' ? 'upper' : 'lower'} half`;
	return `${where}, row ${row}`;
}

/** "Slot 16 · Leg L2", "Slots 1 + 3 · Legs L1 + L2", or "Slot 17 · Tandem half B · Leg L1". */
export function slotText(b: Placed, p: PanelShape): string {
	const slots = occupiedSlots(b, p);
	const pair = quadPair(b, p);
	if (pair) {
		const sp = spacesOf(b, p);
		return `Slots ${spaceText(sp[0])} + ${spaceText(sp[1])} · Legs ${legOf(slots[0], p)} + ${legOf(slots[1], p)} · Quad, ${pair} pair`;
	}
	if (slots.length === 2)
		return `Slots ${slots[0]} + ${slots[1]} · Legs ${legOf(slots[0], p)} + ${legOf(slots[1], p)}`;
	if (b.half) return `Slot ${b.slot} · Tandem half ${b.half} · Leg ${legOf(b.slot, p)}`;
	return `Slot ${b.slot} · Leg ${legOf(b.slot, p)}`;
}

/**
 * The slots rated for tandems, from the panel label ("17-28", "17–28, 33-40"), or null when
 * unknown (tandems are fine anywhere then).
 */
export function tandemRanges(p: PanelShape): [number, number][] | null {
	const ranges = (p.tandemSlots ?? '')
		.split(',')
		.map((part) => part.match(/^\s*(\d+)\s*(?:[-–—]\s*(\d+))?\s*$/))
		.filter((m): m is RegExpMatchArray => !!m)
		.map((m): [number, number] => [Number(m[1]), Number(m[2] ?? m[1])]);
	return ranges.length ? ranges : null;
}

/** Whether a slot may hold tandems: inside the rated slots, or anywhere when they're unknown. */
export function tandemOk(slot: number, p: PanelShape): boolean {
	const r = tandemRanges(p);
	return !r || r.some(([a, b]) => slot >= Math.min(a, b) && slot <= Math.max(a, b));
}

/** "17–28" for display, or '' when unknown. */
export const tandemText = (p: PanelShape) =>
	(tandemRanges(p) ?? []).map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ');

/** Returns an error message if the breaker doesn't fit, otherwise null. */
export function checkFit(
	candidate: Placed & { id?: number },
	p: PanelShape,
	existing: (Placed & { id: number })[]
): string | null {
	const wanted = occupiedSlots(candidate, p);
	const start = position(candidate.slot, p);
	const end = position(wanted[wanted.length - 1], p);
	if (wanted.some((s) => s < 1 || s > p.slotCount) || start.side !== end.side) {
		return `A ${candidate.poles}-pole breaker doesn't fit at slot ${candidate.slot}.`;
	}
	const want = spacesOf(candidate, p);
	for (const b of existing) {
		if (b.id === candidate.id) continue;
		const clash = spacesOf(b, p).find((s) => want.some((w) => clashes(s, w)));
		if (clash) return `Slot ${spaceText(clash)} is already taken.`;
	}
	return null;
}

/** Spaces used: slots holding any breaker (a tandem pair shares one). */
export const spacesUsed = (bs: Placed[], p: PanelShape) => new Set(bs.flatMap((b) => occupiedSlots(b, p))).size;

/**
 * Whether handle-tied breakers sit together: one column, rows running on without a gap. A
 * multi-wire circuit's breakers must stay side by side so one handle turns them all off.
 */
export function tiedTogether(group: Placed[], p: PanelShape): boolean {
	const rows = group.flatMap((b) => occupiedSlots(b, p).map((s) => position(s, p)));
	if (new Set(rows.map((r) => r.side)).size > 1) return false;
	const ns = rows.map((r) => r.row).sort((a, b) => a - b);
	return ns.every((n, i) => i === 0 || n === ns[i - 1] + 1);
}

/** The breaker directly below `b` in its column, when it's handle-tied to `b`. */
export function tiedBelow<B extends Placed & { tieGroup: number | null }>(b: B, all: B[], p: PanelShape): B | null {
	if (b.tieGroup === null || b.half) return null;
	const slots = occupiedSlots(b, p);
	const below = nextInColumn(slots[slots.length - 1], p);
	if (position(below, p).side !== position(b.slot, p).side) return null;
	return all.find((o) => o !== b && o.tieGroup === b.tieGroup && o.slot === below && !o.half) ?? null;
}
