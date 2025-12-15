import 'dotenv/config'
import { createImapClient, fetchEmails, listFolders, toImportableEmail, backupEml } from '../services/imap'
import { importEmail } from '../services/import'
import { db } from '../db'
import { emails } from '../db/schema'
import { config } from '../config'

async function main() {
  console.log('Starting IMAP email import...')
  if (config.emlBackup.enabled) {
    console.log(`EML backup enabled: ${config.emlBackup.path}`)
  }

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

        for await (const fetched of fetchEmails(client, folder)) {
          try {
            // Backup raw EML with IMAP metadata headers
            backupEml(fetched)

            // Convert IMAP-specific format to common ImportableEmail
            const importable = toImportableEmail(fetched)
            const result = await importEmail(importable)

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
            console.error(`  Error importing email UID ${fetched.uid}:`, err)
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
