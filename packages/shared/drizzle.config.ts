import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'
import path from 'path'

// Calculate monorepo root (2 levels up from packages/shared)
// Use process.cwd() as fallback since drizzle-kit runs from packages/shared
const rootDir = path.resolve(process.cwd(), '../..')

// Resolve DATABASE_PATH - if absolute use as-is, otherwise resolve from rootDir
const dbPathEnv = process.env.DATABASE_PATH || 'data/meremail.db'
const dbPath = dbPathEnv.startsWith('/') ? dbPathEnv : path.resolve(rootDir, dbPathEnv)

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dbCredentials: {
    url: dbPath,
  },
  verbose: true,
})
