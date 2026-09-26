-- Map layout editing (DESIGN.md §5.10): plan image transform and a per-floor scale, room shapes
-- as rect or polygon, and handle-tied breakers.
ALTER TABLE `floors` ADD `plan_offset_x` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `floors` ADD `plan_offset_y` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `floors` ADD `plan_scale` real DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `floors` ADD `plan_rotation` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `floors` ADD `plan_locked` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `floors` ADD `units_per_ft` real;--> statement-breakpoint
-- Only floors that had a scale measured keep one; the old default (1 unit = 1 cm) wasn't a measurement.
UPDATE `floors` SET `units_per_ft` = 0.3048 / `meters_per_unit` WHERE `meters_per_unit` > 0;--> statement-breakpoint
ALTER TABLE `floors` DROP COLUMN `meters_per_unit`;--> statement-breakpoint
ALTER TABLE `rooms` ADD `shape` text;--> statement-breakpoint
-- Outlines drawn as rectangles (top-left, clockwise) become rect shapes; anything else a polygon.
UPDATE `rooms` SET `shape` = CASE
	WHEN json_array_length(`outline`) = 4
		AND json_extract(`outline`, '$[0][1]') = json_extract(`outline`, '$[1][1]')
		AND json_extract(`outline`, '$[1][0]') = json_extract(`outline`, '$[2][0]')
		AND json_extract(`outline`, '$[2][1]') = json_extract(`outline`, '$[3][1]')
		AND json_extract(`outline`, '$[3][0]') = json_extract(`outline`, '$[0][0]')
		AND json_extract(`outline`, '$[1][0]') > json_extract(`outline`, '$[0][0]')
		AND json_extract(`outline`, '$[2][1]') > json_extract(`outline`, '$[1][1]')
	THEN json_object(
		'type', 'rect',
		'x', json_extract(`outline`, '$[0][0]'),
		'y', json_extract(`outline`, '$[0][1]'),
		'w', json_extract(`outline`, '$[1][0]') - json_extract(`outline`, '$[0][0]'),
		'h', json_extract(`outline`, '$[2][1]') - json_extract(`outline`, '$[1][1]'))
	ELSE json_object('type', 'polygon', 'points', json(`outline`))
END WHERE `outline` IS NOT NULL AND json_valid(`outline`) AND json_array_length(`outline`) >= 3;--> statement-breakpoint
ALTER TABLE `rooms` DROP COLUMN `outline`;--> statement-breakpoint
ALTER TABLE `breakers` ADD `tie_group` integer;
