CREATE TABLE `draft_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text,
	`size` integer,
	`file_path` text NOT NULL,
	`is_inline` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` integer,
	`sender_id` integer NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`content_text` text DEFAULT '' NOT NULL,
	`content_html` text,
	`in_reply_to` text,
	`forwarded_message_id` text,
	`references` text,
	`recipients` text NOT NULL,
	`rev` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `applied_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`result` text NOT NULL,
	`applied_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`seq` integer DEFAULT 0 NOT NULL,
	`tombstone_floor` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tombstones` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`rev` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `folders` ADD `rev` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `email_threads` ADD `rev` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `emails` ADD `rev` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `emails` ADD `meta_rev` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `contacts` ADD `rev` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `email_rules` ADD `rev` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- Move unsent drafts out of emails into the drafts table.
-- Recipients come from email_contacts plus the old pending_recipients JSON.
INSERT INTO `drafts` (`id`, `thread_id`, `sender_id`, `subject`, `content_text`, `content_html`, `in_reply_to`, `forwarded_message_id`, `references`, `recipients`, `rev`, `created_at`, `updated_at`)
SELECT
  'legacy-' || e.`id`, e.`thread_id`, e.`sender_id`, e.`subject`, e.`content_text`, e.`content_html`, e.`in_reply_to`, e.`forwarded_message_id`, e.`references`,
  (SELECT json_group_array(json(r.j)) FROM (
    SELECT json_object('contactId', c.`id`, 'email', c.`email`, 'name', c.`name`, 'role', ec.`role`) AS j
    FROM `email_contacts` ec JOIN `contacts` c ON c.`id` = ec.`contact_id`
    WHERE ec.`email_id` = e.`id` AND ec.`role` != 'from'
    UNION ALL
    SELECT json_object('email', json_extract(p.value, '$.email'), 'name', json_extract(p.value, '$.name'), 'role', json_extract(p.value, '$.role')) AS j
    FROM json_each(COALESCE(e.`pending_recipients`, '[]')) p
    WHERE json_extract(p.value, '$.email') IS NOT NULL
  ) r),
  0, e.`created_at`, e.`created_at`
FROM `emails` e WHERE e.`status` = 'draft';
--> statement-breakpoint
-- Draft uploads move with them. Attachment rows that share a file with another
-- row are copies made for forwards; those are re-created at send time instead.
INSERT INTO `draft_attachments` (`id`, `draft_id`, `filename`, `mime_type`, `size`, `file_path`, `is_inline`, `created_at`)
SELECT 'legacy-' || a.`id`, 'legacy-' || a.`email_id`, a.`filename`, a.`mime_type`, a.`size`, a.`file_path`, a.`is_inline`, a.`created_at`
FROM `attachments` a JOIN `emails` e ON e.`id` = a.`email_id`
WHERE e.`status` = 'draft'
  AND NOT EXISTS (SELECT 1 FROM `attachments` o WHERE o.`file_path` = a.`file_path` AND o.`id` != a.`id`);
--> statement-breakpoint
DELETE FROM `attachments` WHERE `email_id` IN (SELECT `id` FROM `emails` WHERE `status` = 'draft');
--> statement-breakpoint
DELETE FROM `email_contacts` WHERE `email_id` IN (SELECT `id` FROM `emails` WHERE `status` = 'draft');
--> statement-breakpoint
DELETE FROM `emails` WHERE `status` = 'draft';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_emails_rev` ON `emails` (`rev`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_emails_meta_rev` ON `emails` (`meta_rev`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_emails_received_at` ON `emails` (`received_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_email_threads_rev` ON `email_threads` (`rev`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_contacts_rev` ON `contacts` (`rev`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tombstones_rev` ON `tombstones` (`rev`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_drafts_thread_id` ON `drafts` (`thread_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_draft_attachments_draft_id` ON `draft_attachments` (`draft_id`);
--> statement-breakpoint
-- The FTS update triggers fired on every UPDATE, including ones that only
-- touch read state or rev. Limit them to the columns they index.
DROP TRIGGER IF EXISTS emails_au;
--> statement-breakpoint
CREATE TRIGGER emails_au AFTER UPDATE OF `subject`, `content_text` ON `emails` BEGIN
  INSERT INTO emails_fts(emails_fts, rowid, subject, content_text) VALUES('delete', old.id, old.subject, old.content_text);
  INSERT INTO emails_fts(rowid, subject, content_text) VALUES (new.id, new.subject, new.content_text);
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS contacts_au;
--> statement-breakpoint
CREATE TRIGGER contacts_au AFTER UPDATE OF `name`, `email` ON `contacts` BEGIN
  INSERT INTO contacts_fts(contacts_fts, rowid, name, email) VALUES('delete', old.id, COALESCE(old.name, ''), old.email);
  INSERT INTO contacts_fts(rowid, name, email) VALUES (new.id, COALESCE(new.name, ''), new.email);
END;
--> statement-breakpoint
-- Sync revisions. sync_state.seq is a global change counter; every change to
-- a synced table takes the next value and stamps it on the row, and every
-- delete leaves a tombstone. Clients ask for "everything with rev > cursor".
INSERT INTO `sync_state` (`id`, `seq`, `tombstone_floor`) VALUES (1, 1, 0);
--> statement-breakpoint
UPDATE `folders` SET `rev` = 1;
--> statement-breakpoint
UPDATE `contacts` SET `rev` = 1;
--> statement-breakpoint
UPDATE `email_threads` SET `rev` = 1;
--> statement-breakpoint
UPDATE `email_rules` SET `rev` = 1;
--> statement-breakpoint
UPDATE `drafts` SET `rev` = 1;
--> statement-breakpoint
UPDATE `emails` SET `rev` = 1, `meta_rev` = 1;
--> statement-breakpoint
CREATE TRIGGER folders_rev_ai AFTER INSERT ON `folders` BEGIN
  UPDATE sync_state SET seq = seq + 1 WHERE id = 1;
  UPDATE `folders` SET rev = (SELECT seq FROM sync_state WHERE id = 1) WHERE id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER folders_rev_au AFTER UPDATE ON `folders` WHEN new.rev = old.rev BEGIN
  UPDATE sync_state SET seq = seq + 1 WHERE id = 1;
  UPDATE `folders` SET rev = (SELECT seq FROM sync_state WHERE id = 1) WHERE id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER folders_rev_ad AFTER DELETE ON `folders` BEGIN
  UPDATE sync_state SET seq = seq + 1 WHERE id = 1;
  INSERT INTO tombstones (entity, entity_id, rev, created_at) VALUES ('folders', old.id, (SELECT seq FROM sync_state WHERE id = 1), CAST(strftime('%s', 'now') AS INTEGER));
END;
--> statement-breakpoint
CREATE TRIGGER contacts_rev_ai AFTER INSERT ON `contacts` BEGIN
  UPDATE sync_state SET seq = seq + 1 WHERE id = 1;
  UPDATE `contacts` SET rev = (SELECT seq FROM sync_state WHERE id = 1) WHERE id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER contacts_rev_au AFTER UPDATE ON `contacts` WHEN new.rev = old.rev BEGIN
  UPDATE sync_state SET seq = seq + 1 WHERE id = 1;
  UPDATE `contacts` SET rev = (SELECT seq FROM sync_state WHERE id = 1) WHERE id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER contacts_rev_ad AFTER DELETE ON `contacts` BEGIN
  UPDATE sync_state SET seq = seq + 1 WHERE id = 1;
  INSERT INTO tombstones (entity, entity_id, rev, created_at) VALUES ('contacts', old.id, (SELECT seq FROM sync_state WHERE id = 1), CAST(strftime('%s', 'now') AS INTEGER));
END;
--> statement-breakpoint
CREATE TRIGGER email_threads_rev_ai AFTER INSERT ON `email_threads` BEGIN
  UPDATE sync_state SET seq = seq + 1 WHERE id = 1;
  UPDATE `email_threads` SET rev = (SELECT seq FROM sync_state WHERE id = 1) WHERE id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER email_threads_rev_au AFTER UPDATE ON `email_threads` WHEN new.rev = old.rev BEGIN
  UPDATE sync_state SET seq = seq + 1 WHERE id = 1;
  UPDATE `email_threads` SET rev = (SELECT seq FROM sync_state WHERE id = 1) WHERE id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER email_threads_rev_ad AFTER DELETE ON `email_threads` BEGIN
  UPDATE sync_state SET seq = seq + 1 WHERE id = 1;
  INSERT INTO tombstones (entity, entity_id, rev, created_at) VALUES ('email_threads', old.id, (SELECT seq FROM sync_state WHERE id = 1), CAST(strftime('%s', 'now') AS INTEGER));
END;
--> statement-breakpoint
CREATE TRIGGER email_rules_rev_ai AFTER INSERT ON `email_rules` BEGIN
  UPDATE sync_state SET seq = seq + 1 WHERE id = 1;
  UPDATE `email_rules` SET rev = (SELECT seq FROM sync_state WHERE id = 1) WHERE id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER email_rules_rev_au AFTER UPDATE ON `email_rules` WHEN new.rev = old.rev BEGIN
  UPDATE sync_state SET seq = seq + 1 WHERE id = 1;
  UPDATE `email_rules` SET rev = (SELECT seq FROM sync_state WHERE id = 1) WHERE id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER email_rules_rev_ad AFTER DELETE ON `email_rules` BEGIN
  UPDATE sync_state SET seq = seq + 1 WHERE id = 1;
  INSERT INTO tombstones (entity, entity_id, rev, created_at) VALUES ('email_rules', old.id, (SELECT seq FROM sync_state WHERE id = 1), CAST(strftime('%s', 'now') AS INTEGER));
END;
--> statement-breakpoint
CREATE TRIGGER drafts_rev_ai AFTER INSERT ON `drafts` BEGIN
  UPDATE sync_state SET seq = seq + 1 WHERE id = 1;
  UPDATE `drafts` SET rev = (SELECT seq FROM sync_state WHERE id = 1) WHERE id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER drafts_rev_au AFTER UPDATE ON `drafts` WHEN new.rev = old.rev BEGIN
  UPDATE sync_state SET seq = seq + 1 WHERE id = 1;
  UPDATE `drafts` SET rev = (SELECT seq FROM sync_state WHERE id = 1) WHERE id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER drafts_rev_ad AFTER DELETE ON `drafts` BEGIN
  UPDATE sync_state SET seq = seq + 1 WHERE id = 1;
  INSERT INTO tombstones (entity, entity_id, rev, created_at) VALUES ('drafts', old.id, (SELECT seq FROM sync_state WHERE id = 1), CAST(strftime('%s', 'now') AS INTEGER));
END;
--> statement-breakpoint
-- Emails carry two revisions: rev for the email itself and meta_rev for
-- read state, so marking mail read doesn't resend bodies.
CREATE TRIGGER emails_rev_ai AFTER INSERT ON `emails` BEGIN
  UPDATE sync_state SET seq = seq + 1 WHERE id = 1;
  UPDATE `emails` SET rev = (SELECT seq FROM sync_state WHERE id = 1), meta_rev = (SELECT seq FROM sync_state WHERE id = 1) WHERE id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER emails_rev_au AFTER UPDATE OF `thread_id`, `sender_id`, `message_id`, `in_reply_to`, `forwarded_message_id`, `references`, `folder`, `status`, `subject`, `headers`, `content_text`, `content_html`, `sent_at`, `received_at`, `queued_at`, `send_attempts`, `last_send_error` ON `emails` BEGIN
  UPDATE sync_state SET seq = seq + 1 WHERE id = 1;
  UPDATE `emails` SET rev = (SELECT seq FROM sync_state WHERE id = 1) WHERE id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER emails_meta_rev_au AFTER UPDATE OF `read_at` ON `emails` WHEN new.read_at IS NOT old.read_at BEGIN
  UPDATE sync_state SET seq = seq + 1 WHERE id = 1;
  UPDATE `emails` SET meta_rev = (SELECT seq FROM sync_state WHERE id = 1) WHERE id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER emails_rev_ad AFTER DELETE ON `emails` BEGIN
  UPDATE sync_state SET seq = seq + 1 WHERE id = 1;
  INSERT INTO tombstones (entity, entity_id, rev, created_at) VALUES ('emails', old.id, (SELECT seq FROM sync_state WHERE id = 1), CAST(strftime('%s', 'now') AS INTEGER));
END;
--> statement-breakpoint
CREATE TRIGGER attachments_rev_ai AFTER INSERT ON `attachments` BEGIN
  UPDATE sync_state SET seq = seq + 1 WHERE id = 1;
  UPDATE `emails` SET rev = (SELECT seq FROM sync_state WHERE id = 1) WHERE id = new.email_id;
END;
--> statement-breakpoint
CREATE TRIGGER attachments_rev_ad AFTER DELETE ON `attachments` BEGIN
  UPDATE sync_state SET seq = seq + 1 WHERE id = 1;
  UPDATE `emails` SET rev = (SELECT seq FROM sync_state WHERE id = 1) WHERE id = old.email_id;
END;
--> statement-breakpoint
CREATE TRIGGER email_contacts_rev_ai AFTER INSERT ON `email_contacts` BEGIN
  UPDATE sync_state SET seq = seq + 1 WHERE id = 1;
  UPDATE `emails` SET rev = (SELECT seq FROM sync_state WHERE id = 1) WHERE id = new.email_id;
END;
--> statement-breakpoint
CREATE TRIGGER email_contacts_rev_ad AFTER DELETE ON `email_contacts` BEGIN
  UPDATE sync_state SET seq = seq + 1 WHERE id = 1;
  UPDATE `emails` SET rev = (SELECT seq FROM sync_state WHERE id = 1) WHERE id = old.email_id;
END;
--> statement-breakpoint
CREATE TRIGGER draft_attachments_rev_ai AFTER INSERT ON `draft_attachments` BEGIN
  UPDATE sync_state SET seq = seq + 1 WHERE id = 1;
  UPDATE `drafts` SET rev = (SELECT seq FROM sync_state WHERE id = 1) WHERE id = new.draft_id;
END;
--> statement-breakpoint
CREATE TRIGGER draft_attachments_rev_ad AFTER DELETE ON `draft_attachments` BEGIN
  UPDATE sync_state SET seq = seq + 1 WHERE id = 1;
  UPDATE `drafts` SET rev = (SELECT seq FROM sync_state WHERE id = 1) WHERE id = old.draft_id;
END;
