DROP TABLE `sender_addresses`;--> statement-breakpoint
ALTER TABLE `emails` ADD `sender_id` integer NOT NULL;--> statement-breakpoint
ALTER TABLE `contacts` ADD `is_me` integer DEFAULT false NOT NULL;