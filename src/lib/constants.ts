// Shared between the database schema and the UI.

export const PROTECTIONS = ['standard', 'gfci', 'afci', 'dual'] as const;
export type Protection = (typeof PROTECTIONS)[number];

export const PROTECTION_LABELS: Record<Protection, string> = {
	standard: 'Standard',
	gfci: 'GFCI',
	afci: 'AFCI',
	dual: 'Dual function'
};

/** The short tag shown on breakers. Standard breakers have none. */
export const PROTECTION_TAGS: Record<Protection, string> = { standard: '', gfci: 'GF', afci: 'AF', dual: 'DF' };

export const ITEM_TYPES = ['outlet', 'light', 'switch', 'appliance'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const ITEM_TYPE_LABELS: Record<ItemType, { one: string; many: string }> = {
	outlet: { one: 'Outlet', many: 'Outlets' },
	light: { one: 'Light', many: 'Lights' },
	switch: { one: 'Switch', many: 'Switches' },
	appliance: { one: 'Appliance', many: 'Appliances' }
};

export const NUMBERINGS = ['odd_left_even_right', 'down_left_then_right'] as const;
export type Numbering = (typeof NUMBERINGS)[number];

export const START_PAGES = ['panel', 'map', 'items'] as const;
export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const AMPS = [15, 20, 30, 40, 50];
export const MAIN_AMPS = [100, 125, 150, 200, 225, 400];
export const SPACES = [20, 24, 30, 40, 42];

/** Minimum copper wire for a breaker's amperage. A guide, not a code check. */
export const MIN_WIRE: Record<number, string> = { 15: '14 AWG', 20: '12 AWG', 30: '10 AWG', 40: '8 AWG', 50: '6 AWG' };
