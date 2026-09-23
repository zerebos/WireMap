import { db } from './db';
import { panels, breakers, floors, rooms, devices } from './db/schema';

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
				{ name: 'Main floor', level: 0 },
				{ name: 'Upstairs', level: 1 }
			])
			.returning()
			.all();

		const [kitchen, living, garage, bedroom] = tx
			.insert(rooms)
			.values([
				{ name: 'Kitchen', floorId: main.id },
				{ name: 'Living room', floorId: main.id },
				{ name: 'Garage', floorId: main.id },
				{ name: 'Primary bedroom', floorId: upstairs.id }
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
				{ name: 'Left of sink', kind: 'outlet', breakerId: byLabel['Kitchen counter'], roomId: kitchen.id },
				{ name: 'By fridge', kind: 'outlet', breakerId: byLabel['Kitchen counter'], roomId: kitchen.id },
				{ name: 'Island', kind: 'outlet', breakerId: byLabel['Kitchen island'], roomId: kitchen.id },
				{ name: 'Range', kind: 'appliance', breakerId: byLabel['Range'], roomId: kitchen.id },
				{ name: 'Ceiling light', kind: 'light', breakerId: byLabel['Living room'], roomId: living.id },
				{ name: 'Light switch by door', kind: 'switch', breakerId: byLabel['Living room'], roomId: living.id },
				{ name: 'TV wall', kind: 'outlet', breakerId: byLabel['Living room'], roomId: living.id },
				{ name: 'Bedside left', kind: 'outlet', breakerId: byLabel['Primary bedroom'], roomId: bedroom.id },
				{ name: 'Workbench', kind: 'outlet', breakerId: byLabel['Garage'], roomId: garage.id },
				{ name: 'Door opener', kind: 'hardwired', breakerId: byLabel['Garage'], roomId: garage.id },
				{ name: 'Dryer', kind: 'appliance', breakerId: byLabel['Dryer'], roomId: garage.id },
				{ name: 'Water heater', kind: 'appliance', breakerId: byLabel['Water heater'], roomId: garage.id }
			])
			.run();
	});
}
