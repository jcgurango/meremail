# MereMail

See README.md for what the project is, setup, commands and the package layout. This file covers what isn't obvious from there.

## Running it safely

- The root `.env` might hold real IMAP and SMTP credentials. Starting the server with it as-is would connect to the live mailbox and will send anything queued. For local work, blank them: `IMAP_HOST= SMTP_HOST= pnpm dev:server`.
- `DATABASE_PATH` only moves the database. Uploads, attachments, backups and the scheduler's state file always go under `<repo>/data/`.
- The server takes a full database backup into `data/backups/` and runs retention cleanup (permanently deleting old Trash/Junk) every time it starts, if it hasn't that day.
- Auth comes from `.env` and is read at startup. With `AUTH_PASSWORD` empty the API is open but the web login can't succeed.
- The production build sets a `Secure` session cookie, so it can't be logged into over plain HTTP from another machine. Use the dev servers (`pnpm dev`, web with `--host 0.0.0.0`) for that.
- Service workers and OPFS need a secure context (HTTPS or localhost). Over plain HTTP the app still works, minus attachment caching and offline cold start. `crypto.randomUUID` and `navigator.locks` are also missing there; use `uuid()` from `packages/web/src/local/uuid.ts`.

## Checks

```bash
pnpm -F @meremail/server build   # typecheck (tsc --noEmit; also covers shared)
pnpm -F @meremail/web build      # vue-tsc + vite build
pnpm -F @meremail/server test
pnpm -F @meremail/web test
```

Server tests run against a throwaway database per test file (`packages/server/test/setup.ts`), but uploads still land in `data/uploads/` - clean up files a test creates. Web tests use `fake-indexeddb` and a fake server defined in `test/sync.test.ts`.

## Database

- Timestamp columns are **seconds** (drizzle `mode: 'timestamp'`). Always write them through drizzle with a `Date`. Raw SQL that writes milliseconds or ISO strings has caused real bugs here (retention compared seconds to ms; "mark all read" stored ISO text).
- The sync protocol (`packages/shared/src/types/sync.ts`) uses **milliseconds**. Convert at the boundary, in `packages/server/src/sync/feed.ts`.
- Folder IDs 1 (Inbox), 2 (Junk) and 3 (Trash) are fixed and referenced by number.
- Foreign keys are enforced (better-sqlite3 default). Delete through the services in `packages/shared/src/services/delete.ts` and `drafts.ts`, which remove dependents and files in the right order.
- A forwarded email's attachment rows point at the same file as the original's. Never delete an attachment file without checking no other row uses it (`deleteAttachmentFiles` does this).
- `receivedAt` is when the mailbox took delivery (IMAP INTERNALDATE, else the newest `Received` header, else the sent date) - never the import time. A bulk import is treated like a restore.

### Migrations

- `pnpm db:generate` hangs on an interactive rename prompt if one change both adds and drops columns. Generate the additions and the drops as two separate migrations.
- Triggers, FTS tables and data fixes are hand-written SQL. Statements are split on `--> statement-breakpoint`, so a trigger body must sit in one chunk. A hand-written migration needs an entry in `migrations/meta/_journal.json` (no snapshot).
- Rebuilding a table (drizzle's `__new_` pattern) drops its triggers. Recreate the FTS and sync triggers afterwards.

## Sync

How it works is in the README; these are the rules to keep it working.

- **Revisions are maintained by triggers** (migration `0012_sync.sql`). Any insert, update or delete on folders, contacts, threads, emails or drafts is picked up automatically, whichever code path made it. A new synced table needs its own triggers and a section in the feed.
- **Emails have two revisions.** `rev` covers content; `meta_rev` covers read state only, so marking mail read doesn't resend bodies. The `emails_rev_au` trigger lists the content columns explicitly - add new content columns to it.
- **Mail data is never fetched directly by the UI.** Components read the local database through `useLiveQuery` and the helpers in `packages/web/src/local/queries.ts`.
- **Every user change is an action.** Add the type to `SyncActionPayloads`, a handler in `packages/server/src/sync/actions.ts`, and its local effect in `applyLocal` in `packages/web/src/local/actions.ts`. The local effect is re-run whenever server data overwrites local rows, so it must be safe to repeat and must tolerate its target being gone.
- **Server handlers** throw `ActionRejected` for failures that can never succeed (the client drops the action and undoes it locally). Any other error is treated as temporary and retried.
- **Retention is by retrieval time, not email date.** A thread is kept whole for 30 days from when the device last retrieved it. New mail or an explicit fetch restarts the clock (`touch: true`); metadata changes and refreshes don't.
- **Folder watermarks.** Thread lists only show threads back to the date the local copy is known to be complete; older mail held locally (search hits, pinned threads) is deliberately hidden from the list until paged to, so lists have no gaps.
- **Unread counts** are the server's count plus how far the local count has moved since it was received. Storing mail the server has already counted must not shift the baseline (`storeThreads` handles this).
- Folders with "sync offline" off (Junk and Trash by default) are not held on the device; they page from the server when opened.
- Raw headers are not synced. `GET /api/emails/:id/headers` serves them on demand.

## Search

- **The query language lives in `packages/shared/src/search.ts`** and is used by both sides: the server turns a parsed query into an FTS5 expression, the client matches it against held mail with regexes. A change to what a query means goes there, so the two tiers keep agreeing. That file must stay free of Node and DOM imports.
- **`emails_fts` is contentless** (migration `0015_search_index.sql`) and is filled from the `emails_search_documents` view by triggers on `emails`, `email_contacts`, `attachments` and `contacts`. To index something new, add it to the view, the table and the triggers that can change it, and to `emailDocument` / `draftDocument` in `packages/web/src/local/search.ts`.
- Snippets are cut from `content_text` in code (`searchSnippet`); the index stores no text.
- Drafts are only searched on the device. The server index covers emails only.
- The query text is the whole search - folders, people, dates and sort order are operators in it - and it is the only search state in the URL (`?q=`). There are no separate filter controls.

## Still online-only

Folder management, rules, the attachments browser and per-contact history call the server directly (`packages/web/src/utils/api.ts`). After changing folders or identities, call `syncNow()` so the local copy catches up.

## Conventions

- Each Vue component carries its own scoped CSS with literal colour values; there is no shared stylesheet or design tokens yet.
