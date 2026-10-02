# Meremail
A minimalist, self-hosted email API + client with a robust rules engine. Built with Hono, Vue 3, and SQLite. Connect it to your SMTP/IMAP, and it'll handle everything else. PWA for mobile. [Read more about what it is and why it exists here.](WHY.md)

## Features

### Rules Engine

Automatically organize incoming emails with powerful filtering rules:

- **Flexible Conditions**: Match on sender, subject, content, recipients, attachments, or custom headers
- **Condition Groups**: Combine conditions with AND/OR logic, including nested groups
- **Multiple Actions**: Move to folder, delete, mark as read, add to Reply Later, or Set Aside
- **Contact Lists**: Match senders against a list of email addresses
- **Header Matching**: Filter on any email header (e.g., `X-Spam-Score`, `List-Unsubscribe`)
- **Preview**: Test your rule against recent emails before saving
- **Retroactive Application**: Apply rules to existing emails with progress tracking

### Folder-Based Organization

Emails are organized into folders:

- **System Folders**: Inbox, Junk, Trash (with 30-day retention)
- **Custom Folders**: Create your own folders for organization
- **IMAP Sync**: Folders sync with your IMAP server

### Reply Later Queue

Mark threads you need to respond to. They're collected in one place, sorted by when you added them (oldest first), so nothing falls through the cracks.

### Set Aside

Temporarily set threads aside to focus on what matters now. They're sorted by when you set them aside (newest first) for easy retrieval.

### Full-Text Search

One search box covers the subject, body, sender, recipients and attachment names of every email, and drafts on the device. Results are grouped by thread, with the matching words highlighted.

Words match whole words, ignoring case and accents; the word being typed matches as the start of a word. Everything else about a search is typed into the same box as operators:

| | |
|---|---|
| `"exact phrase"` | Words next to each other, in order |
| `from:alice` `to:bob@example.com` | Sender, or any recipient, by name or address |
| `subject:word` `filename:report.pdf` | Subject or attachment name only |
| `in:inbox` | Folder, by name (repeat for several) |
| `has:attachment` `is:unread` `is:read` | |
| `after:2026-01-31` `before:2026-02-28` | Date range, including both days |
| `sort:oldest` | Oldest first; newest first is the default |

Contacts and attachments have their own search on their pages.

### Rich Email Composer

- WYSIWYG editor with formatting
- Inline images and file attachments
- Reply, reply-all, and forward
- Draft auto-save

### Local-First

The web client keeps its own copy of your recent mail and works from that, so nothing waits on the network:

- Mail received in the last 30 days is stored on the device, along with everything in Reply Later and Set Aside
- Anything older that you open or find by search is fetched and kept for 30 days from then
- Every change you make (read, move, trash, Send to, drafts, sending) applies immediately and is queued for the server, online or off
- Attachments download the first time they're opened and are kept on the device after that
- Search answers from the device straight away, then fills in the rest of the archive from the server
- A sync button shows when the device last synced and lets you sync on demand

Managing folders, rules and contacts still needs a connection.

### Privacy Features

- External images proxied by default to prevent tracking
- Self-hosted - your data stays on your server
- Raw EML backup during import

## Tech Stack

- **Frontend**: Vue 3, Vite, TipTap editor, PWA
- **Backend**: Hono (Node.js), Drizzle ORM
- **Database**: SQLite (via better-sqlite3)
- **Email**: IMAP for receiving, SMTP for sending

## Setup

### Prerequisites

- Node.js 20+
- pnpm

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/meremail.git
cd meremail

# Install dependencies
pnpm install

# Copy environment template
cp .env.example .env

# Edit .env with your email server details
# (see Configuration below)

# Run database migrations
pnpm db:migrate

# Import existing emails from IMAP
pnpm mail:import

# Start development server
pnpm dev
```

The app will be available at `http://localhost:5173` (frontend) with API at `http://localhost:3000`.

### Production

```bash
# Build all packages
pnpm build

# Start production server (serves API + static files)
pnpm start
```

In production, the server serves both the API and the built frontend on port 3000.

### Docker

You can just pull the `jcgurango/meremail:latest` image from dockerhub.

## Configuration

Edit `.env` with your settings:

```bash
# SMTP (for sending)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=you@example.com
SMTP_PASS=your-password
SMTP_SECURE=false

# IMAP (for receiving/importing)
IMAP_HOST=imap.example.com
IMAP_PORT=993
IMAP_USER=you@example.com
IMAP_PASS=your-password
IMAP_SECURE=true
# Delete mail from the IMAP server once the running server has retrieved it
# (irreversible; pnpm mail:import never deletes)
DELETE_MODE=false

# Your identity (auto-created on first import)
DEFAULT_SENDER_NAME=Your Name
DEFAULT_SENDER_EMAIL=you@example.com

# Image proxy for privacy (set empty to disable)
IMAGE_PROXY_URL=https://images.weserv.nl/?url={url}

# Attachment uploads
MAX_ATTACHMENT_SIZE=20971520

# EML backup during IMAP import (default: enabled)
EML_BACKUP_ENABLED=true

# Authentication
AUTH_USERNAME=admin
AUTH_PASSWORD=changeme
AUTH_COOKIE_SECRET=change-this-to-a-random-string
```

## CLI Commands

### IMAP Import

```bash
# Import all folders from IMAP
pnpm mail:import

# Import specific folders only
pnpm mail:import --folders=inbox,sent
```

During import:
- Emails are deduplicated by Message-ID
- Contacts are auto-created from senders and recipients
- Threads are constructed from References/In-Reply-To headers
- Emails are assigned to folders based on IMAP source (INBOX, Junk, etc.)
- Raw EML files are backed up with IMAP metadata (folder, flags, UID)
- Rules are evaluated and applied to incoming emails

### EML File Import

Import emails from local `.eml` files:

```bash
# Import all .eml files from a folder (recursive)
pnpm mail:eml-import ~/backups/emails

# Import sent emails
pnpm mail:eml-import ~/backups/sent --sent

# Import spam/junk
pnpm mail:eml-import ~/backups/spam --junk

# Mark imported emails as read
pnpm mail:eml-import ~/backups/archive --read

# Preview without importing
pnpm mail:eml-import ~/backups/emails --dry-run

# Non-recursive (single folder only)
pnpm mail:eml-import ~/backups/emails --no-recursive
```

### Demo Mode

Try out Meremail without connecting to a real email server:

```bash
# Reset database and load demo data
pnpm reset && pnpm mail:demo

# Start the app
pnpm dev
```

The demo data includes:
- Conversation threads with back-and-forth replies
- Newsletters and marketing emails
- Receipts and confirmations
- Unread messages and verification codes

This only works on an empty database.

### Fixing Received Dates

Older versions stamped imported mail with the time of the import rather than the time it was delivered. To correct mail imported that way:

```bash
pnpm db:fix-received-at
```

This re-derives each email's received date from its `Received` header (falling back to the sent date). It is safe to run more than once.

### Resetting the Password

```bash
# Generate a new random password
pnpm auth:reset-password

# Or choose one
pnpm auth:reset-password 'my new password'
```

This writes `AUTH_PASSWORD` to `.env` and rotates `AUTH_COOKIE_SECRET`, which logs out existing sessions. Restart the server afterwards. If you set these through the environment instead (e.g. Docker), change them there.

### Other Commands

```bash
# List available IMAP folders
pnpm mail:folders

# Generate new migration after schema changes
pnpm db:generate

# Run pending migrations
pnpm db:migrate

# Reset database (deletes all data!)
pnpm reset
```

## Data Storage

All data is stored in `./data/`:

```
data/
├── meremail.db      # SQLite database
├── uploads/         # Uploaded attachments
├── attachments/     # Downloaded IMAP attachments
└── eml-backup/      # Raw EML backups (organized by folder)
    ├── INBOX/
    ├── Sent/
    └── ...
```

## Development

```bash
# Start dev servers (frontend + backend with hot reload)
pnpm dev

# Build all packages
pnpm build

# Run only the server
pnpm -F @meremail/server dev

# Run only the frontend
pnpm -F @meremail/web dev

# Type check the frontend
pnpm -F @meremail/web build

# Run the tests
pnpm -F @meremail/server test
pnpm -F @meremail/web test
```

## Architecture

This is a pnpm monorepo with three packages:

```
packages/
├── shared/        # Database, types, services, config
│   └── src/
│       ├── db/           # Drizzle schema and migrations
│       ├── types/        # Shared TypeScript types
│       ├── services/     # Business logic (IMAP, import, etc.)
│       └── config.ts     # Environment configuration
│
├── server/        # Hono API server
│   └── src/
│       ├── routes/       # API endpoints
│       ├── sync/         # Change feed and action handlers for clients
│       ├── utils/        # Server utilities
│       ├── cli/          # CLI commands
│       └── index.ts      # Server entry point
│
└── web/           # Vue 3 SPA (Vite + PWA)
    └── src/
        ├── pages/        # Route pages
        ├── components/   # Vue components
        ├── local/        # Local database, sync engine, action queue
        ├── composables/  # Vue composables
        └── utils/        # Client utilities
```

### Key Concepts

- **Folders** organize threads (Inbox, Junk, Trash, plus custom folders)
- **Threads** group related emails by References/In-Reply-To headers
- **Emails** have `readAt` timestamp (null = unread) for read tracking
- **Drafts** are unsent messages, kept apart from emails and identified by a client-generated ID
- **Contacts** are a simple address book of senders and recipients
- **Rules** filter incoming emails with conditions and actions (first match wins)
- **Trash** holds deleted items for 30 days before permanent deletion
- **Sync** is a change feed: every change on the server gets the next number in a global sequence, and a client asks for everything after the last number it saw. Deletions leave tombstones. Triggers maintain all of this, so no code path can forget
- **Actions** are how clients change things: each mutation is applied locally, queued, and sent to `/api/sync/actions` with an ID that makes retries safe

## License

MIT
