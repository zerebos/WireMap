CREATE TABLE `breaker_spaces` (
	`breaker_id` integer NOT NULL,
	`slot` integer NOT NULL,
	`half` text,
	FOREIGN KEY (`breaker_id`) REFERENCES `breakers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `breaker_spaces_breaker_idx` ON `breaker_spaces` (`breaker_id`);--> statement-breakpoint
INSERT INTO `breaker_spaces` (`breaker_id`, `slot`, `half`) SELECT `id`, `slot`, `half` FROM `breakers`;--> statement-breakpoint
INSERT INTO `breaker_spaces` (`breaker_id`, `slot`, `half`)
	SELECT b.`id`, b.`slot` + CASE p.`numbering` WHEN 'down_left_then_right' THEN 1 ELSE 2 END, NULL
	FROM `breakers` b JOIN `panels` p ON p.`id` = b.`panel_id` WHERE b.`poles` = 2;
