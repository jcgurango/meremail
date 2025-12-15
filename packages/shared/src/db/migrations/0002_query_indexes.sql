-- Indexes for query optimization

-- Emails table indexes
CREATE INDEX IF NOT EXISTS idx_emails_thread_id ON emails(thread_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_emails_sender_id ON emails(sender_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_emails_sent_at ON emails(sent_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_emails_read_at ON emails(read_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_emails_status ON emails(status);
--> statement-breakpoint
-- Contacts table indexes
CREATE INDEX IF NOT EXISTS idx_contacts_bucket ON contacts(bucket);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_contacts_is_me ON contacts(is_me);
--> statement-breakpoint
-- Attachments table indexes
CREATE INDEX IF NOT EXISTS idx_attachments_email_id ON attachments(email_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_attachments_is_inline ON attachments(is_inline);
--> statement-breakpoint
-- Junction table indexes
CREATE INDEX IF NOT EXISTS idx_email_contacts_email_id ON email_contacts(email_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_email_contacts_contact_id ON email_contacts(contact_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_email_thread_contacts_thread_id ON email_thread_contacts(thread_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_email_thread_contacts_contact_id ON email_thread_contacts(contact_id);
--> statement-breakpoint
-- Thread creator indexes
CREATE INDEX IF NOT EXISTS idx_threads_creator_id ON email_threads(creator_id);
