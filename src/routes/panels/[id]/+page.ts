import { error } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { breakers, devices, floors, panels, rooms } from '$lib/db/schema';

export const load = async ({ params }) => {
	const id = Number(params.id);
	const panel = Number.isInteger(id) ? await db.query.panels.findFirst({ where: eq(panels.id, id) }) : undefined;
	if (!panel) error(404, 'Panel not found');
	return {
		panel,
		panels: await db.select({ id: panels.id, name: panels.name }).from(panels).orderBy(asc(panels.id)).all(),
		breakers: await db.query.breakers.findMany({
			where: eq(breakers.panelId, panel.id),
			orderBy: asc(breakers.slot),
			with: { devices: { orderBy: asc(devices.id) } }
		}),
		rooms: await db
			.select({ id: rooms.id, name: rooms.name, floor: floors.name })
			.from(rooms)
			.leftJoin(floors, eq(rooms.floorId, floors.id))
			.orderBy(asc(floors.level), asc(rooms.name))
			.all()
	};
};
