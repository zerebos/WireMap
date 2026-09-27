import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { access } from '$lib/access.svelte';

// Open to the page chosen in Settings → General, or to first-run setup when there's no panel.
export const load = async ({ parent }) => {
	const { house } = await parent();
	if (house.panel === null) redirect(307, resolve(access.guest ? '/panel' : '/setup'));
	redirect(307, resolve(`/${house.settings.startPage}`));
};
