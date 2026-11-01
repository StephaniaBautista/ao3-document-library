CREATE TABLE `translation_cache_refs` (
	`id` text PRIMARY KEY NOT NULL,
	`cache_id` text NOT NULL,
	`story_id` text NOT NULL,
	FOREIGN KEY (`cache_id`) REFERENCES `translation_cache`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`story_id`) REFERENCES `shared_stories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `translation_cache_story` ON `translation_cache_refs` (`cache_id`,`story_id`);--> statement-breakpoint
CREATE INDEX `translation_cache_refs_story` ON `translation_cache_refs` (`story_id`);