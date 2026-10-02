import 'dotenv/config'
import { sqlite, parseReceivedDate } from '@meremail/shared'

/**
 * Backfill emails.received_at for mail that was imported before received_at
 * tracked the real delivery time (it used to be stamped with the import time).
 *
 * Re-derives it from the newest Received header, falling back to sent_at.
 * read_at is moved along with it where it was just a copy of received_at.
 * Safe to run repeatedly.
 */
export function fixReceivedAt(): { checked: number; updated: number } {
  const rows = sqlite
    .prepare(`
      SELECT id, headers, sent_at AS sentAt, received_at AS receivedAt, read_at AS readAt
      FROM emails
      WHERE received_at IS NOT NULL
    `)
    .all() as { id: number; headers: string | null; sentAt: number | null; receivedAt: number; readAt: number | null }[]

  const update = sqlite.prepare('UPDATE emails SET received_at = ?, read_at = ? WHERE id = ?')
  let updated = 0

  sqlite.transaction(() => {
    for (const row of rows) {
      let derived: number | null = null

      if (row.headers) {
        try {
          const headers = JSON.parse(row.headers) as { key: string; value: string }[]
          const received = headers.find(h => h?.key?.toLowerCase() === 'received')
          const date = parseReceivedDate(received?.value)
          if (date) derived = Math.floor(date.getTime() / 1000)
        } catch {
          // Unparseable headers - fall through to sent_at
        }
      }
      derived ??= row.sentAt

      if (derived === null || derived === row.receivedAt) continue

      const readAt = row.readAt === row.receivedAt ? derived : row.readAt
      update.run(derived, readAt, row.id)
      updated++
    }
  })()

  return { checked: rows.length, updated }
}

// Run if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  const result = fixReceivedAt()
  console.log(`Checked ${result.checked} emails, corrected received_at on ${result.updated}`)
}
