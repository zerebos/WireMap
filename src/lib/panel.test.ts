import { describe, expect, test } from 'bun:test';
import { panelProblem, reshapeProblem, tiedTogether } from './panel';

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
	test('a quad that no longer sits on two rows of one column is refused', () => {
		const quad = { id: 1, slot: 21, poles: 2, half: 'A' as const, spaces: [{ slot: 21, half: 'A' as const }, { slot: 23, half: 'B' as const }] };
		expect(panelProblem(p, [quad])).toBeNull();
		expect(reshapeProblem(p, { ...p, numbering: 'down_left_then_right' }, [quad])).toBe("Breaker 21A/23B wouldn't sit in one column. Move it first.");
	});
});
