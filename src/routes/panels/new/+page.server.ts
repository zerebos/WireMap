import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { panels } from '$lib/server/db/schema';
import { invalid, reader } from '$lib/server/form';

export const actions = {
	default: async ({ request }) => {
		const f = reader(await request.formData());
		const name = f.str('name');
		const slotCount = f.int('slotCount') ?? 24;
		if (!name) return invalid('Give the panel a name.');
		if (slotCount < 2 || slotCount > 84 || slotCount % 2) {
			return invalid('Slot count must be an even number between 2 and 84.');
		}
		const [panel] = db
			.insert(panels)
			.values({ name, location: f.optStr('location'), mainAmps: f.int('mainAmps'), slotCount })
			.returning()
			.all();
		redirect(303, `/panels/${panel.id}`);
	}
};
