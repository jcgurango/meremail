import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'

const dbPath = process.env.DATABASE_PATH || './data/meremail.db'

// Default backup path with timestamp
const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const defaultBackupPath = `./data/backups/meremail-${timestamp}.db`

// Allow custom backup path via CLI arg
const backupPath = process.argv[2] || defaultBackupPath

// Ensure backup directory exists
const backupDir = dirname(backupPath)
if (!existsSync(backupDir)) {
  mkdirSync(backupDir, { recursive: true })
}

if (!existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`)
  process.exit(1)
}

console.log(`Backing up ${dbPath} to ${backupPath}...`)

const db = new Database(dbPath, { readonly: true })

try {
  db.backup(backupPath)
    .then(() => {
      console.log(`Backup completed: ${backupPath}`)
      db.close()
    })
    .catch((err) => {
      console.error('Backup failed:', err)
      db.close()
      process.exit(1)
    })
} catch (err) {
  console.error('Backup failed:', err)
  db.close()
  process.exit(1)
}
