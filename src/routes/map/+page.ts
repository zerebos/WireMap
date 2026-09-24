import { asc } from 'drizzle-orm';
import { db } from '$lib/db';
import { devices, floors, panels, rooms } from '$lib/db/schema';
import { parseOutline } from '$lib/geometry';
import { planUrl } from '$lib/plans';

export const load = async () => {
	const floorRows = await db.select().from(floors).orderBy(asc(floors.level), asc(floors.id)).all();
	return {
		floors: await Promise.all(
			floorRows.map(async (f) => ({ ...f, planUrl: f.planImage ? await planUrl(f.planImage) : null }))
		),
		rooms: (await db.select().from(rooms).orderBy(asc(rooms.name)).all()).map((r) => ({
			...r,
			outline: parseOutline(r.outline)
		})),
		devices: await db.select().from(devices).orderBy(asc(devices.name)).all(),
		panels: await db.query.panels.findMany({
			orderBy: asc(panels.id),
			with: {
				breakers: {
					orderBy: (b, { asc }) => asc(b.slot),
					with: { devices: { columns: { id: true } } }
				}
			}
		})
	};
};
