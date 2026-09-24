import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { db } from '$lib/db';
import { panels } from '$lib/db/schema';
import type { LocalAction } from '$lib/enhance';
import { invalid, reader } from '$lib/form';

export const actions: Record<string, LocalAction> = {
	default: async ({ data }) => {
		const f = reader(data);
		const name = f.str('name');
		const slotCount = f.int('slotCount') ?? 24;
		if (!name) return invalid('Give the panel a name.');
		if (slotCount < 2 || slotCount > 84 || slotCount % 2) {
			return invalid('Slot count must be an even number between 2 and 84.');
		}
		const [panel] = await db
			.insert(panels)
			.values({ name, location: f.optStr('location'), mainAmps: f.int('mainAmps'), slotCount })
			.returning()
			.all();
		redirect(303, resolve('/panels/[id]', { id: String(panel.id) }));
	}
};
