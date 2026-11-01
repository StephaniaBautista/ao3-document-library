CREATE TABLE `object_deletions` (
	`object_key` text PRIMARY KEY NOT NULL,
	`queued_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `object_deletions_pending` ON `object_deletions` (`deleted_at`,`queued_at`);