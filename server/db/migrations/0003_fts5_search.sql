-- FTS5 virtual table for email search (subject and content)
CREATE VIRTUAL TABLE IF NOT EXISTS emails_fts USING fts5(
  subject,
  content_text,
  content='emails',
  content_rowid='id'
);
--> statement-breakpoint
-- FTS5 virtual table for contact search (name and email)
CREATE VIRTUAL TABLE IF NOT EXISTS contacts_fts USING fts5(
  name,
  email,
  content='contacts',
  content_rowid='id'
);
--> statement-breakpoint
-- FTS5 virtual table for attachment search (filename and extracted text)
CREATE VIRTUAL TABLE IF NOT EXISTS attachments_fts USING fts5(
  filename,
  extracted_text,
  content='attachments',
  content_rowid='id'
);
--> statement-breakpoint
-- Populate FTS tables with existing data
INSERT INTO emails_fts(rowid, subject, content_text)
SELECT id, subject, content_text FROM emails;
--> statement-breakpoint
INSERT INTO contacts_fts(rowid, name, email)
SELECT id, COALESCE(name, ''), email FROM contacts;
--> statement-breakpoint
INSERT INTO attachments_fts(rowid, filename, extracted_text)
SELECT id, filename, COALESCE(extracted_text, '') FROM attachments;
--> statement-breakpoint
-- Email triggers
CREATE TRIGGER IF NOT EXISTS emails_ai AFTER INSERT ON emails BEGIN
  INSERT INTO emails_fts(rowid, subject, content_text) VALUES (new.id, new.subject, new.content_text);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS emails_ad AFTER DELETE ON emails BEGIN
  INSERT INTO emails_fts(emails_fts, rowid, subject, content_text) VALUES('delete', old.id, old.subject, old.content_text);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS emails_au AFTER UPDATE ON emails BEGIN
  INSERT INTO emails_fts(emails_fts, rowid, subject, content_text) VALUES('delete', old.id, old.subject, old.content_text);
  INSERT INTO emails_fts(rowid, subject, content_text) VALUES (new.id, new.subject, new.content_text);
END;
--> statement-breakpoint
-- Contact triggers
CREATE TRIGGER IF NOT EXISTS contacts_ai AFTER INSERT ON contacts BEGIN
  INSERT INTO contacts_fts(rowid, name, email) VALUES (new.id, COALESCE(new.name, ''), new.email);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS contacts_ad AFTER DELETE ON contacts BEGIN
  INSERT INTO contacts_fts(contacts_fts, rowid, name, email) VALUES('delete', old.id, COALESCE(old.name, ''), old.email);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS contacts_au AFTER UPDATE ON contacts BEGIN
  INSERT INTO contacts_fts(contacts_fts, rowid, name, email) VALUES('delete', old.id, COALESCE(old.name, ''), old.email);
  INSERT INTO contacts_fts(rowid, name, email) VALUES (new.id, COALESCE(new.name, ''), new.email);
END;
--> statement-breakpoint
-- Attachment triggers
CREATE TRIGGER IF NOT EXISTS attachments_ai AFTER INSERT ON attachments BEGIN
  INSERT INTO attachments_fts(rowid, filename, extracted_text) VALUES (new.id, new.filename, COALESCE(new.extracted_text, ''));
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS attachments_ad AFTER DELETE ON attachments BEGIN
  INSERT INTO attachments_fts(attachments_fts, rowid, filename, extracted_text) VALUES('delete', old.id, old.filename, COALESCE(old.extracted_text, ''));
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS attachments_au AFTER UPDATE ON attachments BEGIN
  INSERT INTO attachments_fts(attachments_fts, rowid, filename, extracted_text) VALUES('delete', old.id, old.filename, COALESCE(old.extracted_text, ''));
  INSERT INTO attachments_fts(rowid, filename, extracted_text) VALUES (new.id, new.filename, COALESCE(new.extracted_text, ''));
END;
