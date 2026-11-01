CREATE TABLE `notification_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`recovery_at` integer NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_user_recovery` ON `notification_batches` (`user_id`,`recovery_at`);--> statement-breakpoint
CREATE INDEX `notification_state` ON `notification_batches` (`state`);--> statement-breakpoint
CREATE TABLE `notification_items` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`reminder_id` text NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `notification_batches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reminder_id`) REFERENCES `reminders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_batch_reminder` ON `notification_items` (`batch_id`,`reminder_id`);