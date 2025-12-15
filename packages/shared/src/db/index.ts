import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { mkdirSync, existsSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import * as schema from './schema'

// Resolve default path relative to monorepo root (4 levels up from this file)
const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '../../../..')
const defaultDbPath = resolve(rootDir, 'data/meremail.db')

const dbPath = process.env.DATABASE_PATH || defaultDbPath

// Ensure data directory exists
const dbDir = dirname(dbPath)
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true })
}

export const sqlite = new Database(dbPath)
sqlite.pragma('journal_mode = WAL')

export const db = drizzle(sqlite, { schema })

// Re-export schema for convenience
export * from './schema'
