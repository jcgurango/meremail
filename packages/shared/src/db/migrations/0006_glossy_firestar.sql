CREATE TABLE `email_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`conditions` text NOT NULL,
	`action_type` text NOT NULL,
	`action_config` text,
	`position` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rule_applications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rule_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`total_count` integer DEFAULT 0 NOT NULL,
	`processed_count` integer DEFAULT 0 NOT NULL,
	`matched_count` integer DEFAULT 0 NOT NULL,
	`error` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`rule_id`) REFERENCES `email_rules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `folders` ADD `is_system` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `email_threads` ADD `previous_folder_id` integer REFERENCES folders(id);--> statement-breakpoint
ALTER TABLE `email_threads` ADD `trashed_at` integer;--> statement-breakpoint
ALTER TABLE `emails` ADD `trashed_at` integer;--> statement-breakpoint
-- Mark existing Inbox and Junk folders as system folders
UPDATE `folders` SET `is_system` = 1 WHERE `id` IN (1, 2);--> statement-breakpoint
-- Insert Trash folder as system folder
INSERT INTO `folders` (`id`, `name`, `imap_folder`, `position`, `is_system`, `created_at`)
VALUES (3, 'Trash', NULL, 2, 1, strftime('%s', 'now') * 1000);