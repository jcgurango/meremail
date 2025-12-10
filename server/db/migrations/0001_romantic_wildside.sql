ALTER TABLE `emails` ADD `message_id` text;--> statement-breakpoint
ALTER TABLE `emails` ADD `in_reply_to` text;--> statement-breakpoint
ALTER TABLE `emails` ADD `references` text;--> statement-breakpoint
ALTER TABLE `emails` ADD `folder` text DEFAULT 'INBOX' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `emails_message_id_unique` ON `emails` (`message_id`);