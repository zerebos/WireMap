import { describe, expect, test } from 'bun:test';
import { cursorStep, fromField, posText, sizeOf, snapVal, spokenFeet, spokenSize, toField } from './keys';

const floor = { w: 820, h: 760 };
const none = { x: [], y: [] };
const key = (k: string, shiftKey = false) => ({ key: k, shiftKey });

describe('snapVal', () => {
	test('snaps to the grid when no edge is close', () => {
		expect(snapVal(104, [], false)).toEqual({ v: 100, g: null });
		expect(snapVal(106, [200], false)).toEqual({ v: 110, g: null });
	});
	test('snaps to the nearest edge within 8 units, with a guide', () => {
		expect(snapVal(110, [105, 117], false)).toEqual({ v: 105, g: 105 });
		expect(snapVal(110, [102, 117], false)).toEqual({ v: 117, g: 117 });
	});
	test('Shift is free', () => {
		expect(snapVal(103.5, [100], true)).toEqual({ v: 103.5, g: null });
	});
});

describe('cursorStep', () => {
	test('arrows move one grid step', () => {
		expect(cursorStep([100, 100], key('ArrowRight'), none, floor)).toEqual([110, 100]);
		expect(cursorStep([100, 100], key('ArrowUp'), none, floor)).toEqual([100, 90]);
	});
	test('arrows snap through the same function as the pointer', () => {
		expect(cursorStep([100, 100], key('ArrowRight'), { x: [105], y: [] }, floor)).toEqual([105, 100]);
		// Off the grid after an edge, the next step lands back on it, never behind where it started.
		expect(cursorStep([105, 100], key('ArrowRight'), none, floor)).toEqual([120, 100]);
		expect(cursorStep([103, 100], key('ArrowDown'), none, floor)).toEqual([103, 110]);
	});
	test('Shift+arrows move one unit, free', () => {
		expect(cursorStep([100, 100], key('ArrowLeft', true), { x: [95], y: [] }, floor)).toEqual([99, 100]);
	});
	test('Page Up/Down jump 10 steps, horizontally with Shift', () => {
		expect(cursorStep([300, 300], key('PageDown'), none, floor)).toEqual([300, 400]);
		expect(cursorStep([300, 300], key('PageUp'), none, floor)).toEqual([300, 200]);
		expect(cursorStep([300, 300], key('PageDown', true), none, floor)).toEqual([400, 300]);
		expect(cursorStep([300, 300], key('PageUp', true), none, floor)).toEqual([200, 300]);
	});
	test('stays on the floor', () => {
		expect(cursorStep([0, 0], key('ArrowLeft'), none, floor)).toEqual([0, 0]);
		expect(cursorStep([800, 700], key('PageDown'), none, floor)).toEqual([800, 760]);
	});
	test('other keys do nothing', () => {
		expect(cursorStep([0, 0], key('Enter'), none, floor)).toBeNull();
	});
});

describe('feet and map units', () => {
	test('fields count feet once a scale is set', () => {
		expect(toField(340, 20)).toBe(17);
		expect(toField(110, 20)).toBe(5.5);
		expect(fromField(20, 20)).toBe(400);
		expect(fromField(5.5, 20)).toBe(110);
		expect(fromField(toField(333, 19.4), 19.4)).toBeCloseTo(333, 0);
	});
	test('fields count grid steps without a scale', () => {
		expect(toField(340, null)).toBe(34);
		expect(toField(341, null)).toBe(34.1);
		expect(fromField(34, null)).toBe(340);
	});
	test('positions and sizes as text', () => {
		expect(posText([100, 660], 20)).toBe('5′, 33′');
		expect(posText([120, 560], null)).toBe('12, 56 steps');
		expect(sizeOf(110, 100, 20)).toBe('5′ 6″ × 5′');
		expect(sizeOf(340, 300, null)).toBe('34 × 30 steps');
	});
	test('read aloud', () => {
		expect(spokenFeet(110, 20)).toBe('5 feet 6');
		expect(spokenFeet(20, 20)).toBe('1 foot');
		expect(spokenFeet(10, 20)).toBe('6 inches');
		expect(spokenSize(110, 100, 20)).toBe('5 feet 6 by 5 feet');
		expect(spokenSize(110, 100, null)).toBe('11 by 10 steps');
	});
});
