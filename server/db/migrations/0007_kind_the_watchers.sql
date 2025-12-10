-- Add status field to emails for draft support
ALTER TABLE `emails` ADD `status` text DEFAULT 'sent' NOT NULL;