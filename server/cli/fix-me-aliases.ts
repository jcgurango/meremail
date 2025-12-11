/**
 * One-time migration to fix "me" aliases that weren't detected during import
 * Scans emails for X-PM-Original-To and X-PM-Known-Alias headers to find aliases
 * Run with: yarn tsx server/cli/fix-me-aliases.ts
 */

import 'dotenv/config'
import Database from 'better-sqlite3'

const dbPath = process.env.DATABASE_PATH || './data/meremail.db'
const db = new Database(dbPath)

// Find all unique addresses from X-PM-Original-To and X-PM-Known-Alias headers
const aliasEmails = new Set<string>()

const emailsWithHeaders = db.prepare(`
  SELECT id, headers FROM emails WHERE headers IS NOT NULL
`).all() as { id: number; headers: string }[]

console.log(`Scanning ${emailsWithHeaders.length} emails for alias headers...`)

for (const email of emailsWithHeaders) {
  try {
    const headers = JSON.parse(email.headers)

    // Check X-PM-Original-To
    const originalTo = headers['x-pm-original-to']
    if (originalTo && typeof originalTo === 'string') {
      aliasEmails.add(originalTo.toLowerCase().trim())
    }

    // Check X-PM-Known-Alias
    const knownAlias = headers['x-pm-known-alias']
    if (knownAlias && typeof knownAlias === 'string') {
      aliasEmails.add(knownAlias.toLowerCase().trim())
    }
  } catch (e) {
    // Skip emails with invalid JSON headers
  }
}

console.log(`\nFound ${aliasEmails.size} unique alias addresses:`)
for (const alias of aliasEmails) {
  console.log(`  - ${alias}`)
}

// Find contacts that match these aliases but aren't marked as "me"
const contactsToFix: { id: number; email: string; name: string | null; isMe: boolean }[] = []

for (const alias of aliasEmails) {
  const contact = db.prepare(`
    SELECT id, email, name, is_me as isMe FROM contacts WHERE email = ?
  `).get(alias) as { id: number; email: string; name: string | null; isMe: boolean } | undefined

  if (contact && !contact.isMe) {
    contactsToFix.push(contact)
  }
}

if (contactsToFix.length === 0) {
  console.log('\nNo contacts need to be fixed!')
  process.exit(0)
}

console.log(`\nContacts to mark as "me":`)
for (const contact of contactsToFix) {
  console.log(`  [${contact.id}] ${contact.name || '(no name)'} <${contact.email}>`)
}

// Fix them
const updateStmt = db.prepare('UPDATE contacts SET is_me = 1 WHERE id = ?')

for (const contact of contactsToFix) {
  updateStmt.run(contact.id)
}

console.log(`\nFixed ${contactsToFix.length} contacts`)
db.close()
