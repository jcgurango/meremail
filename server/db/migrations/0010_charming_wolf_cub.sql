ALTER TABLE `email_threads` ADD `reply_later_at` integer;--> statement-breakpoint
ALTER TABLE `email_threads` ADD `set_aside_at` integer;--> statement-breakpoint
ALTER TABLE `email_threads` DROP COLUMN `reply_later`;