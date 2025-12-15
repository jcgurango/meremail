CREATE TABLE `email_threads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subject` text NOT NULL,
	`creator_id` integer,
	`reply_later_at` integer,
	`set_aside_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`creator_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `emails` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`thread_id` integer,
	`sender_id` integer NOT NULL,
	`message_id` text,
	`in_reply_to` text,
	`references` text,
	`folder` text DEFAULT 'INBOX' NOT NULL,
	`read_at` integer,
	`status` text DEFAULT 'sent' NOT NULL,
	`subject` text NOT NULL,
	`headers` text,
	`content_text` text NOT NULL,
	`content_html` text,
	`sent_at` integer,
	`received_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `email_threads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `emails_message_id_unique` ON `emails` (`message_id`);--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email_id` integer NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text,
	`size` integer,
	`file_path` text NOT NULL,
	`content_id` text,
	`is_inline` integer DEFAULT false NOT NULL,
	`extracted_text` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`email_id`) REFERENCES `emails`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text,
	`email` text NOT NULL,
	`is_me` integer DEFAULT false NOT NULL,
	`bucket` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_email_unique` ON `contacts` (`email`);--> statement-breakpoint
CREATE TABLE `email_contacts` (
	`email_id` integer NOT NULL,
	`contact_id` integer NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`email_id`, `contact_id`, `role`),
	FOREIGN KEY (`email_id`) REFERENCES `emails`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `email_thread_contacts` (
	`thread_id` integer NOT NULL,
	`contact_id` integer NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`thread_id`, `contact_id`, `role`),
	FOREIGN KEY (`thread_id`) REFERENCES `email_threads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action
);
