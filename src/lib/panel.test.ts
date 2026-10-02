import { describe, expect, test } from 'bun:test';
import { checkFit, panelProblem, reshapeProblem, slotText, tiedTogether } from './panel';

const p = { slotCount: 40, numbering: 'odd_left_even_right' as const };

describe('tiedTogether', () => {
	test('tied halves of one tandem slot sit together', () => {
		expect(tiedTogether([{ slot: 17, poles: 1, half: 'A' }, { slot: 17, poles: 1, half: 'B' }], p)).toBe(true);
	});
	test('a gap or another column still counts as apart', () => {
		expect(tiedTogether([{ slot: 1, poles: 1 }, { slot: 5, poles: 1 }], p)).toBe(false);
		expect(tiedTogether([{ slot: 1, poles: 1 }, { slot: 2, poles: 1 }], p)).toBe(false);
		expect(tiedTogether([{ slot: 17, poles: 1, half: 'B' }, { slot: 19, poles: 1 }], p)).toBe(true);
	});
});

describe('reshapeProblem', () => {
	const at = (id: number, slot: number, poles = 1) => ({ id, slot, poles, half: null, spaces: [] });
	test('refuses a shrink that strands breakers, with the lost slots', () => {
		expect(reshapeProblem(p, { ...p, slotCount: 20 }, [at(1, 25)])).toBe('Slots 21–40 still have breakers. Move or remove them first.');
		expect(reshapeProblem(p, { ...p, slotCount: 20 }, [at(1, 19)])).toBeNull();
	});
	test('refuses a numbering that makes 2-pole breakers overlap', () => {
		const next = { ...p, numbering: 'down_left_then_right' as const };
		expect(reshapeProblem(p, next, [at(1, 1, 2), at(2, 2)])).toBe('Slot 2 would hold two breakers. Move one of them first.');
		expect(reshapeProblem(p, next, [at(1, 20, 2)])).toBe("Breaker 20/21 wouldn't sit in one column. Move it first.");
	});
	test('any new numbering is refused while the panel has a quad, even one that would still fit', () => {
		const quad = { id: 1, slot: 21, poles: 2, half: 'A' as const, spaces: [{ slot: 21, half: 'A' as const }, { slot: 23, half: 'B' as const }] };
		expect(panelProblem(p, [quad])).toBeNull();
		const msg = 'Quad breaker 21A/23B is placed for the current numbering. Remove it first.';
		expect(reshapeProblem(p, { ...p, numbering: 'down_left_then_right' }, [quad])).toBe(msg);
		// A 21-space-or-more column fits 1A/2B under the other numbering, and it's still refused.
		const low = { id: 2, slot: 1, poles: 2, half: 'A' as const, spaces: [{ slot: 1, half: 'A' as const }, { slot: 3, half: 'B' as const }] };
		expect(reshapeProblem(p, { ...p, numbering: 'down_left_then_right' }, [low])).toContain('Quad breaker 1A/3B');
		// Shrinking alone keeps it.
		expect(reshapeProblem(p, { ...p, slotCount: 30 }, [quad])).toBeNull();
	});
	test('messages use the panel’s short code', () => {
		const g = { slotCount: 12, numbering: 'odd_left_even_right' as const, shortCode: 'G' };
		expect(reshapeProblem(g, { ...g, slotCount: 8 }, [at(1, 9)])).toBe('Slots G9–G12 still have breakers. Move or remove them first.');
		expect(checkFit({ slot: 5, poles: 1, half: 'B' }, g, [{ id: 1, slot: 5, poles: 1, half: null }])).toBe('Slot G5 is already taken.');
		expect(checkFit({ slot: 11, poles: 2 }, g, [])).toBe("A 2-pole breaker doesn't fit at slot G11.");
	});
});

describe('slotText', () => {
	test('a subpanel’s slots carry its short code', () => {
		const g = { slotCount: 12, numbering: 'odd_left_even_right' as const, shortCode: 'G' };
		expect(slotText({ slot: 6, poles: 1 }, g)).toBe('Slot G6 · Leg L1');
		expect(slotText({ slot: 3, poles: 2 }, g)).toBe('Slots G3 + G5 · Legs L2 + L1');
		expect(slotText({ slot: 7, poles: 1, half: 'B' }, g)).toBe('Slot G7 · Tandem half B · Leg L2');
		expect(slotText({ slot: 16, poles: 1 }, p)).toBe('Slot 16 · Leg L2');
	});
});
