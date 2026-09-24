// The header search field filters whatever page is showing. Each page reads `search.q`; the
// layout clears it when you move to another page.
export const search = $state({ q: '' });

/** The trimmed, lower-cased query, or '' when not searching. */
export const query = () => search.q.trim().toLowerCase();
