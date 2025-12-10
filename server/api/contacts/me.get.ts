import { db } from '../../db'
import { contacts } from '../../db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async () => {
  // Get all contacts marked as "me" (user's own identities)
  const meContacts = await db
    .select({
      id: contacts.id,
      name: contacts.name,
      email: contacts.email,
    })
    .from(contacts)
    .where(eq(contacts.isMe, true))
    .orderBy(contacts.email)

  return { contacts: meContacts }
})
