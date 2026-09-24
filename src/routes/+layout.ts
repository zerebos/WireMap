import { error } from '@sveltejs/kit';
import { ready } from '$lib/db';
import { HOUSE, loadHouse } from '$lib/house';

// Everything runs in the browser: the data lives there, so there's nothing to render ahead.
export const ssr = false;

export const load = async ({ depends }) => {
	depends(HOUSE);
	try {
		const storage = await ready();
		return { storage, house: await loadHouse() };
	} catch (e) {
		console.error(e);
		error(503, e instanceof Error ? e.message : "Couldn't open the database.");
	}
};
