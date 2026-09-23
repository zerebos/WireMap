import { asc, count, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { devices, floors, rooms } from '$lib/server/db/schema';
import { invalid, reader } from '$lib/server/form';
import { deletePlan } from '$lib/server/plans';

export const load = () => {
	const counts = new Map(
		db
			.select({ roomId: devices.roomId, n: count() })
			.from(devices)
			.groupBy(devices.roomId)
			.all()
			.map((r) => [r.roomId, r.n])
	);
	return {
		floors: db.select().from(floors).orderBy(asc(floors.level)).all(),
		rooms: db
			.select()
			.from(rooms)
			.orderBy(asc(rooms.name))
			.all()
			.map((r) => ({ ...r, deviceCount: counts.get(r.id) ?? 0 }))
	};
};

export const actions = {
	addFloor: async ({ request }) => {
		const f = reader(await request.formData());
		const name = f.str('name');
		if (!name) return invalid('Give the floor a name.');
		db.insert(floors).values({ name, level: f.int('level') ?? 0 }).run();
	},
	deleteFloor: async ({ request }) => {
		const id = reader(await request.formData()).int('id');
		if (!id) return;
		const [floor] = db.delete(floors).where(eq(floors.id, id)).returning().all();
		deletePlan(floor?.planImage ?? null);
	},
	addRoom: async ({ request }) => {
		const f = reader(await request.formData());
		const name = f.str('name');
		if (!name) return invalid('Give the room a name.');
		db.insert(rooms).values({ name, floorId: f.int('floorId') }).run();
	},
	renameRoom: async ({ request }) => {
		const f = reader(await request.formData());
		const id = f.int('id');
		const name = f.str('name');
		if (!id || !name) return invalid('Give the room a name.');
		db.update(rooms).set({ name, floorId: f.int('floorId') }).where(eq(rooms.id, id)).run();
	},
	deleteRoom: async ({ request }) => {
		const id = reader(await request.formData()).int('id');
		if (id) db.delete(rooms).where(eq(rooms.id, id)).run();
	}
};
