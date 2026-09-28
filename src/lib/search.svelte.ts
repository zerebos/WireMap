import { slotLabel, spaceLabel, spacesOf } from './panel';

// The header search field filters whatever page is showing. Each page reads `search.q`; the
// layout clears it when you move to another page.
export const search = $state({ q: '' });

/** The trimmed, lower-cased query, or '' when not searching. */
export const query = () => search.q.trim().toLowerCase();

/**
 * Whether a query names a breaker by number: its full label ("1/3", "G3/5", "21A/23B") or any one
 * of its spaces, with or without the half or the panel prefix ("3", "17b", "g6").
 */
export function matchesSlot(b: Parameters<typeof slotLabel>[0], p: Parameters<typeof slotLabel>[1], q: string): boolean {
	if (slotLabel(b, p).toLowerCase() === q) return true;
	return spacesOf(b, p).some((s) => String(s.slot) === q || spaceLabel(s, p).toLowerCase() === q || spaceLabel({ slot: s.slot, half: null }, p).toLowerCase() === q || spaceLabel(s, { ...p, shortCode: null }).toLowerCase() === q);
}
