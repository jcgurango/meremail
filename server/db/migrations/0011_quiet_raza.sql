ALTER TABLE `emails` ADD `read_at` integer;--> statement-breakpoint
UPDATE `emails` SET `read_at` = `received_at` WHERE `is_read` = 1;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_emails_is_read`;--> statement-breakpoint
ALTER TABLE `emails` DROP COLUMN `is_read`;--> statement-breakpoint
CREATE INDEX `idx_emails_read_at` ON `emails` (`read_at`);
