CREATE TABLE `removal_evidence_images` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`content_type` text NOT NULL,
	`data` blob NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `removal_requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `removal_evidence_images_request` ON `removal_evidence_images` (`request_id`);--> statement-breakpoint
ALTER TABLE `removal_requests` ADD `links` text DEFAULT '[]' NOT NULL;