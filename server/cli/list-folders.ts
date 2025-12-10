import 'dotenv/config'
import { createImapClient, listFolders } from '../services/imap'

async function main() {
  console.log('Connecting to IMAP server...')
  const client = await createImapClient()

  try {
    const folders = await listFolders(client)
    console.log('\nAvailable folders:')
    folders.forEach((folder) => console.log(`  - ${folder}`))
  } finally {
    await client.logout()
  }
}

main().catch(console.error)
