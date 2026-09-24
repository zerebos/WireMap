import { error, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { ready } from '$lib/db';
import { HOUSE, loadHouse, needsSetup } from '$lib/house';

// Everything runs in the browser: the data lives there, so there's nothing to render ahead.
export const ssr = false;

export const load = async ({ depends, untrack, route }) => {
	depends(HOUSE);
	let data;
	try {
		const storage = await ready();
		data = { storage, house: await loadHouse() };
	} catch (e) {
		console.error(e);
		error(503, e instanceof Error ? e.message : "Couldn't open the database.");
	}
	// No panel yet: first-run setup. (Later navigations are checked in +layout.svelte, so the house
	// isn't reloaded on every page change.)
	if (needsSetup(data.house, untrack(() => route.id))) redirect(307, resolve('/setup'));
	return data;
};
