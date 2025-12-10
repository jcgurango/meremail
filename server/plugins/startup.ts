import { eq } from 'drizzle-orm'
import { config } from '../config'
import { db } from '../db'
import { contacts } from '../db/schema'

export default defineNitroPlugin(async () => {
  // Auto-create default "me" contact if configured and none exist
  const { name, email } = config.defaultSender
  if (name && email) {
    const existing = db.select().from(contacts).where(eq(contacts.isMe, true)).limit(1).all()
    if (existing.length === 0) {
      db.insert(contacts).values({ name, email, isMe: true }).run()
      console.log(`Created default contact (me): ${name} <${email}>`)
    }
  }
})
