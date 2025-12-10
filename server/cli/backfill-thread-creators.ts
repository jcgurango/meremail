import 'dotenv/config'
import { db } from '../db'
import { emailThreads, emails } from '../db/schema'
import { eq, asc } from 'drizzle-orm'

/**
 * Backfill thread creator_id for existing threads
 */
async function backfillThreadCreators() {
  console.log('Backfilling thread creator_id...')

  // Get all threads without creator_id
  const threads = db
    .select({ id: emailThreads.id })
    .from(emailThreads)
    .all()

  console.log(`Found ${threads.length} threads to process`)

  let updated = 0
  let skipped = 0

  for (const thread of threads) {
    // Get the first email in the thread (by sent_at)
    const firstEmail = db
      .select({ senderId: emails.senderId })
      .from(emails)
      .where(eq(emails.threadId, thread.id))
      .orderBy(asc(emails.sentAt))
      .limit(1)
      .get()

    if (!firstEmail || !firstEmail.senderId) {
      skipped++
      continue
    }

    // Update the thread with creator_id
    db.update(emailThreads)
      .set({ creatorId: firstEmail.senderId })
      .where(eq(emailThreads.id, thread.id))
      .run()

    updated++

    if (updated % 500 === 0) {
      console.log(`  Processed ${updated} threads...`)
    }
  }

  console.log(`Done! Updated ${updated} threads, skipped ${skipped}`)
}

backfillThreadCreators().catch(console.error)
