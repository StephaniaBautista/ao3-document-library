ALTER TABLE `drive_import_items` ADD `catalog_folder_id` text REFERENCES shared_folders(id);--> statement-breakpoint
ALTER TABLE `drive_import_items` ADD `updated_at` integer NOT NULL;