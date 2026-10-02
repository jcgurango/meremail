import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Each test file gets its own throwaway database. This must run before
// anything imports @meremail/shared, which opens the database on load.
process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'meremail-test-')), 'test.db')
process.env.IMAP_HOST = ''
process.env.SMTP_HOST = ''
