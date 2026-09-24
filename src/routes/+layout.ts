import { error } from '@sveltejs/kit';
import { ready } from '$lib/db';

// Everything runs in the browser: the data lives there, so there's nothing to render ahead.
export const ssr = false;

export const load = async () => {
	try {
		return { storage: await ready() };
	} catch (e) {
		console.error(e);
		error(503, e instanceof Error ? e.message : "Couldn't open the database.");
	}
};
