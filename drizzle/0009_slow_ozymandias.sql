CREATE TABLE `translation_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`target_language` text NOT NULL,
	`translated_text` text NOT NULL,
	`created_at` integer NOT NULL
);
