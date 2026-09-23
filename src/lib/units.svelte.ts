import type { LengthUnit } from './geometry';

const KEY = 'breaker-box:length-unit';

/** Display unit for lengths and areas. Starts as feet and picks up the saved choice in the browser. */
export const units = $state<{ length: LengthUnit }>({ length: 'ft' });

export function loadUnitPreference() {
	let saved: string | null = null;
	try {
		saved = localStorage.getItem(KEY);
	} catch {
		// Storage can be blocked; fall back to the locale.
	}
	units.length = saved === 'm' || saved === 'ft' ? saved : navigator.language === 'en-US' ? 'ft' : 'm';
}

export function setLengthUnit(unit: LengthUnit) {
	units.length = unit;
	try {
		localStorage.setItem(KEY, unit);
	} catch {
		// Not saved; it still applies for this visit.
	}
}
