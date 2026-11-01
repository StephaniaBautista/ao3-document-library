CREATE TABLE `private_drive_connections` (
	`user_id` text PRIMARY KEY NOT NULL,
	`refresh_token_ciphertext` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
