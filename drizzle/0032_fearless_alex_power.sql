ALTER TABLE `drive_import_items` ADD `story_id` text REFERENCES shared_stories(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `drive_import_items` ADD `duplicate` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `drive_import_items` SET `story_id` = `id` WHERE EXISTS (SELECT 1 FROM `shared_stories` WHERE `shared_stories`.`id` = `drive_import_items`.`id`);
