import { eq } from 'drizzle-orm'
import { db, attachments } from '@meremail/shared'

/**
 * Replace cid: references in HTML with actual attachment URLs.
 * CID format in HTML: src="cid:image001@example.com"
 * Content-ID in email: <image001@example.com> (with angle brackets)
 */
export function replaceCidReferences(html: string, emailId: number): string {
  // Get all attachments with Content-IDs for this email
  const cidAttachments = db
    .select({ id: attachments.id, contentId: attachments.contentId })
    .from(attachments)
    .where(eq(attachments.emailId, emailId))
    .all()
    .filter((a) => a.contentId)

  if (cidAttachments.length === 0) {
    return html
  }

  // Build a map of CID -> attachment ID (normalize by removing angle brackets)
  const cidMap = new Map<string, number>()
  for (const att of cidAttachments) {
    if (att.contentId) {
      // Store both with and without angle brackets
      cidMap.set(att.contentId, att.id)
      cidMap.set(att.contentId.replace(/^<|>$/g, ''), att.id)
    }
  }

  // Replace cid: references
  return html.replace(
    /src=["']cid:([^"']+)["']/gi,
    (match, cid) => {
      const attachmentId = cidMap.get(cid)
      if (attachmentId) {
        return `src="/api/attachments/${attachmentId}"`
      }
      return match
    }
  )
}
