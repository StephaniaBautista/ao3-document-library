CREATE TABLE `reading_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`font_size` integer DEFAULT 100 NOT NULL,
	`font_family` text DEFAULT 'serif' NOT NULL,
	`line_height` text DEFAULT '1.6' NOT NULL,
	`background` text DEFAULT 'light' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
