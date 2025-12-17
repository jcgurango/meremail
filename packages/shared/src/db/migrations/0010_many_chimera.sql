PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_rule_applications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rule_id` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`total_count` integer DEFAULT 0 NOT NULL,
	`processed_count` integer DEFAULT 0 NOT NULL,
	`matched_count` integer DEFAULT 0 NOT NULL,
	`match_breakdown` text,
	`error` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`rule_id`) REFERENCES `email_rules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_rule_applications`("id", "rule_id", "status", "total_count", "processed_count", "matched_count", "match_breakdown", "error", "started_at", "completed_at", "created_at") SELECT "id", "rule_id", "status", "total_count", "processed_count", "matched_count", '{}', "error", "started_at", "completed_at", "created_at" FROM `rule_applications`;--> statement-breakpoint
DROP TABLE `rule_applications`;--> statement-breakpoint
ALTER TABLE `__new_rule_applications` RENAME TO `rule_applications`;--> statement-breakpoint
PRAGMA foreign_keys=ON;