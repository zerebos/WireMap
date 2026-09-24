import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { floors, rooms } from '$lib/db/schema';
import type { LocalAction } from '$lib/enhance';
import { invalid, reader } from '$lib/form';
import { deletePlan } from '$lib/plans';

export const actions: Record<string, LocalAction> = {
	addFloor: async ({ data }) => {
		const f = reader(data);
		const name = f.str('name');
		if (!name) return invalid('Give the floor a name.');
		await db.insert(floors).values({ name, level: f.int('level') ?? 0 });
	},
	deleteFloor: async ({ data }) => {
		const id = reader(data).int('id');
		if (!id) return;
		const [floor] = await db.delete(floors).where(eq(floors.id, id)).returning().all();
		await deletePlan(floor?.planImage ?? null);
	},
	addRoom: async ({ data }) => {
		const f = reader(data);
		const name = f.str('name');
		if (!name) return invalid('Give the room a name.');
		await db.insert(rooms).values({ name, floorId: f.int('floorId') });
	},
	renameRoom: async ({ data }) => {
		const f = reader(data);
		const id = f.int('id');
		const name = f.str('name');
		if (!id || !name) return invalid('Give the room a name.');
		await db.update(rooms).set({ name, floorId: f.int('floorId') }).where(eq(rooms.id, id));
	},
	deleteRoom: async ({ data }) => {
		const id = reader(data).int('id');
		if (id) await db.delete(rooms).where(eq(rooms.id, id));
	}
};
