-- Moves to the Breakerbook data model: items (was devices) can be on several breakers.
ALTER TABLE `panels` ADD `numbering` text DEFAULT 'odd_left_even_right' NOT NULL;--> statement-breakpoint
ALTER TABLE `breakers` ADD `last_checked_at` integer;--> statement-breakpoint
ALTER TABLE `breakers` ADD `is_spare` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `breakers` DROP COLUMN `color`;--> statement-breakpoint
ALTER TABLE `floors` ADD `plan_opacity` real DEFAULT 0.35 NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `kind` text DEFAULT 'interior' NOT NULL;--> statement-breakpoint
CREATE TABLE `items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text DEFAULT 'outlet' NOT NULL,
	`name` text NOT NULL,
	`floor_id` integer,
	`room_id` integer,
	`x` real,
	`y` real,
	`z` real,
	`critical` integer DEFAULT false NOT NULL,
	`critical_note` text,
	`notes` text,
	FOREIGN KEY (`floor_id`) REFERENCES `floors`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `items_floor_idx` ON `items` (`floor_id`);--> statement-breakpoint
CREATE INDEX `items_room_idx` ON `items` (`room_id`);--> statement-breakpoint
-- The four item types stay; hardwired, sub-panel and other become appliances. An item's floor
-- used to come from its room; a position without a floor can't be shown, so it's dropped.
INSERT INTO `items` (`id`, `type`, `name`, `floor_id`, `room_id`, `x`, `y`, `z`, `notes`)
SELECT d.`id`,
	CASE WHEN d.`kind` IN ('outlet', 'light', 'switch', 'appliance') THEN d.`kind` ELSE 'appliance' END,
	d.`name`, r.`floor_id`, d.`room_id`,
	CASE WHEN r.`floor_id` IS NULL THEN NULL ELSE d.`pos_x` END,
	CASE WHEN r.`floor_id` IS NULL THEN NULL ELSE d.`pos_y` END,
	d.`pos_z`, d.`notes`
FROM `devices` d LEFT JOIN `rooms` r ON r.`id` = d.`room_id`;--> statement-breakpoint
CREATE TABLE `item_breakers` (
	`item_id` integer NOT NULL,
	`breaker_id` integer NOT NULL,
	PRIMARY KEY(`item_id`, `breaker_id`),
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`breaker_id`) REFERENCES `breakers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `item_breakers_breaker_idx` ON `item_breakers` (`breaker_id`);--> statement-breakpoint
INSERT INTO `item_breakers` (`item_id`, `breaker_id`)
SELECT `id`, `breaker_id` FROM `devices` WHERE `breaker_id` IS NOT NULL;--> statement-breakpoint
DROP TABLE `devices`;--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`home_name` text DEFAULT 'Home' NOT NULL,
	`start_page` text DEFAULT 'panel' NOT NULL,
	`theme` text DEFAULT 'system' NOT NULL,
	`show_legs` integer DEFAULT true NOT NULL,
	`map_fade_others` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
INSERT INTO `settings` (`id`) VALUES (1);
