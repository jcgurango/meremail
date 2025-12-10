import { config } from '../config'
import { db } from '../db'
import { senderAddresses } from '../db/schema'

export default defineNitroPlugin(async () => {
  // Auto-create default sender if configured and none exist
  const { name, email } = config.defaultSender
  if (name && email) {
    const existing = db.select().from(senderAddresses).limit(1).all()
    if (existing.length === 0) {
      db.insert(senderAddresses).values({ name, email }).run()
      console.log(`Created default sender address: ${name} <${email}>`)
    }
  }
})
