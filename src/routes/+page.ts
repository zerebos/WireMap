import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';

// Open to the page chosen in Settings → General.
export const load = async ({ parent }) => {
	const { house } = await parent();
	redirect(307, resolve(`/${house.settings.startPage}`));
};
