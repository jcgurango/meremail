ALTER TABLE `attachments` ADD `content_id` text;--> statement-breakpoint
ALTER TABLE `attachments` ADD `is_inline` integer DEFAULT false NOT NULL;