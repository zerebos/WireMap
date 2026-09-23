// Shared between the database schema and the UI.

export const BREAKER_KINDS = ['standard', 'gfci', 'afci', 'dual'] as const;
export type BreakerKind = (typeof BREAKER_KINDS)[number];

export const BREAKER_KIND_LABELS: Record<BreakerKind, string> = {
	standard: 'Standard',
	gfci: 'GFCI',
	afci: 'AFCI',
	dual: 'Dual function (AFCI + GFCI)'
};

export const DEVICE_KINDS = [
	'outlet',
	'switch',
	'light',
	'appliance',
	'hardwired',
	'subpanel',
	'other'
] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

export const DEVICE_KIND_INFO: Record<DeviceKind, { label: string; icon: string }> = {
	outlet: { label: 'Outlet', icon: '🔌' },
	switch: { label: 'Switch', icon: '🎚️' },
	light: { label: 'Light', icon: '💡' },
	appliance: { label: 'Appliance', icon: '🧺' },
	hardwired: { label: 'Hardwired', icon: '🔧' },
	subpanel: { label: 'Sub-panel', icon: '🗄️' },
	other: { label: 'Other', icon: '•' }
};

export const COMMON_AMPS = [15, 20, 25, 30, 40, 50, 60, 70, 100];
