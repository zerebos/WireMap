// Back buttons in the phone flows go back in history when the previous history entry is a page
// of this app, otherwise they follow their link (a fallback page). Call during component init.
//
// Whether an entry was reached from inside the app is remembered per history entry (by
// SvelteKit's history index) in sessionStorage, so it still holds after a reload or after
// coming back to the entry with the browser's back/forward buttons.
import { afterNavigate } from '$app/navigation';

const KEY = 'breakerbook:from-app';
const entry = () => String((history.state as Record<string, unknown> | null)?.['sveltekit:history'] ?? '');

function read(): Record<string, boolean> {
	try {
		return JSON.parse(sessionStorage.getItem(KEY) ?? '{}');
	} catch {
		return {};
	}
}
function remember(id: string, fromApp: boolean) {
	try {
		sessionStorage.setItem(KEY, JSON.stringify({ ...read(), [id]: fromApp }));
	} catch {
		// Private mode or storage blocked: the back button falls back to its link.
	}
}

/** `cameFrom` says whether an in-app navigation counts as coming from the screen the back button
 *  returns to. By default that's any other page; a screen on the same page (like an item opened
 *  from the Items list) passes its own test. */
export function useBack(cameFrom: (from: URL, to: URL) => boolean = (from, to) => from.pathname !== to.pathname) {
	let first = true;
	const state = $state({ fromApp: false });
	afterNavigate(({ from, to, type }) => {
		if (!first) return;
		first = false;
		const id = entry();
		if (type === 'enter' || type === 'popstate') {
			state.fromApp = read()[id] ?? false;
		} else {
			state.fromApp = !!from?.url && !!to?.url && cameFrom(from.url, to.url);
			remember(id, state.fromApp);
		}
	});
	return {
		/** Whether going back in history returns to the screen the back button links to. */
		get fromApp() {
			return state.fromApp;
		},
		/** For an <a href={fallback}> back link: goes back in history instead when possible. */
		onclick(e: MouseEvent) {
			if (!state.fromApp || e.metaKey || e.ctrlKey || e.shiftKey) return;
			e.preventDefault();
			history.back();
		}
	};
}
