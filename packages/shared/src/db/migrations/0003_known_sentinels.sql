ALTER TABLE `emails` ADD `queued_at` integer;--> statement-breakpoint
ALTER TABLE `emails` ADD `send_attempts` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `emails` ADD `last_send_error` text;--> statement-breakpoint
ALTER TABLE `emails` ADD `last_send_attempt_at` integer;