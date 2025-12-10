import 'dotenv/config'
import { createImapClient, fetchEmails, listFolders } from '../services/imap'
import { importEmail } from '../services/import'
import { db } from '../db'
import { emails } from '../db/schema'
import { desc } from 'drizzle-orm'

async function main() {
  console.log('Starting email import...')

  // Parse command line arguments
  const args = process.argv.slice(2)
  const foldersArg = args.find((a) => a.startsWith('--folders='))
  const requestedFolders = foldersArg
    ? foldersArg.replace('--folders=', '').split(',')
    : null

  // Connect to IMAP
  console.log('Connecting to IMAP server...')
  const client = await createImapClient()
  console.log('Connected!')

  try {
    // Get available folders
    const availableFolders = await listFolders(client)
    console.log(`Available folders: ${availableFolders.join(', ')}`)

    // Determine which folders to process
    const foldersToProcess = requestedFolders
      ? availableFolders.filter((f) => requestedFolders.some((rf) => f.toLowerCase().includes(rf.toLowerCase())))
      : availableFolders

    console.log(`Processing folders: ${foldersToProcess.join(', ')}`)

    let totalImported = 0
    let totalSkipped = 0
    let totalErrors = 0

    for (const folder of foldersToProcess) {
      console.log(`\nProcessing folder: ${folder}`)

      try {
        let folderImported = 0
        let folderSkipped = 0

        for await (const email of fetchEmails(client, folder)) {
          try {
            const result = await importEmail(email)

            if (result.imported) {
              folderImported++
              totalImported++
              if (folderImported % 100 === 0) {
                console.log(`  Imported ${folderImported} emails from ${folder}...`)
              }
            } else {
              folderSkipped++
              totalSkipped++
            }
          } catch (err) {
            totalErrors++
            console.error(`  Error importing email UID ${email.uid}:`, err)
          }
        }

        console.log(`  Folder ${folder}: ${folderImported} imported, ${folderSkipped} skipped`)
      } catch (err) {
        console.error(`  Error processing folder ${folder}:`, err)
      }
    }

    console.log('\n--- Import Summary ---')
    console.log(`Total imported: ${totalImported}`)
    console.log(`Total skipped (duplicates): ${totalSkipped}`)
    console.log(`Total errors: ${totalErrors}`)

    // Show thread stats
    const emailCount = db.select().from(emails).all().length
    console.log(`\nTotal emails in database: ${emailCount}`)
  } finally {
    await client.logout()
    console.log('\nDisconnected from IMAP server.')
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
