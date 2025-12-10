-- Index on creator_id for JOIN performance
CREATE INDEX idx_threads_creator_id ON email_threads(creator_id);
