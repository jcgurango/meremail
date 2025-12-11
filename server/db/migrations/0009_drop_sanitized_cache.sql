-- Drop the sanitization cache column (moving to client-side sanitization)
ALTER TABLE emails DROP COLUMN content_html_sanitized;
