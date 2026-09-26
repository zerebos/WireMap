import { sqliteTable, text, integer, real, index, primaryKey, customType } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';
import type { Shape } from '../shape';
import { HALVES, PROTECTIONS, ITEM_TYPES, NUMBERINGS, START_PAGES, THEMES } from '../constants';

export { PROTECTIONS, ITEM_TYPES };

// A breaker panel (main panel or sub-panel). How slots are numbered is per panel; see panel.ts.
export const panels = sqliteTable('panels', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	// 1–3 letters that prefix a subpanel's breaker numbers ("G6"). Null for the main panel.
	shortCode: text('short_code'),
	location: text('location'),
	mainAmps: integer('main_amps'),
	// Number of spaces in the panel.
	slotCount: integer('slot_count').notNull().default(24),
	numbering: text('numbering', { enum: NUMBERINGS }).notNull().default('odd_left_even_right'),
	// Slots rated for tandem breakers, as printed on the panel label ("17-28"). Null = unknown:
	// tandems are allowed anywhere, with no warning.
	tandemSlots: text('tandem_slots'),
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
		// A or B for a tandem half (upper or lower half of the space); null = full size.
		half: text('half', { enum: HALVES }),
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
		isSpare: integer('is_spare', { mode: 'boolean' }).notNull().default(false),
		// Breakers sharing a value are handle-tied (a multi-wire circuit): kept next to each other
		// and shut off as one.
		tieGroup: integer('tie_group')
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
	// Size of the floor's drawing area in map units. Room shapes and item positions use the same
	// units. The plan image, if any, is drawn over that area, then moved, sized and turned by
	// the plan_* transform below.
	planWidth: real('plan_width').notNull().default(2000),
	planHeight: real('plan_height').notNull().default(1500),
	planOffsetX: real('plan_offset_x').notNull().default(0),
	planOffsetY: real('plan_offset_y').notNull().default(0),
	planScale: real('plan_scale').notNull().default(1),
	// 0, 90, 180 or 270 degrees, clockwise, about the image's centre.
	planRotation: integer('plan_rotation').notNull().default(0),
	planLocked: integer('plan_locked', { mode: 'boolean' }).notNull().default(false),
	// Real-world scale from Set scale. Null hides sizes.
	unitsPerFt: real('units_per_ft')
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
	// Where the room is on its floor, in map units. Null = not drawn yet.
	shape: text('shape', { mode: 'json' }).$type<Shape>()
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
// Which spaces each breaker takes (DATA-MODEL.md "Occupancy"). The source of truth: quad breakers
// pair across halves (21A + 23B), so it can't be derived from slot + half + poles. breakers.slot and
// breakers.half stay as the anchor (first space) for sorting.
export const breakerSpaces = sqliteTable(
	'breaker_spaces',
	{
		breakerId: integer('breaker_id')
			.notNull()
			.references(() => breakers.id, { onDelete: 'cascade' }),
		slot: integer('slot').notNull(),
		half: text('half', { enum: HALVES })
	},
	(t) => [index('breaker_spaces_breaker_idx').on(t.breakerId)]
);

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
	mapFadeOthers: integer('map_fade_others', { mode: 'boolean' }).notNull().default(true),
	/** Settings → Access → Read-only guest view (DESIGN.md §5.13). Without a server it locks this device. */
	guestReadOnly: integer('guest_read_only', { mode: 'boolean' }).notNull().default(false)
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
