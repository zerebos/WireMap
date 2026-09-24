import { asc, count } from 'drizzle-orm';
import { db } from '$lib/db';
import { devices, floors, rooms } from '$lib/db/schema';

export const load = async () => {
	const counts = new Map(
		(await db.select({ roomId: devices.roomId, n: count() }).from(devices).groupBy(devices.roomId).all()).map(
			(r) => [r.roomId, r.n]
		)
	);
	return {
		floors: await db.select().from(floors).orderBy(asc(floors.level)).all(),
		rooms: (await db.select().from(rooms).orderBy(asc(rooms.name)).all()).map((r) => ({
			...r,
			deviceCount: counts.get(r.id) ?? 0
		}))
	};
};
