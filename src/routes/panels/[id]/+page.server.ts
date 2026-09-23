import { error, redirect } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	BREAKER_KINDS,
	DEVICE_KINDS,
	breakers,
	devices,
	floors,
	panels,
	rooms
} from '$lib/server/db/schema';
import { invalid, reader } from '$lib/server/form';
import { checkFit } from '$lib/panel';

const panelId = (params: { id: string }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id)) error(404, 'Panel not found');
	return id;
};

const getPanel = (id: number) => {
	const panel = db.query.panels.findFirst({ where: eq(panels.id, id) }).sync();
	if (!panel) error(404, 'Panel not found');
	return panel;
};

export const load = ({ params }) => {
	const panel = getPanel(panelId(params));
	return {
		panel,
		panels: db.select({ id: panels.id, name: panels.name }).from(panels).orderBy(asc(panels.id)).all(),
		breakers: db.query.breakers
			.findMany({
				where: eq(breakers.panelId, panel.id),
				orderBy: asc(breakers.slot),
				with: { devices: { orderBy: asc(devices.id) } }
			})
			.sync(),
		rooms: db
			.select({ id: rooms.id, name: rooms.name, floor: floors.name })
			.from(rooms)
			.leftJoin(floors, eq(rooms.floorId, floors.id))
			.orderBy(asc(floors.level), asc(rooms.name))
			.all()
	};
};

function readBreaker(data: FormData) {
	const f = reader(data);
	return {
		slot: f.int('slot') ?? 0,
		poles: f.int('poles') === 2 ? 2 : 1,
		amps: f.int('amps') ?? 15,
		kind: f.oneOf('kind', BREAKER_KINDS, 'standard'),
		label: f.str('label'),
		color: f.optStr('color'),
		notes: f.optStr('notes')
	};
}

function readDevice(data: FormData) {
	const f = reader(data);
	return {
		name: f.str('name'),
		kind: f.oneOf('kind', DEVICE_KINDS, 'outlet'),
		roomId: f.int('roomId'),
		notes: f.optStr('notes')
	};
}

const existingBreakers = (id: number) =>
	db
		.select({ id: breakers.id, slot: breakers.slot, poles: breakers.poles })
		.from(breakers)
		.where(eq(breakers.panelId, id))
		.all();

export const actions = {
	updatePanel: async ({ params, request }) => {
		const panel = getPanel(panelId(params));
		const f = reader(await request.formData());
		const name = f.str('name');
		const slotCount = f.int('slotCount') ?? panel.slotCount;
		if (!name) return invalid('Give the panel a name.');
		if (slotCount < 2 || slotCount > 84 || slotCount % 2) {
			return invalid('Slot count must be an even number between 2 and 84.');
		}
		const tooLow = existingBreakers(panel.id).find((b) => b.slot + (b.poles - 1) * 2 > slotCount);
		if (tooLow) return invalid(`A breaker at slot ${tooLow.slot} wouldn't fit in ${slotCount} slots.`);
		db.update(panels)
			.set({
				name,
				location: f.optStr('location'),
				mainAmps: f.int('mainAmps'),
				slotCount,
				notes: f.optStr('notes')
			})
			.where(eq(panels.id, panel.id))
			.run();
	},

	deletePanel: async ({ params }) => {
		db.delete(panels).where(eq(panels.id, panelId(params))).run();
		redirect(303, '/');
	},

	createBreaker: async ({ params, request }) => {
		const panel = getPanel(panelId(params));
		const values = readBreaker(await request.formData());
		const problem = checkFit(values, panel.slotCount, existingBreakers(panel.id));
		if (problem) return invalid(problem);
		const [created] = db
			.insert(breakers)
			.values({ ...values, panelId: panel.id })
			.returning()
			.all();
		redirect(303, `/panels/${panel.id}?b=${created.id}`);
	},

	updateBreaker: async ({ params, request }) => {
		const panel = getPanel(panelId(params));
		const data = await request.formData();
		const id = reader(data).int('id');
		if (!id) return invalid('Missing breaker.');
		const values = readBreaker(data);
		const problem = checkFit({ ...values, id }, panel.slotCount, existingBreakers(panel.id));
		if (problem) return invalid(problem);
		db.update(breakers)
			.set(values)
			.where(and(eq(breakers.id, id), eq(breakers.panelId, panel.id)))
			.run();
	},

	deleteBreaker: async ({ params, request }) => {
		const id = panelId(params);
		const breakerId = reader(await request.formData()).int('id');
		if (breakerId) {
			db.delete(breakers)
				.where(and(eq(breakers.id, breakerId), eq(breakers.panelId, id)))
				.run();
		}
		redirect(303, `/panels/${id}`);
	},

	addDevice: async ({ request }) => {
		const data = await request.formData();
		const breakerId = reader(data).int('breakerId');
		const values = readDevice(data);
		if (!values.name) return invalid('Give the device a name.');
		db.insert(devices)
			.values({ ...values, breakerId })
			.run();
	},

	updateDevice: async ({ request }) => {
		const data = await request.formData();
		const f = reader(data);
		const id = f.int('id');
		const values = readDevice(data);
		if (!id) return invalid('Missing device.');
		if (!values.name) return invalid('Give the device a name.');
		db.update(devices)
			.set({ ...values, breakerId: f.int('breakerId') })
			.where(eq(devices.id, id))
			.run();
	},

	deleteDevice: async ({ request }) => {
		const id = reader(await request.formData()).int('id');
		if (id) db.delete(devices).where(eq(devices.id, id)).run();
	}
};
