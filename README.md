# Meremail

A minimalist, self-hosted email client inspired by [HEY](https://hey.com). Built with Nuxt 4, Vue 3, and SQLite.

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

### Privacy Features

- External images proxied by default to prevent tracking
- Self-hosted - your data stays on your server
- Raw EML backup during import

## Tech Stack

- **Frontend**: Nuxt 4, Vue 3, TipTap editor
- **Backend**: Nitro (Nuxt server), Drizzle ORM
- **Database**: SQLite (via better-sqlite3)
- **Email**: IMAP for receiving, SMTP for sending

## Setup

### Prerequisites

- Node.js 20+
- Yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/meremail.git
cd meremail

# Install dependencies
yarn install

# Copy environment template
cp .env.example .env

# Edit .env with your email server details
# (see Configuration below)

# Run database migrations
yarn db:migrate

# Import existing emails from IMAP
yarn mail:import

# Start development server
yarn dev
```

The app will be available at `http://localhost:3000`.

### Production

```bash
# Build for production
yarn build

# Preview production build
yarn preview
```

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
```

## CLI Commands

### Email Import

```bash
# Import all folders from IMAP
yarn mail:import

# Import specific folders only
yarn mail:import --folders=inbox,sent
```

During import:
- Emails are deduplicated by Message-ID
- Contacts are auto-created and categorized
- Threads are constructed from References/In-Reply-To headers
- Raw EML files are backed up with IMAP metadata (folder, flags, UID)

### Other Commands

```bash
# List available IMAP folders
yarn mail:folders

# Backup database
yarn db:backup

# Generate new migration after schema changes
yarn db:generate

# Run pending migrations
yarn db:migrate

# Reset database (deletes all data!)
yarn reset
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
# Start dev server with hot reload
yarn dev

# Type check
yarn nuxi typecheck

# Generate migration after schema changes
yarn db:generate
```

## Architecture

```
app/
├── components/    # Vue components
├── pages/         # Route pages
└── app.vue        # Root layout

server/
├── api/           # API endpoints (Nitro)
├── cli/           # CLI commands
├── db/            # Database schema and migrations
├── services/      # Business logic (IMAP, import, etc.)
└── types/         # Shared TypeScript types
```

### Key Concepts

- **Contacts** have a `bucket` that determines where their emails appear
- **Threads** group related emails by References/In-Reply-To headers
- **Emails** have `readAt` timestamp (null = unread) for read tracking
- **ImportableEmail** is a source-agnostic DTO - the import service doesn't know about IMAP

## License

MIT
