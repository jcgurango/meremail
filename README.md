# Meremail

A minimalist, self-hosted email client inspired by [HEY](https://hey.com). Built with Hono, Vue 3, and SQLite.

## Features

### Contact-Based Filtering

New senders are screened before reaching your inbox. You decide where each contact's emails go:

- **Inbox** - Important emails from people you care about
- **The Feed** - Newsletters, updates, and subscriptions you want to browse
- **Paper Trail** - Receipts, confirmations, and automated emails you need but don't need to read
- **Quarantine** - Suspected spam held for review
- **Blocked** - Senders you never want to hear from

### Reply Later Queue

Mark threads you need to respond to. They're collected in one place, sorted by when you added them (oldest first), so nothing falls through the cracks.

### Set Aside

Temporarily set threads aside to focus on what matters now. They're sorted by when you set them aside (newest first) for easy retrieval.

### Full-Text Search

Search across all emails, contacts, and attachments.

### Rich Email Composer

- WYSIWYG editor with formatting
- Inline images and file attachments
- Reply, reply-all, and forward
- Draft auto-save

### Offline Support

Progressive Web App with offline capabilities - read cached emails and compose drafts without an internet connection.

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

# Your identity (auto-created on first import)
DEFAULT_SENDER_NAME=Your Name
DEFAULT_SENDER_EMAIL=you@example.com

# Database location
DATABASE_PATH=./data/meremail.db

# Image proxy for privacy (set empty to disable)
IMAGE_PROXY_URL=https://images.weserv.nl/?url={url}

# Attachment uploads
UPLOADS_PATH=./data/uploads
MAX_ATTACHMENT_SIZE=20971520

# EML backup during IMAP import (default: enabled)
EML_BACKUP_ENABLED=true
EML_BACKUP_PATH=./data/eml-backup

# Authentication
AUTH_USERNAME=admin
AUTH_PASSWORD=changeme
AUTH_COOKIE_SECRET=change-this-to-a-random-string
```

## CLI Commands

### Email Import

```bash
# Import all folders from IMAP
pnpm mail:import

# Import specific folders only
pnpm mail:import --folders=inbox,sent
```

During import:
- Emails are deduplicated by Message-ID
- Contacts are auto-created and categorized
- Threads are constructed from References/In-Reply-To headers
- Raw EML files are backed up with IMAP metadata (folder, flags, UID)

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
- Newsletters and marketing emails (Feed material)
- Receipts and confirmations (Paper Trail material)
- Suspicious spam emails (auto-quarantined)
- Unread messages and verification codes

This only works on an empty database.

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
│       ├── utils/        # Server utilities
│       ├── cli/          # CLI commands
│       └── index.ts      # Server entry point
│
└── web/           # Vue 3 SPA (Vite + PWA)
    └── src/
        ├── pages/        # Route pages
        ├── components/   # Vue components
        ├── composables/  # Vue composables
        └── utils/        # Client utilities
```

### Key Concepts

- **Contacts** have a `bucket` that determines where their emails appear
- **Threads** group related emails by References/In-Reply-To headers
- **Emails** have `readAt` timestamp (null = unread) for read tracking
- **ImportableEmail** is a source-agnostic DTO - the import service doesn't know about IMAP

## License

MIT
