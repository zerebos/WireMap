import { count, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { breakers, devices, floors, panels, planImages, rooms } from '$lib/db/schema';

const total = async (table: typeof panels | typeof breakers | typeof devices | typeof rooms | typeof floors) =>
	(await db.select({ n: count() }).from(table).get())?.n ?? 0;

export const load = async () => {
	const plans = await db
		.select({ n: count(), bytes: sql<number>`coalesce(sum(length(${planImages.data})), 0)` })
		.from(planImages)
		.get();
	return {
		counts: {
			panels: await total(panels),
			breakers: await total(breakers),
			items: await total(devices),
			rooms: await total(rooms),
			floors: await total(floors),
			plans: plans?.n ?? 0,
			planBytes: Number(plans?.bytes ?? 0)
		}
	};
};
