import type { SyncEmail } from '@meremail/shared/sync-types'

/**
 * Turn a stored email into HTML ready for sanitising and display.
 *
 * Emails are stored as they were received; the rewriting needed to show them
 * (inline images, image proxying) happens here at view time.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Replace cid: references with attachment URLs.
 * CID format in HTML: src="cid:image001@example.com"
 * Content-ID on the attachment may or may not have angle brackets.
 */
export function replaceCidReferences(html: string, attachments: SyncEmail['attachments']): string {
  const cidMap = new Map<string, number>()
  for (const att of attachments) {
    if (att.contentId) {
      cidMap.set(att.contentId, att.id)
      cidMap.set(att.contentId.replace(/^<|>$/g, ''), att.id)
    }
  }
  if (cidMap.size === 0) return html

  return html.replace(/src=["']cid:([^"']+)["']/gi, (match, cid: string) => {
    const attachmentId = cidMap.get(cid)
    return attachmentId ? `src="/api/attachments/${attachmentId}"` : match
  })
}

function proxyImageUrl(url: string, template: string): string {
  // Only absolute remote URLs go through the proxy - not data URIs or our own attachments
  if (!url.startsWith('http://') && !url.startsWith('https://')) return url
  // Skip already-proxied URLs
  const proxyHost = template.split('{url}')[0]
  if (proxyHost && url.startsWith(proxyHost)) return url

  return template.replace('{url}', encodeURIComponent(url))
}

/**
 * Rewrite remote image URLs to go through the configured proxy, so that
 * opening an email doesn't reveal the reader's IP to the sender.
 */
export function proxyImages(html: string, template: string): string {
  if (!template) return html

  return html
    .replace(/<img([^>]*)\ssrc=(["'])([^"']+)\2/gi, (_match, before: string, quote: string, url: string) => {
      return `<img${before} src=${quote}${proxyImageUrl(url, template)}${quote}`
    })
    .replace(/background(-image)?\s*:\s*url\((["']?)([^)"']+)\2\)/gi, (_match, suffix: string | undefined, quote: string, url: string) => {
      return `background${suffix || ''}: url(${quote}${proxyImageUrl(url, template)}${quote})`
    })
}

export function renderEmailContent(
  email: Pick<SyncEmail, 'contentHtml' | 'contentText' | 'attachments'>,
  imageProxyUrl: string
): string {
  if (email.contentHtml) {
    return proxyImages(replaceCidReferences(email.contentHtml, email.attachments), imageProxyUrl)
  }
  if (email.contentText?.trim()) {
    return `<pre style="white-space: pre-wrap; font-family: inherit;">${escapeHtml(email.contentText)}</pre>`
  }
  return ''
}
