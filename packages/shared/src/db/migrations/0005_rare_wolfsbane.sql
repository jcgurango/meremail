CREATE TABLE `folders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`imap_folder` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `folders` (`id`, `name`, `imap_folder`, `position`, `created_at`) VALUES (1, 'Inbox', 'INBOX', 0, strftime('%s', 'now'));
--> statement-breakpoint
INSERT INTO `folders` (`id`, `name`, `imap_folder`, `position`, `created_at`) VALUES (2, 'Junk', 'Junk', 1, strftime('%s', 'now'));
--> statement-breakpoint
ALTER TABLE `email_threads` ADD `folder_id` integer REFERENCES folders(id);
--> statement-breakpoint
UPDATE `email_threads` SET `folder_id` = 2 WHERE `creator_id` IN (SELECT `id` FROM `contacts` WHERE `bucket` = 'quarantine');
--> statement-breakpoint
UPDATE `email_threads` SET `folder_id` = 1 WHERE `folder_id` IS NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_contacts_bucket`;
--> statement-breakpoint
ALTER TABLE `contacts` DROP COLUMN `bucket`;