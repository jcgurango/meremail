#!/usr/bin/env tsx
/**
 * Rebuild Sanitization Cache
 *
 * Re-sanitizes all email HTML content and stores in content_html_sanitized column.
 * Use this after DOMPurify updates or if you suspect cache corruption.
 *
 * Usage:
 *   yarn db:rebuild-sanitization          # Rebuild all
 *   yarn db:rebuild-sanitization --force  # Clear cache first, then rebuild
 */
import 'dotenv/config'
import { db } from '../db'
import { emails } from '../db/schema'
import { sanitizeEmailHtml } from '../utils/sanitize-email-html'
import { isNull, isNotNull, sql } from 'drizzle-orm'

const args = process.argv.slice(2)
const force = args.includes('--force')

async function main() {
  console.log('Rebuild Sanitization Cache')
  console.log('==========================')

  const startTime = Date.now()

  // Get count of emails with HTML
  const totalResult = db
    .select({ count: sql<number>`COUNT(*)` })
    .from(emails)
    .where(isNotNull(emails.contentHtml))
    .get()
  const totalWithHtml = totalResult?.count || 0

  if (force) {
    console.log('Force mode: clearing all cached sanitized HTML...')
    db.update(emails)
      .set({ contentHtmlSanitized: null })
      .where(isNotNull(emails.contentHtmlSanitized))
      .run()
    console.log('Cache cleared.')
  }

  // Get count of emails needing sanitization
  const needsWorkResult = db
    .select({ count: sql<number>`COUNT(*)` })
    .from(emails)
    .where(sql`${emails.contentHtml} IS NOT NULL AND ${emails.contentHtmlSanitized} IS NULL`)
    .get()
  const needsWork = needsWorkResult?.count || 0

  console.log(`Total emails with HTML: ${totalWithHtml}`)
  console.log(`Emails needing sanitization: ${needsWork}`)

  if (needsWork === 0) {
    console.log('Nothing to do!')
    return
  }

  console.log('\nProcessing...')

  // Process in batches to avoid memory issues
  const BATCH_SIZE = 100
  let processed = 0
  let errors = 0

  while (true) {
    // Get next batch of emails needing sanitization
    const batch = db
      .select({
        id: emails.id,
        contentHtml: emails.contentHtml,
      })
      .from(emails)
      .where(sql`${emails.contentHtml} IS NOT NULL AND ${emails.contentHtmlSanitized} IS NULL`)
      .limit(BATCH_SIZE)
      .all()

    if (batch.length === 0) break

    for (const email of batch) {
      try {
        const sanitized = sanitizeEmailHtml(email.contentHtml!)
        db.update(emails)
          .set({ contentHtmlSanitized: sanitized })
          .where(sql`${emails.id} = ${email.id}`)
          .run()
        processed++
      } catch (e) {
        console.error(`Error processing email ${email.id}:`, e)
        errors++
      }
    }

    // Progress update
    const pct = Math.round((processed / needsWork) * 100)
    process.stdout.write(`\r  Processed ${processed}/${needsWork} (${pct}%)`)
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
  console.log(`\n\nDone!`)
  console.log(`  Processed: ${processed}`)
  console.log(`  Errors: ${errors}`)
  console.log(`  Time: ${elapsed}s`)
}

main().catch(console.error)
