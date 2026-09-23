// Panel geometry shared by the server (validation) and the client (rendering).
// Slots follow the common US numbering: odd on the left, even on the right, top to bottom.
// A 2-pole breaker occupies its slot and the one directly below it (slot + 2).

export const slotColumn = (slot: number) => (slot % 2 === 1 ? 'left' : 'right');
export const slotRow = (slot: number) => Math.floor((slot - 1) / 2);

export function occupiedSlots(b: { slot: number; poles: number }): number[] {
	return Array.from({ length: b.poles }, (_, i) => b.slot + i * 2);
}

/** Returns an error message if the breaker doesn't fit, otherwise null. */
export function checkFit(
	candidate: { id?: number; slot: number; poles: number },
	slotCount: number,
	existing: { id: number; slot: number; poles: number }[]
): string | null {
	const wanted = occupiedSlots(candidate);
	if (wanted.some((s) => s < 1 || s > slotCount)) {
		return `A ${candidate.poles}-pole breaker doesn't fit at slot ${candidate.slot}.`;
	}
	for (const b of existing) {
		if (b.id === candidate.id) continue;
		const clash = occupiedSlots(b).find((s) => wanted.includes(s));
		if (clash) return `Slot ${clash} is already taken.`;
	}
	return null;
}
