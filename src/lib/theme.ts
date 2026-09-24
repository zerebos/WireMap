// Theme: System follows the OS; Light and Dark set data-theme on <html> (see tokens.css).
// The choice is saved in the settings table and mirrored in localStorage so app.html can apply
// it before the page paints.
import type { Theme } from './constants';

const KEY = 'breakerbook-theme';

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
