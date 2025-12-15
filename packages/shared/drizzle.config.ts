import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

// Resolve paths relative to monorepo root (two levels up from packages/shared)
const defaultDbPath = '../../data/meremail.db'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_PATH || defaultDbPath,
  },
  verbose: true,
})
