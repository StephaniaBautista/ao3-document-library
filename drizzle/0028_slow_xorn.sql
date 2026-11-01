ALTER TABLE `translation_jobs` ADD `extraction_next_page` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `translation_jobs` ADD `extraction_next_position` integer DEFAULT 0 NOT NULL;