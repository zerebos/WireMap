import { error, redirect } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { resolve } from '$app/paths';
import { db } from '$lib/db';
import { BREAKER_KINDS, DEVICE_KINDS, breakers, devices, panels } from '$lib/db/schema';
import type { LocalAction } from '$lib/enhance';
import { invalid, reader } from '$lib/form';
import { checkFit } from '$lib/panel';

const panelId = (params: Record<string, string>) => {
	const id = Number(params.id);
	if (!Number.isInteger(id)) error(404, 'Panel not found');
	return id;
};

const getPanel = async (id: number) => {
	const panel = await db.query.panels.findFirst({ where: eq(panels.id, id) });
	if (!panel) error(404, 'Panel not found');
	return panel;
};

const panelHref = (id: number) => resolve('/panels/[id]', { id: String(id) });

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

export const actions: Record<string, LocalAction> = {
	updatePanel: async ({ params, data }) => {
		const panel = await getPanel(panelId(params));
		const f = reader(data);
		const name = f.str('name');
		const slotCount = f.int('slotCount') ?? panel.slotCount;
		if (!name) return invalid('Give the panel a name.');
		if (slotCount < 2 || slotCount > 84 || slotCount % 2) {
			return invalid('Slot count must be an even number between 2 and 84.');
		}
		const tooLow = (await existingBreakers(panel.id)).find((b) => b.slot + (b.poles - 1) * 2 > slotCount);
		if (tooLow) return invalid(`A breaker at slot ${tooLow.slot} wouldn't fit in ${slotCount} slots.`);
		await db
			.update(panels)
			.set({
				name,
				location: f.optStr('location'),
				mainAmps: f.int('mainAmps'),
				slotCount,
				notes: f.optStr('notes')
			})
			.where(eq(panels.id, panel.id));
	},

	deletePanel: async ({ params }) => {
		await db.delete(panels).where(eq(panels.id, panelId(params)));
		redirect(303, resolve('/'));
	},

	createBreaker: async ({ params, data }) => {
		const panel = await getPanel(panelId(params));
		const values = readBreaker(data);
		const problem = checkFit(values, panel.slotCount, await existingBreakers(panel.id));
		if (problem) return invalid(problem);
		const [created] = await db
			.insert(breakers)
			.values({ ...values, panelId: panel.id })
			.returning()
			.all();
		redirect(303, `${panelHref(panel.id)}?b=${created.id}`);
	},

	updateBreaker: async ({ params, data }) => {
		const panel = await getPanel(panelId(params));
		const id = reader(data).int('id');
		if (!id) return invalid('Missing breaker.');
		const values = readBreaker(data);
		const problem = checkFit({ ...values, id }, panel.slotCount, await existingBreakers(panel.id));
		if (problem) return invalid(problem);
		await db
			.update(breakers)
			.set(values)
			.where(and(eq(breakers.id, id), eq(breakers.panelId, panel.id)));
	},

	deleteBreaker: async ({ params, data }) => {
		const id = panelId(params);
		const breakerId = reader(data).int('id');
		if (breakerId) {
			await db.delete(breakers).where(and(eq(breakers.id, breakerId), eq(breakers.panelId, id)));
		}
		redirect(303, panelHref(id));
	},

	addDevice: async ({ data }) => {
		const breakerId = reader(data).int('breakerId');
		const values = readDevice(data);
		if (!values.name) return invalid('Give the device a name.');
		await db.insert(devices).values({ ...values, breakerId });
	},

	updateDevice: async ({ data }) => {
		const f = reader(data);
		const id = f.int('id');
		const values = readDevice(data);
		if (!id) return invalid('Missing device.');
		if (!values.name) return invalid('Give the device a name.');
		await db
			.update(devices)
			.set({ ...values, breakerId: f.int('breakerId') })
			.where(eq(devices.id, id));
	},

	deleteDevice: async ({ data }) => {
		const id = reader(data).int('id');
		if (id) await db.delete(devices).where(eq(devices.id, id));
	}
};
