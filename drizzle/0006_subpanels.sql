ALTER TABLE `panels` ADD `short_code` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `panels_short_code_idx` ON `panels` (`short_code`);
--> statement-breakpoint
CREATE UNIQUE INDEX `panels_fed_by_idx` ON `panels` (`fed_by_breaker_id`);