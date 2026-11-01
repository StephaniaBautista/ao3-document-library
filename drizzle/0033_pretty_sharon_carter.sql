CREATE TABLE `translation_browser_backup_segments` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`position` integer NOT NULL,
	`source_text` text NOT NULL,
	`translated_text` text,
	`state` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `translation_browser_backups`(`job_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `translation_browser_backup_segments_position` ON `translation_browser_backup_segments` (`job_id`,`position`);--> statement-breakpoint
CREATE TABLE `translation_browser_backups` (
	`job_id` text PRIMARY KEY NOT NULL,
	`reading_position` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `translation_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
