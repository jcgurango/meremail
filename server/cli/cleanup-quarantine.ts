#!/usr/bin/env tsx
/**
 * Cleanup quarantined emails older than 30 days
 *
 * Usage: yarn db:cleanup-quarantine [--days=30] [--dry-run]
 *
 * Add to crontab for daily cleanup:
 * 0 3 * * * cd /path/to/meremail && yarn db:cleanup-quarantine >> /var/log/meremail-cleanup.log 2>&1
 */

import 'dotenv/config'
import { eq, and, inArray, lt, sql } from 'drizzle-orm'
import { db } from '../db'
import { contacts, emails } from '../db/schema'
import { deleteQuarantinedEmailsOlderThan } from '../services/delete'

// Parse arguments
const args = process.argv.slice(2)
const daysArg = args.find(a => a.startsWith('--days='))
const days = daysArg ? parseInt(daysArg.split('=')[1]) : 30
const dryRun = args.includes('--dry-run')

async function main() {
  const startTime = Date.now()
  const timestamp = new Date().toISOString()

  console.log(`[${timestamp}] Quarantine cleanup starting...`)
  console.log(`  Days threshold: ${days}`)
  console.log(`  Dry run: ${dryRun}`)

  // Get stats before cleanup
  const quarantinedContacts = db
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.bucket, 'quarantine'))
    .all()

  console.log(`  Quarantined contacts: ${quarantinedContacts.length}`)

  if (quarantinedContacts.length === 0) {
    console.log('  No quarantined contacts found. Nothing to do.')
    return
  }

  // Calculate cutoff date
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - days)
  console.log(`  Cutoff date: ${cutoffDate.toISOString()}`)

  // Count emails that would be deleted (for preview)
  const contactIds = quarantinedContacts.map(c => c.id)
  const countResult = db
    .select({ count: sql<number>`COUNT(*)` })
    .from(emails)
    .where(and(
      inArray(emails.senderId, contactIds),
      lt(emails.sentAt, cutoffDate)
    ))
    .get()

  console.log(`  Emails to delete: ${countResult?.count || 0}`)

  if (dryRun) {
    console.log('\n  [DRY RUN] No changes made.')
    return
  }

  if ((countResult?.count || 0) === 0) {
    console.log('  No emails older than cutoff. Nothing to do.')
    return
  }

  // Perform the actual cleanup
  const result = deleteQuarantinedEmailsOlderThan(days)

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
  console.log(`\n  Cleanup complete in ${elapsed}s:`)
  console.log(`    Emails deleted: ${result.emailsDeleted}`)
  console.log(`    Attachments deleted: ${result.attachmentsDeleted}`)
  console.log(`    Empty threads removed: ${result.threadsDeleted}`)
  console.log(`    Contacts with no emails removed: ${result.contactsDeleted}`)
}

main().catch((err) => {
  console.error('Cleanup failed:', err)
  process.exit(1)
})
