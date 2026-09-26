// Panel geometry (docs/design/DESIGN.md §6). Two columns of rows. With the default numbering,
// odd slots run down the left and even slots down the right; the alternative numbers down the
// left column, then down the right. A 2-pole breaker takes its slot and the one below it.
import type { Numbering } from './constants';

export type Side = 'left' | 'right';
type PanelShape = { slotCount: number; numbering: Numbering };
type Placed = { slot: number; poles: number };

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

/** Slots a breaker occupies. */
export function occupiedSlots(b: Placed, p: PanelShape): number[] {
	return b.poles === 2 ? [b.slot, nextInColumn(b.slot, p)] : [b.slot];
}

/** Rows alternate legs: L1 on odd rows, L2 on even rows. */
export const legOfRow = (row: number) => (row % 2 === 1 ? 'L1' : 'L2');
export const legOf = (slot: number, p: PanelShape) => legOfRow(position(slot, p).row);

/** "16", or "1/3" for a 2-pole breaker. */
export const slotLabel = (b: Placed, p: PanelShape) => occupiedSlots(b, p).join('/');

/** "Left, row 5", or "Left, row 1–2" for a 2-pole breaker. */
export function physicalPosition(b: Placed, p: PanelShape): string {
	const { side, row } = position(b.slot, p);
	const where = side === 'left' ? 'Left' : 'Right';
	return b.poles === 2 ? `${where}, row ${row}–${row + 1}` : `${where}, row ${row}`;
}

/** "Slot 16 · Leg L2", or "Slots 1 + 3 · Legs L1 + L2". */
export function slotText(b: Placed, p: PanelShape): string {
	const slots = occupiedSlots(b, p);
	if (slots.length === 2)
		return `Slots ${slots[0]} + ${slots[1]} · Legs ${legOf(slots[0], p)} + ${legOf(slots[1], p)}`;
	return `Slot ${b.slot} · Leg ${legOf(b.slot, p)}`;
}

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
	for (const b of existing) {
		if (b.id === candidate.id) continue;
		const clash = occupiedSlots(b, p).find((s) => wanted.includes(s));
		if (clash) return `Slot ${clash} is already taken.`;
	}
	return null;
}

/** Spaces used: the sum of poles. */
export const spacesUsed = (bs: Placed[]) => bs.reduce((n, b) => n + b.poles, 0);

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
	if (b.tieGroup === null) return null;
	const slots = occupiedSlots(b, p);
	const below = nextInColumn(slots[slots.length - 1], p);
	if (position(below, p).side !== position(b.slot, p).side) return null;
	return all.find((o) => o !== b && o.tieGroup === b.tieGroup && o.slot === below) ?? null;
}
