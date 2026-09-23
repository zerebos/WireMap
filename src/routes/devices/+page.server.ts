import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { breakers, devices, floors, panels, rooms } from '$lib/server/db/schema';

export const load = () => ({
	devices: db
		.select({
			id: devices.id,
			name: devices.name,
			kind: devices.kind,
			notes: devices.notes,
			room: rooms.name,
			floor: floors.name,
			breakerId: breakers.id,
			breakerSlot: breakers.slot,
			breakerLabel: breakers.label,
			amps: breakers.amps,
			panelId: panels.id,
			panel: panels.name
		})
		.from(devices)
		.leftJoin(breakers, eq(devices.breakerId, breakers.id))
		.leftJoin(panels, eq(breakers.panelId, panels.id))
		.leftJoin(rooms, eq(devices.roomId, rooms.id))
		.leftJoin(floors, eq(rooms.floorId, floors.id))
		.orderBy(asc(floors.level), asc(rooms.name), asc(devices.name))
		.all()
});
