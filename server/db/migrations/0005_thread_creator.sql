-- Add creator denormalization columns to email_threads
ALTER TABLE email_threads ADD COLUMN creator_id INTEGER REFERENCES contacts(id);
--> statement-breakpoint
ALTER TABLE email_threads ADD COLUMN creator_bucket TEXT;
--> statement-breakpoint
ALTER TABLE email_threads ADD COLUMN creator_is_me INTEGER DEFAULT 0;
--> statement-breakpoint
-- Index for filtering threads by creator bucket/is_me
CREATE INDEX idx_threads_creator ON email_threads(creator_bucket, creator_is_me);
