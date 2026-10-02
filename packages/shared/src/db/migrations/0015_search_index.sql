-- Email search covered only the subject and body. Rebuild the index to also
-- cover the sender, the recipients and attachment names.
--
-- The old table mirrored the emails table (content='emails'), which limits it
-- to columns of that table. The new one stores only the search terms
-- (contentless); snippets are cut from emails.content_text by the server.
DROP TRIGGER IF EXISTS emails_ai;
--> statement-breakpoint
DROP TRIGGER IF EXISTS emails_ad;
--> statement-breakpoint
DROP TRIGGER IF EXISTS emails_au;
--> statement-breakpoint
DROP TABLE IF EXISTS emails_fts;
--> statement-breakpoint
CREATE VIRTUAL TABLE emails_fts USING fts5(
  subject,
  body,
  sender,
  recipients,
  filenames,
  content='',
  contentless_delete=1,
  tokenize='unicode61 remove_diacritics 2'
);
--> statement-breakpoint
-- What gets indexed for each email
CREATE VIEW emails_search_documents AS
  SELECT e.id AS id, e.subject AS subject, e.content_text AS body,
    (SELECT COALESCE(c.name, '') || ' ' || c.email FROM contacts c WHERE c.id = e.sender_id) AS sender,
    (SELECT group_concat(COALESCE(c.name, '') || ' ' || c.email, char(10)) FROM email_contacts ec JOIN contacts c ON c.id = ec.contact_id WHERE ec.email_id = e.id AND ec.role != 'from') AS recipients,
    (SELECT group_concat(a.filename, char(10)) FROM attachments a WHERE a.email_id = e.id AND a.is_inline = 0) AS filenames
  FROM emails e;
--> statement-breakpoint
INSERT INTO emails_fts(rowid, subject, body, sender, recipients, filenames) SELECT id, subject, body, sender, recipients, filenames FROM emails_search_documents;
--> statement-breakpoint
-- Keep the index in step with everything it is built from
CREATE TRIGGER emails_fts_ai AFTER INSERT ON `emails` BEGIN
  DELETE FROM emails_fts WHERE rowid = new.id;
  INSERT INTO emails_fts(rowid, subject, body, sender, recipients, filenames) SELECT id, subject, body, sender, recipients, filenames FROM emails_search_documents WHERE id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER emails_fts_au AFTER UPDATE OF `subject`, `content_text`, `sender_id` ON `emails` BEGIN
  DELETE FROM emails_fts WHERE rowid = new.id;
  INSERT INTO emails_fts(rowid, subject, body, sender, recipients, filenames) SELECT id, subject, body, sender, recipients, filenames FROM emails_search_documents WHERE id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER emails_fts_ad AFTER DELETE ON `emails` BEGIN
  DELETE FROM emails_fts WHERE rowid = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER emails_fts_contacts_ai AFTER INSERT ON `email_contacts` BEGIN
  DELETE FROM emails_fts WHERE rowid = new.email_id;
  INSERT INTO emails_fts(rowid, subject, body, sender, recipients, filenames) SELECT id, subject, body, sender, recipients, filenames FROM emails_search_documents WHERE id = new.email_id;
END;
--> statement-breakpoint
CREATE TRIGGER emails_fts_contacts_ad AFTER DELETE ON `email_contacts` BEGIN
  DELETE FROM emails_fts WHERE rowid = old.email_id;
  INSERT INTO emails_fts(rowid, subject, body, sender, recipients, filenames) SELECT id, subject, body, sender, recipients, filenames FROM emails_search_documents WHERE id = old.email_id;
END;
--> statement-breakpoint
CREATE TRIGGER emails_fts_attachments_ai AFTER INSERT ON `attachments` BEGIN
  DELETE FROM emails_fts WHERE rowid = new.email_id;
  INSERT INTO emails_fts(rowid, subject, body, sender, recipients, filenames) SELECT id, subject, body, sender, recipients, filenames FROM emails_search_documents WHERE id = new.email_id;
END;
--> statement-breakpoint
CREATE TRIGGER emails_fts_attachments_au AFTER UPDATE OF `filename`, `is_inline`, `email_id` ON `attachments` BEGIN
  DELETE FROM emails_fts WHERE rowid IN (SELECT id FROM emails e WHERE e.id IN (new.email_id, old.email_id));
  INSERT INTO emails_fts(rowid, subject, body, sender, recipients, filenames) SELECT id, subject, body, sender, recipients, filenames FROM emails_search_documents WHERE id IN (SELECT id FROM emails e WHERE e.id IN (new.email_id, old.email_id));
END;
--> statement-breakpoint
CREATE TRIGGER emails_fts_attachments_ad AFTER DELETE ON `attachments` BEGIN
  DELETE FROM emails_fts WHERE rowid = old.email_id;
  INSERT INTO emails_fts(rowid, subject, body, sender, recipients, filenames) SELECT id, subject, body, sender, recipients, filenames FROM emails_search_documents WHERE id = old.email_id;
END;
--> statement-breakpoint
-- Renaming a contact changes every email they sent or received
CREATE TRIGGER emails_fts_contact_names_au AFTER UPDATE OF `name`, `email` ON `contacts` BEGIN
  DELETE FROM emails_fts WHERE rowid IN (SELECT id FROM emails e WHERE e.sender_id = new.id OR e.id IN (SELECT email_id FROM email_contacts WHERE contact_id = new.id));
  INSERT INTO emails_fts(rowid, subject, body, sender, recipients, filenames) SELECT id, subject, body, sender, recipients, filenames FROM emails_search_documents WHERE id IN (SELECT id FROM emails e WHERE e.sender_id = new.id OR e.id IN (SELECT email_id FROM email_contacts WHERE contact_id = new.id));
END;
