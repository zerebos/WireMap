import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';
import { BREAKER_KINDS, DEVICE_KINDS } from '../../constants';

export { BREAKER_KINDS, DEVICE_KINDS };

// A breaker panel (main panel or sub-panel). Slots are numbered the usual US way:
// odd numbers down the left column, even numbers down the right.
export const panels = sqliteTable('panels', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	location: text('location'),
	mainAmps: integer('main_amps'),
	slotCount: integer('slot_count').notNull().default(24),
	// Set when this is a sub-panel fed from a breaker in another panel.
	fedByBreakerId: integer('fed_by_breaker_id'),
	notes: text('notes')
});

export const breakers = sqliteTable(
	'breakers',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		panelId: integer('panel_id')
			.notNull()
			.references(() => panels.id, { onDelete: 'cascade' }),
		// Top-most slot the breaker occupies. A 2-pole breaker also takes slot + 2.
		slot: integer('slot').notNull(),
		poles: integer('poles').notNull().default(1),
		amps: integer('amps').notNull().default(15),
		kind: text('kind', { enum: BREAKER_KINDS }).notNull().default('standard'),
		label: text('label').notNull().default(''),
		color: text('color'),
		notes: text('notes')
	},
	(t) => [index('breakers_panel_idx').on(t.panelId)]
);

// Floors and rooms give devices a place in the house. Plan geometry is optional so the
// 2D/3D map can be layered on later without changing how devices are linked.
export const floors = sqliteTable('floors', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	level: integer('level').notNull().default(0),
	// Height of the floor's base above ground, for a 3D view.
	elevation: real('elevation'),
	// Optional background image (e.g. a scanned floor plan) and its real-world scale.
	planImage: text('plan_image'),
	metersPerUnit: real('meters_per_unit')
});

export const rooms = sqliteTable('rooms', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	floorId: integer('floor_id').references(() => floors.id, { onDelete: 'set null' }),
	name: text('name').notNull(),
	// JSON array of [x, y] points outlining the room on its floor plan.
	outline: text('outline', { mode: 'json' }).$type<[number, number][]>()
});

// Anything on a circuit: outlets, switches, fixtures, appliances.
export const devices = sqliteTable(
	'devices',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		breakerId: integer('breaker_id').references(() => breakers.id, { onDelete: 'set null' }),
		roomId: integer('room_id').references(() => rooms.id, { onDelete: 'set null' }),
		kind: text('kind', { enum: DEVICE_KINDS }).notNull().default('outlet'),
		name: text('name').notNull(),
		notes: text('notes'),
		// Position on the room's floor plan (x, y) and height off the floor (z), all optional.
		posX: real('pos_x'),
		posY: real('pos_y'),
		posZ: real('pos_z')
	},
	(t) => [index('devices_breaker_idx').on(t.breakerId), index('devices_room_idx').on(t.roomId)]
);

export const panelsRelations = relations(panels, ({ many }) => ({ breakers: many(breakers) }));

export const breakersRelations = relations(breakers, ({ one, many }) => ({
	panel: one(panels, { fields: [breakers.panelId], references: [panels.id] }),
	devices: many(devices)
}));

export const floorsRelations = relations(floors, ({ many }) => ({ rooms: many(rooms) }));

export const roomsRelations = relations(rooms, ({ one, many }) => ({
	floor: one(floors, { fields: [rooms.floorId], references: [floors.id] }),
	devices: many(devices)
}));

export const devicesRelations = relations(devices, ({ one }) => ({
	breaker: one(breakers, { fields: [devices.breakerId], references: [breakers.id] }),
	room: one(rooms, { fields: [devices.roomId], references: [rooms.id] })
}));

export type Panel = typeof panels.$inferSelect;
export type Breaker = typeof breakers.$inferSelect;
export type Floor = typeof floors.$inferSelect;
export type Room = typeof rooms.$inferSelect;
export type Device = typeof devices.$inferSelect;
