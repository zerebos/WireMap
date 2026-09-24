// First-run setup (docs/design/DESIGN.md §5.7): what the user has entered so far. Nothing is
// written until they leave the Floors step; after that, the ids of what was created are kept so
// going back and changing things updates rather than duplicates.
import type { Numbering } from '$lib/constants';

export type FloorDraft = {
	/** Stable key for the list. */
	key: number;
	/** Set once the floor is in the database. */
	id: number | null;
	name: string;
	/** A plan image picked but not saved yet. */
	plan: File | null;
	/** The saved floor already has a plan image. */
	hasPlan: boolean;
};

export type SetupDraft = {
	home: string;
	panelName: string;
	amps: number;
	spaces: number;
	numbering: Numbering;
	/** Top to bottom. */
	floors: FloorDraft[];
};

export const STEPS = [
	{ key: 'home', title: 'You & your home', desc: 'Name and owner account' },
	{ key: 'panel', title: 'Your panel', desc: 'Size and slot numbering' },
	{ key: 'floors', title: 'Floors', desc: 'What the map will show' },
	{ key: 'start', title: 'Fill it in', desc: 'Pick how to start' }
] as const;
export type StepKey = (typeof STEPS)[number]['key'];

/** The spaces a panel can have, as offered in setup. */
export const SETUP_SPACES = [12, 16, 20, 24, 30, 32, 40, 42];

let nextKey = 1;
export const floorDraft = (name: string, id: number | null = null, hasPlan = false): FloorDraft => ({
	key: nextKey++,
	id,
	name,
	plan: null,
	hasPlan
});
