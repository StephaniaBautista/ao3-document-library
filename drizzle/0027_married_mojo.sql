ALTER TABLE `library_profiles` ADD `age_verification_state` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `library_profiles` ADD `age_verification_next_check_at` integer;