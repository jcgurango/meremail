/**
 * One-time migration to strip surrounding quotes from contact names
 * Run with: yarn tsx server/cli/fix-quoted-names.ts
 */

import 'dotenv/config'
import Database from 'better-sqlite3'

const dbPath = process.env.DATABASE_PATH || './data/meremail.db'
const db = new Database(dbPath)

// Find contacts with names that start with a quote (handles trailing spaces, etc.)
const quotedContacts = db.prepare(`
  SELECT id, name, email
  FROM contacts
  WHERE TRIM(name) LIKE '"%' OR TRIM(name) LIKE '''%'
`).all() as { id: number; name: string; email: string }[]

console.log(`Found ${quotedContacts.length} contacts with quoted names`)

if (quotedContacts.length === 0) {
  console.log('Nothing to fix!')
  process.exit(0)
}

function cleanName(name: string): string {
  // Trim first, then strip surrounding single or double quotes, then trim again
  let cleaned = name.trim()
  cleaned = cleaned.replace(/^["'](.*)["']$/, '$1').trim()
  return cleaned
}

// Show what we'll fix
console.log('\nContacts to fix:')
for (const contact of quotedContacts) {
  const cleaned = cleanName(contact.name)
  console.log(`  [${contact.id}] "${contact.name}" -> "${cleaned}" (${contact.email})`)
}

// Apply fixes
const updateStmt = db.prepare('UPDATE contacts SET name = ? WHERE id = ?')

let fixed = 0
for (const contact of quotedContacts) {
  const cleaned = cleanName(contact.name)
  if (cleaned && cleaned !== contact.name) {
    updateStmt.run(cleaned, contact.id)
    fixed++
  }
}

console.log(`\nFixed ${fixed} contacts`)
db.close()
