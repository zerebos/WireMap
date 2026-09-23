CREATE TABLE `breakers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`panel_id` integer NOT NULL,
	`slot` integer NOT NULL,
	`poles` integer DEFAULT 1 NOT NULL,
	`amps` integer DEFAULT 15 NOT NULL,
	`kind` text DEFAULT 'standard' NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`color` text,
	`notes` text,
	FOREIGN KEY (`panel_id`) REFERENCES `panels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `breakers_panel_idx` ON `breakers` (`panel_id`);--> statement-breakpoint
CREATE TABLE `devices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`breaker_id` integer,
	`room_id` integer,
	`kind` text DEFAULT 'outlet' NOT NULL,
	`name` text NOT NULL,
	`notes` text,
	`pos_x` real,
	`pos_y` real,
	`pos_z` real,
	FOREIGN KEY (`breaker_id`) REFERENCES `breakers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `devices_breaker_idx` ON `devices` (`breaker_id`);--> statement-breakpoint
CREATE INDEX `devices_room_idx` ON `devices` (`room_id`);--> statement-breakpoint
CREATE TABLE `floors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`level` integer DEFAULT 0 NOT NULL,
	`elevation` real,
	`plan_image` text,
	`meters_per_unit` real
);
--> statement-breakpoint
CREATE TABLE `panels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`location` text,
	`main_amps` integer,
	`slot_count` integer DEFAULT 24 NOT NULL,
	`fed_by_breaker_id` integer,
	`notes` text
);
--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`floor_id` integer,
	`name` text NOT NULL,
	`outline` text,
	FOREIGN KEY (`floor_id`) REFERENCES `floors`(`id`) ON UPDATE no action ON DELETE set null
);
