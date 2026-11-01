ALTER TABLE `translation_jobs` ADD `extraction_state` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `translation_jobs` ADD `extraction_claimed_at` integer;