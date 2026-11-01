CREATE TABLE `drive_connections` (
	`user_id` text PRIMARY KEY NOT NULL,
	`refresh_token_ciphertext` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `drive_import_items` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`drive_id` text NOT NULL,
	`name` text NOT NULL,
	`mime_type` text NOT NULL,
	`parent_folder_id` text,
	`page_token` text,
	`state` text DEFAULT 'pending' NOT NULL,
	`error` text,
	FOREIGN KEY (`job_id`) REFERENCES `drive_import_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_folder_id`) REFERENCES `shared_folders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `drive_import_job_file` ON `drive_import_items` (`job_id`,`drive_id`);--> statement-breakpoint
CREATE INDEX `drive_import_items_state` ON `drive_import_items` (`state`);--> statement-breakpoint
CREATE TABLE `drive_import_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `drive_oauth_states` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
