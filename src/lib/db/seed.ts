import type { DB } from './index';
import { panels, breakers, breakerSpaces, floors, rooms, items, itemBreakers, planImages } from './schema';
import { deriveSpaces } from '../panel';
import house from '../../../docs/design/seed.json';
import { parseShape } from '../shape';
import mainFloorPlan from './main-floor.png?inline';

// Breakers the example house has already traced, as in the Trace mockup (docs/design/mockups/TracePick.dc.html).
const CHECKED = [1, 2, 5, 6, 9, 10, 11, 12, 13, 14, 15, 16, 20, 22];

/** The example house from the design handoff (docs/design/seed.json), so there's something to click on. */
export async function seed(db: DB) {
	const png = await fetch(mainFloorPlan).then((r) => r.arrayBuffer());
	await db.transaction(async (tx) => {
		const [panel] = await tx
			.insert(panels)
			.values(
				house.panels.map((p) => ({
					name: p.name,
					mainAmps: p.mainAmps,
					slotCount: p.spaces,
					numbering: 'odd_left_even_right' as const,
					location: p.location
				}))
			)
			.returning()
			.all();

		const bs = await tx
			.insert(breakers)
			.values(
				house.breakers.map((b) => ({
					panelId: panel.id,
					slot: b.slot,
					poles: b.poles,
					amps: b.amps,
					kind: b.protection as 'standard' | 'gfci' | 'afci' | 'dual',
					label: b.label ?? '',
					lastCheckedAt: CHECKED.includes(b.slot) ? Date.now() : null
				}))
			)
			.returning()
			.all();
		await tx.insert(breakerSpaces).values(bs.flatMap((b) => deriveSpaces(b, panel).map((sp) => ({ breakerId: b.id, ...sp }))));
		const bySlot = new Map(bs.map((b) => [b.slot, b.id]));

		await tx.insert(planImages).values({ name: 'main-floor.png', type: 'image/png', data: new Uint8Array(png) });
		const fs = await tx
			.insert(floors)
			.values(
				house.floors.map((f) => ({
					name: f.name,
					level: f.sort,
					planImage: f.planImage,
					planOpacity: f.planOpacity ?? 0.35,
					// The design's floors are drawn on an 820 × 760 canvas at 20 units to the foot.
					planWidth: 820,
					planHeight: 760,
					unitsPerFt: 20
				}))
			)
			.returning()
			.all();
		const floorId = new Map(house.floors.map((f, i) => [f.id, fs[i].id]));

		const rs = await tx
			.insert(rooms)
			.values(
				house.rooms.map((r) => ({
					floorId: floorId.get(r.floor)!,
					name: r.name,
					kind: r.kind as 'interior' | 'exterior',
					shape: parseShape(r.shape)
				}))
			)
			.returning()
			.all();
		const roomId = new Map(rs.map((r) => [`${r.floorId}/${r.name}`, r.id]));

		const is = await tx
			.insert(items)
			.values(
				house.items.map((i) => {
					const floor = floorId.get(i.floor)!;
					return {
						type: i.type as 'outlet' | 'light' | 'switch' | 'appliance',
						name: i.name,
						floorId: floor,
						roomId: roomId.get(`${floor}/${i.room}`) ?? null,
						x: i.x,
						y: i.y,
						critical: !!i.critical,
						criticalNote: i.critical?.note ?? null
					};
				})
			)
			.returning()
			.all();

		const links = house.items.flatMap((i, n) =>
			i.breakers.map((slot) => ({ itemId: is[n].id, breakerId: bySlot.get(slot)! }))
		);
		if (links.length) await tx.insert(itemBreakers).values(links);
	});
}
