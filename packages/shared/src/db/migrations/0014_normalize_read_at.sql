-- "Mark all as read" used to write read_at as an ISO string instead of a
-- timestamp in seconds like everything else. Clients can't read those values
-- as dates and show the mail as unread. Convert them.
-- (This also bumps meta_rev, so clients that already synced pick up the fix.)
UPDATE `emails`
SET `read_at` = CAST(strftime('%s', `read_at`) AS INTEGER)
WHERE typeof(`read_at`) = 'text' AND strftime('%s', `read_at`) IS NOT NULL;
--> statement-breakpoint
-- Anything unparseable was still a "read" marker; fall back to the received date
UPDATE `emails`
SET `read_at` = COALESCE(`received_at`, `sent_at`, `created_at`)
WHERE typeof(`read_at`) = 'text';
