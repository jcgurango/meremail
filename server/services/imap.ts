import { ImapFlow } from 'imapflow'
import { simpleParser, ParsedMail } from 'mailparser'
import { config } from '../config'

export interface FetchedEmail {
  uid: number
  folder: string
  parsed: ParsedMail
  raw: Buffer
  flags: Set<string>
}

export async function createImapClient(): Promise<ImapFlow> {
  const client = new ImapFlow({
    host: config.imap.host,
    port: config.imap.port,
    secure: config.imap.secure,
    auth: {
      user: config.imap.user,
      pass: config.imap.pass,
    },
    logger: false,
  })

  await client.connect()
  return client
}

export async function* fetchEmails(
  client: ImapFlow,
  folder: string,
  since?: Date
): AsyncGenerator<FetchedEmail> {
  const lock = await client.getMailboxLock(folder)

  try {
    const searchCriteria: any = { all: true }
    if (since) {
      searchCriteria.since = since
    }

    const messages = client.fetch(searchCriteria, {
      uid: true,
      envelope: true,
      source: true,
      flags: true,
    })

    for await (const message of messages) {
      const raw = message.source
      if (!raw) continue
      // skipImageLinks: don't auto-convert cid: references to data URIs
      const parsed = await simpleParser(raw, { skipImageLinks: true })

      yield {
        uid: message.uid,
        folder,
        parsed,
        raw,
        flags: message.flags ?? new Set<string>(),
      }
    }
  } finally {
    lock.release()
  }
}

export async function listFolders(client: ImapFlow): Promise<string[]> {
  const folders = await client.list()
  return folders.map((f) => f.path)
}
