// Theme: System follows the OS; Light and Dark set data-theme on <html> (see tokens.css).
// The choice is saved in the settings table and mirrored in localStorage so app.html can apply
// it before the page paints. A guest's choice is kept on this device only (§5.13).
import type { Theme } from './constants';

const KEY = 'breakerbook-theme';
const GUEST_KEY = 'breakerbook-guest-theme';

/** The theme a guest picked on this device, if any. */
export function readGuestTheme(): Theme | null {
	try {
		const t = localStorage.getItem(GUEST_KEY);
		return t === 'light' || t === 'dark' || t === 'system' ? t : null;
	} catch {
		return null;
	}
}
/** Before a lock reloads the page: have app.html paint the guest's theme, not the owner's. */
export function preferGuestTheme() {
	const t = readGuestTheme();
	if (!t) return;
	try {
		localStorage.setItem(KEY, t);
	} catch {
		// Storage can be off; nothing to prefer then.
	}
}
export function saveGuestTheme(theme: Theme) {
	try {
		localStorage.setItem(GUEST_KEY, theme);
	} catch {
		// Storage can be off; the theme still applies for this visit.
	}
}

export function applyTheme(theme: Theme) {
	const root = document.documentElement;
	if (theme === 'system') root.removeAttribute('data-theme');
	else root.setAttribute('data-theme', theme);
	try {
		localStorage.setItem(KEY, theme);
	} catch {
		// Storage can be off; the theme still applies for this visit.
	}
}

/** What's showing right now, resolving System to the OS preference. */
export function effectiveTheme(theme: Theme): 'light' | 'dark' {
	if (theme !== 'system') return theme;
	return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
