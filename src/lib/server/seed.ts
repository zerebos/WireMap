import { db } from './db';
import { panels, breakers, floors, rooms, devices } from './db/schema';

const rect = (x1: number, y1: number, x2: number, y2: number): [number, number][] => [
	[x1, y1],
	[x2, y1],
	[x2, y2],
	[x1, y2]
];
const at = (posX: number, posY: number, posZ: number | null = null) => ({ posX, posY, posZ });

/** Fills an empty database with a small example house so there's something to click on. */
export function seedIfEmpty() {
	if (db.select({ id: panels.id }).from(panels).limit(1).all().length) return;

	db.transaction((tx) => {
		const [panel] = tx
			.insert(panels)
			.values({ name: 'Main panel', location: 'Garage', mainAmps: 200, slotCount: 24 })
			.returning()
			.all();

		const [main, upstairs] = tx
			.insert(floors)
			.values([
				// 14 m × 10 m at the default scale of 1 unit = 1 cm.
				{ name: 'Main floor', level: 0, planWidth: 1400, planHeight: 1000 },
				{ name: 'Upstairs', level: 1, planWidth: 1400, planHeight: 1000 }
			])
			.returning()
			.all();

		const [kitchen, living, garage, bedroom] = tx
			.insert(rooms)
			.values([
				{ name: 'Kitchen', floorId: main.id, outline: rect(600, 0, 1100, 450) },
				{
					name: 'Living room',
					floorId: main.id,
					outline: [[1100, 0], [1400, 0], [1400, 1000], [600, 1000], [600, 450], [1100, 450]]
				},
				{ name: 'Garage', floorId: main.id, outline: rect(0, 0, 600, 700) },
				{ name: 'Primary bedroom', floorId: upstairs.id, outline: rect(600, 0, 1100, 500) }
			])
			.returning()
			.all();

		const b = tx
			.insert(breakers)
			.values([
				{ panelId: panel.id, slot: 1, amps: 20, kind: 'gfci', label: 'Kitchen counter', color: '#e8a33d' },
				{ panelId: panel.id, slot: 2, amps: 20, kind: 'gfci', label: 'Kitchen island', color: '#e8a33d' },
				{ panelId: panel.id, slot: 3, poles: 2, amps: 40, label: 'Range' },
				{ panelId: panel.id, slot: 4, amps: 15, kind: 'afci', label: 'Living room', color: '#4f8fd6' },
				{ panelId: panel.id, slot: 6, amps: 15, kind: 'afci', label: 'Primary bedroom', color: '#8f6ad6' },
				{ panelId: panel.id, slot: 7, amps: 20, label: 'Garage', color: '#6a9f58' },
				{ panelId: panel.id, slot: 8, poles: 2, amps: 30, label: 'Dryer' },
				{ panelId: panel.id, slot: 11, poles: 2, amps: 30, label: 'Water heater' }
			])
			.returning()
			.all();
		const byLabel = Object.fromEntries(b.map((x) => [x.label, x.id]));

		tx.insert(devices)
			.values([
				{ name: 'Left of sink', kind: 'outlet', breakerId: byLabel['Kitchen counter'], roomId: kitchen.id, ...at(820, 15, 1.1) },
				{ name: 'By fridge', kind: 'outlet', breakerId: byLabel['Kitchen counter'], roomId: kitchen.id, ...at(1085, 220, 1.1) },
				{ name: 'Island', kind: 'outlet', breakerId: byLabel['Kitchen island'], roomId: kitchen.id, ...at(850, 260, 0.9) },
				{ name: 'Range', kind: 'appliance', breakerId: byLabel['Range'], roomId: kitchen.id, ...at(680, 30) },
				{ name: 'Ceiling light', kind: 'light', breakerId: byLabel['Living room'], roomId: living.id, ...at(1000, 720, 2.4) },
				{ name: 'Light switch by door', kind: 'switch', breakerId: byLabel['Living room'], roomId: living.id, ...at(640, 980, 1.2) },
				{ name: 'TV wall', kind: 'outlet', breakerId: byLabel['Living room'], roomId: living.id, ...at(1385, 600, 0.3) },
				{ name: 'Bedside left', kind: 'outlet', breakerId: byLabel['Primary bedroom'], roomId: bedroom.id, ...at(615, 250, 0.3) },
				{ name: 'Workbench', kind: 'outlet', breakerId: byLabel['Garage'], roomId: garage.id, ...at(15, 350, 1.1) },
				// Left off the map so the "not on the map yet" list has something in it.
				{ name: 'Door opener', kind: 'hardwired', breakerId: byLabel['Garage'], roomId: garage.id },
				{ name: 'Dryer', kind: 'appliance', breakerId: byLabel['Dryer'], roomId: garage.id, ...at(560, 80) },
				{ name: 'Water heater', kind: 'appliance', breakerId: byLabel['Water heater'], roomId: garage.id, ...at(560, 640) }
			])
			.run();
	});
}
