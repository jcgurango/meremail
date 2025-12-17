ALTER TABLE `folders` ADD `notifications_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `folders` ADD `show_unread_count` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `folders` ADD `sync_offline` integer DEFAULT true NOT NULL;--> statement-breakpoint
-- Set correct defaults for system folders
-- Inbox (id=1): notifications enabled
UPDATE `folders` SET `notifications_enabled` = true WHERE `id` = 1;--> statement-breakpoint
-- Junk (id=2): hide unread count
UPDATE `folders` SET `show_unread_count` = false, `sync_offline` = false WHERE `id` = 2;--> statement-breakpoint
-- Trash (id=3): hide unread count, disable offline sync
UPDATE `folders` SET `show_unread_count` = false, `sync_offline` = false WHERE `id` = 3;