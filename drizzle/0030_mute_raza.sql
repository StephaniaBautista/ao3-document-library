DROP INDEX `drive_import_job_file`;--> statement-breakpoint
ALTER TABLE `drive_import_items` ADD `target_drive_id` text;--> statement-breakpoint
ALTER TABLE `drive_import_items` ADD `resource_key` text;--> statement-breakpoint
ALTER TABLE `drive_import_items` ADD `parent_item_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `drive_import_root_item` ON `drive_import_items` (`job_id`,`drive_id`) WHERE "drive_import_items"."parent_item_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `drive_import_child_item` ON `drive_import_items` (`job_id`,`parent_item_id`,`drive_id`) WHERE "drive_import_items"."parent_item_id" is not null;