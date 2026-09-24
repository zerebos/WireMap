import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { DEVICE_KINDS, devices, floors, rooms } from '$lib/db/schema';
import type { LocalAction } from '$lib/enhance';
import { invalid, reader } from '$lib/form';
import { PLAN_TYPES, deletePlan, savePlan } from '$lib/plans';
import { DEFAULT_METERS_PER_UNIT, parseOutline, roomAt, toMeters, type Point } from '$lib/geometry';

const getFloor = async (id: number | null) =>
	id ? await db.select().from(floors).where(eq(floors.id, id)).get() : undefined;

const floorRooms = async (floorId: number) =>
	(
		await db
			.select({ id: rooms.id, floorId: rooms.floorId, outline: rooms.outline })
			.from(rooms)
			.where(eq(rooms.floorId, floorId))
			.all()
	).map((r) => ({ ...r, outline: parseOutline(r.outline) }));

/** Reads an x/y pair and checks it lies on the floor's drawing area. */
function readPoint(f: ReturnType<typeof reader>, floor: { planWidth: number; planHeight: number }) {
	const x = f.num('x');
	const y = f.num('y');
	if (x === null || y === null) return null;
	if (x < 0 || y < 0 || x > floor.planWidth || y > floor.planHeight) return null;
	return [x, y] as Point;
}

/**
 * Works out which room a point on the map belongs to. A point inside a room outline takes that
 * room. Outside every outline, a room already on this floor is kept (useful before outlines
 * are drawn); otherwise the item has no floor to live on, so that's an error.
 */
async function resolveRoom(floorId: number, p: Point, currentRoomId: number | null) {
	const onFloor = await floorRooms(floorId);
	const hit = roomAt(p, onFloor);
	if (hit) return { roomId: hit.id };
	if (currentRoomId && onFloor.some((r) => r.id === currentRoomId)) return { roomId: currentRoomId };
	return {
		error: onFloor.length
			? 'Put it inside a room on this floor, or pick its room first.'
			: 'This floor has no rooms yet. Draw a room first.'
	};
}

/** Height above the floor, sent in the unit shown on screen (cm or in), stored in metres. */
function height(f: ReturnType<typeof reader>) {
	const v = f.num('height');
	return v === null ? null : toMeters(v, f.str('heightUnit'));
}

export const actions: Record<string, LocalAction> = {
	saveOutline: async ({ data }) => {
		const f = reader(data);
		const floor = await getFloor(f.int('floorId'));
		if (!floor) return invalid('Floor not found.');
		let outline: Point[] | null = null;
		try {
			outline = parseOutline(JSON.parse(f.str('outline')));
		} catch {
			// Reported below.
		}
		if (!outline) return invalid('A room outline needs at least three corners.');
		const roomId = f.int('roomId');
		if (roomId) {
			await db.update(rooms).set({ outline, floorId: floor.id }).where(eq(rooms.id, roomId));
			return { roomId };
		}
		const name = f.str('name');
		if (!name) return invalid('Give the room a name.');
		const [room] = await db.insert(rooms).values({ name, floorId: floor.id, outline }).returning().all();
		return { roomId: room.id };
	},

	updateRoom: async ({ data }) => {
		const f = reader(data);
		const id = f.int('id');
		const name = f.str('name');
		if (!id || !name) return invalid('Give the room a name.');
		await db.update(rooms).set({ name }).where(eq(rooms.id, id));
	},

	clearOutline: async ({ data }) => {
		const id = reader(data).int('id');
		if (id) await db.update(rooms).set({ outline: null }).where(eq(rooms.id, id));
	},

	placeDevice: async ({ data }) => {
		const f = reader(data);
		const floor = await getFloor(f.int('floorId'));
		const device = await db
			.select()
			.from(devices)
			.where(eq(devices.id, f.int('id') ?? 0))
			.get();
		if (!floor || !device) return invalid('Item not found.');
		const p = readPoint(f, floor);
		if (!p) return invalid('That spot is off the map.');
		const room = await resolveRoom(floor.id, p, device.roomId);
		if (room.error) return invalid(room.error);
		await db
			.update(devices)
			.set({ posX: p[0], posY: p[1], roomId: room.roomId })
			.where(eq(devices.id, device.id));
	},

	unplaceDevice: async ({ data }) => {
		const id = reader(data).int('id');
		if (id) await db.update(devices).set({ posX: null, posY: null }).where(eq(devices.id, id));
	},

	createDevice: async ({ data }) => {
		const f = reader(data);
		const floor = await getFloor(f.int('floorId'));
		if (!floor) return invalid('Floor not found.');
		const p = readPoint(f, floor);
		if (!p) return invalid('That spot is off the map.');
		const name = f.str('name');
		if (!name) return invalid('Give the item a name.');
		const room = await resolveRoom(floor.id, p, f.int('roomId'));
		if (room.error) return invalid(room.error);
		const [created] = await db
			.insert(devices)
			.values({
				name,
				kind: f.oneOf('kind', DEVICE_KINDS, 'outlet'),
				breakerId: f.int('breakerId'),
				roomId: room.roomId,
				posX: p[0],
				posY: p[1],
				posZ: height(f)
			})
			.returning()
			.all();
		return { deviceId: created.id };
	},

	updateDevice: async ({ data }) => {
		const f = reader(data);
		const id = f.int('id');
		const name = f.str('name');
		if (!id) return invalid('Item not found.');
		if (!name) return invalid('Give the item a name.');
		await db
			.update(devices)
			.set({
				name,
				kind: f.oneOf('kind', DEVICE_KINDS, 'outlet'),
				breakerId: f.int('breakerId'),
				posZ: height(f),
				notes: f.optStr('notes')
			})
			.where(eq(devices.id, id));
	},

	updateFloor: async ({ data }) => {
		const f = reader(data);
		const floor = await getFloor(f.int('id'));
		if (!floor) return invalid('Floor not found.');
		const name = f.str('name');
		// Sizes arrive in the unit shown on screen (m or ft).
		const unit = f.str('unit');
		const width = f.num('width');
		const depth = f.num('height');
		if (!name) return invalid('Give the floor a name.');
		if (!width || !depth || width <= 0 || depth <= 0) return invalid('Width and depth must be above zero.');
		const mpu = floor.metersPerUnit ?? DEFAULT_METERS_PER_UNIT;
		await db
			.update(floors)
			.set({ name, planWidth: toMeters(width, unit) / mpu, planHeight: toMeters(depth, unit) / mpu })
			.where(eq(floors.id, floor.id));
	},

	setScale: async ({ data }) => {
		const f = reader(data);
		const floor = await getFloor(f.int('id'));
		const metersPerUnit = f.num('metersPerUnit');
		if (!floor) return invalid('Floor not found.');
		if (!metersPerUnit || metersPerUnit <= 0) return invalid('Enter the real length of the line.');
		await db.update(floors).set({ metersPerUnit }).where(eq(floors.id, floor.id));
	},

	uploadPlan: async ({ data }) => {
		const f = reader(data);
		const floor = await getFloor(f.int('id'));
		if (!floor) return invalid('Floor not found.');
		const file = data.get('plan');
		if (!(file instanceof File) || !file.size) return invalid('Choose an image to upload.');
		if (!PLAN_TYPES[file.type]) return invalid('Floor plans can be PNG, JPG, WebP or GIF images.');
		// The image is stretched over the floor's current width; its aspect ratio sets the depth.
		const aspect = f.num('aspect');
		const planHeight =
			aspect && aspect > 0.05 && aspect < 20 ? floor.planWidth * aspect : floor.planHeight;
		const name = await savePlan(floor.id, file);
		await db.update(floors).set({ planImage: name, planHeight }).where(eq(floors.id, floor.id));
		await deletePlan(floor.planImage);
	},

	removePlan: async ({ data }) => {
		const floor = await getFloor(reader(data).int('id'));
		if (!floor) return invalid('Floor not found.');
		await db.update(floors).set({ planImage: null }).where(eq(floors.id, floor.id));
		await deletePlan(floor.planImage);
	}
};
