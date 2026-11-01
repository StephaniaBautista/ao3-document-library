CREATE TABLE `library_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`blocked` integer DEFAULT false NOT NULL,
	`age_verified` integer DEFAULT false NOT NULL,
	`age_verification_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `shared_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `shared_folders_parent` ON `shared_folders` (`parent_id`);--> statement-breakpoint
CREATE TABLE `shared_stories` (
	`id` text PRIMARY KEY NOT NULL,
	`folder_id` text,
	`submitted_by` text,
	`filename` text NOT NULL,
	`file_type` text NOT NULL,
	`size` integer NOT NULL,
	`object_key` text NOT NULL,
	`content_hash` text NOT NULL,
	`title` text NOT NULL,
	`author` text,
	`summary` text,
	`fandom` text,
	`relationship` text,
	`tags` text,
	`warnings` text,
	`language` text,
	`ao3_url` text,
	`ao3_work_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`folder_id`) REFERENCES `shared_folders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`submitted_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shared_stories_object_key_unique` ON `shared_stories` (`object_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `shared_stories_content_hash_unique` ON `shared_stories` (`content_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `shared_stories_ao3_work_id_unique` ON `shared_stories` (`ao3_work_id`);--> statement-breakpoint
CREATE INDEX `shared_stories_folder` ON `shared_stories` (`folder_id`);--> statement-breakpoint
CREATE INDEX `shared_stories_title` ON `shared_stories` (`title`);