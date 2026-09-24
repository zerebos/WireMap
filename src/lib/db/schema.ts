import { sqliteTable, text, integer, real, index, primaryKey, customType } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';
import { PROTECTIONS, ITEM_TYPES, NUMBERINGS, START_PAGES, THEMES } from '../constants';

export { PROTECTIONS, ITEM_TYPES };

// A breaker panel (main panel or sub-panel). How slots are numbered is per panel; see panel.ts.
export const panels = sqliteTable('panels', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	location: text('location'),
	mainAmps: integer('main_amps'),
	// Number of spaces in the panel.
	slotCount: integer('slot_count').notNull().default(24),
	numbering: text('numbering', { enum: NUMBERINGS }).notNull().default('odd_left_even_right'),
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
		// First slot the breaker occupies. A 2-pole breaker also takes slot + 2.
		slot: integer('slot').notNull(),
		poles: integer('poles').notNull().default(1),
		amps: integer('amps').notNull().default(15),
		// Protection: standard, GFCI, AFCI or dual function.
		kind: text('kind', { enum: PROTECTIONS }).notNull().default('standard'),
		// Empty means unlabeled.
		label: text('label').notNull().default(''),
		notes: text('notes'),
		// When a trace of this breaker was last saved (ms since epoch).
		lastCheckedAt: integer('last_checked_at'),
		// Traced and nothing went dark.
		isSpare: integer('is_spare', { mode: 'boolean' }).notNull().default(false)
	},
	(t) => [index('breakers_panel_idx').on(t.panelId)]
);

// Floors, bottom (level 0) to top. Room outlines and item positions are in the floor's plan units.
export const floors = sqliteTable('floors', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	// Stacking order, bottom = 0.
	level: integer('level').notNull().default(0),
	// Height of the floor's base above ground, for a 3D view.
	elevation: real('elevation'),
	// Optional background image (e.g. a scanned floor plan): the name of a row in plan_images.
	planImage: text('plan_image'),
	planOpacity: real('plan_opacity').notNull().default(0.35),
	// Size of the floor's drawing area in plan units. Room outlines and item positions use
	// the same units; the plan image, if any, is stretched over the whole area.
	planWidth: real('plan_width').notNull().default(2000),
	planHeight: real('plan_height').notNull().default(1500),
	// Real-world scale. The default of 0.01 makes one unit a centimetre.
	metersPerUnit: real('meters_per_unit')
});

// Uploaded floor plan images. They live in the database so a backup is one file. Each upload
// gets a new name, so a name always points at the same bytes.
// Raw bytes. Drizzle's own blob "buffer" mode needs Node's Buffer, which browsers don't have.
const bytes = customType<{ data: Uint8Array; driverData: Uint8Array }>({ dataType: () => 'blob' });

export const planImages = sqliteTable('plan_images', {
	name: text('name').primaryKey(),
	type: text('type').notNull(),
	data: bytes('data').notNull()
});

export const rooms = sqliteTable('rooms', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	floorId: integer('floor_id').references(() => floors.id, { onDelete: 'set null' }),
	name: text('name').notNull(),
	kind: text('kind', { enum: ['interior', 'exterior'] }).notNull().default('interior'),
	// JSON array of [x, y] points outlining the room on its floor plan. Null = not drawn yet.
	outline: text('outline', { mode: 'json' }).$type<[number, number][]>()
});

// Anything on a circuit: outlets, lights, switches, appliances.
export const items = sqliteTable(
	'items',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		type: text('type', { enum: ITEM_TYPES }).notNull().default('outlet'),
		name: text('name').notNull(),
		floorId: integer('floor_id').references(() => floors.id, { onDelete: 'cascade' }),
		roomId: integer('room_id').references(() => rooms.id, { onDelete: 'set null' }),
		// Position on the floor in plan units; null = not placed on the map. z is the height
		// above the floor in metres.
		x: real('x'),
		y: real('y'),
		z: real('z'),
		// Fridge, sump pump, furnace…: called out wherever an action cuts their power.
		critical: integer('critical', { mode: 'boolean' }).notNull().default(false),
		criticalNote: text('critical_note'),
		notes: text('notes')
	},
	(t) => [index('items_floor_idx').on(t.floorId), index('items_room_idx').on(t.roomId)]
);

// Which breakers feed an item. Usually one; none = "No breaker"; several for a switch box on
// two circuits or a multi-wire branch circuit.
export const itemBreakers = sqliteTable(
	'item_breakers',
	{
		itemId: integer('item_id')
			.notNull()
			.references(() => items.id, { onDelete: 'cascade' }),
		breakerId: integer('breaker_id')
			.notNull()
			.references(() => breakers.id, { onDelete: 'cascade' })
	},
	(t) => [primaryKey({ columns: [t.itemId, t.breakerId] }), index('item_breakers_breaker_idx').on(t.breakerId)]
);

// App preferences. A single row, id 1.
export const settings = sqliteTable('settings', {
	id: integer('id').primaryKey(),
	homeName: text('home_name').notNull().default('Home'),
	startPage: text('start_page', { enum: START_PAGES }).notNull().default('panel'),
	theme: text('theme', { enum: THEMES }).notNull().default('system'),
	showLegs: integer('show_legs', { mode: 'boolean' }).notNull().default(true),
	mapFadeOthers: integer('map_fade_others', { mode: 'boolean' }).notNull().default(true)
});

export const panelsRelations = relations(panels, ({ many }) => ({ breakers: many(breakers) }));

export const breakersRelations = relations(breakers, ({ one, many }) => ({
	panel: one(panels, { fields: [breakers.panelId], references: [panels.id] }),
	items: many(itemBreakers)
}));

export const floorsRelations = relations(floors, ({ many }) => ({ rooms: many(rooms), items: many(items) }));

export const roomsRelations = relations(rooms, ({ one, many }) => ({
	floor: one(floors, { fields: [rooms.floorId], references: [floors.id] }),
	items: many(items)
}));

export const itemsRelations = relations(items, ({ one, many }) => ({
	floor: one(floors, { fields: [items.floorId], references: [floors.id] }),
	room: one(rooms, { fields: [items.roomId], references: [rooms.id] }),
	breakers: many(itemBreakers)
}));

export const itemBreakersRelations = relations(itemBreakers, ({ one }) => ({
	item: one(items, { fields: [itemBreakers.itemId], references: [items.id] }),
	breaker: one(breakers, { fields: [itemBreakers.breakerId], references: [breakers.id] })
}));

export type Panel = typeof panels.$inferSelect;
export type Breaker = typeof breakers.$inferSelect;
export type Floor = typeof floors.$inferSelect;
export type Room = typeof rooms.$inferSelect;
export type Item = typeof items.$inferSelect;
export type Settings = typeof settings.$inferSelect;
export type PlanImage = typeof planImages.$inferSelect;
