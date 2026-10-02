import { describe, it, expect } from 'vitest'
import { renderEmailContent } from '@/local/render'
import { matchesQuery, tokenize, mergeResults, type EmailSearchResult } from '@/local/search'
import { displayedUnreadCount } from '@/local/store'
import { ALICE } from './helpers'

const PROXY = 'https://proxy.example/?url={url}'

describe('renderEmailContent', () => {
  it('points inline images at their attachments and proxies remote ones', () => {
    const html = renderEmailContent({
      contentHtml: '<img src="cid:logo@x"><img alt="t" src="https://tracker.example/p.gif"><img src="/api/attachments/9">',
      contentText: '',
      attachments: [{ id: 7, filename: 'logo.png', mimeType: 'image/png', size: 1, isInline: true, contentId: '<logo@x>' }],
    }, PROXY)

    expect(html).toContain('src="/api/attachments/7"')
    expect(html).toContain(`src="https://proxy.example/?url=${encodeURIComponent('https://tracker.example/p.gif')}"`)
    expect(html).toContain('src="/api/attachments/9"')
  })

  it('leaves remote images alone when no proxy is configured', () => {
    const html = renderEmailContent({ contentHtml: '<img src="https://a.example/x.png">', contentText: '', attachments: [] }, '')
    expect(html).toBe('<img src="https://a.example/x.png">')
  })

  it('escapes plain text so it cannot be read as markup', () => {
    const html = renderEmailContent({ contentHtml: null, contentText: 'if a < b && c > d <script>x</script>', attachments: [] }, PROXY)
    expect(html).toContain('a &lt; b &amp;&amp; c &gt; d &lt;script&gt;')
    expect(html).not.toContain('<script>')
  })
})

describe('local search', () => {
  const email = { subject: 'Dinner this weekend?', contentText: 'That new Thai place downtown', sender: ALICE }

  it('needs every word to appear somewhere in the email', () => {
    expect(matchesQuery(email, tokenize('thai DINNER'))).toBe(true)
    expect(matchesQuery(email, tokenize('alice thai'))).toBe(true)
    expect(matchesQuery(email, tokenize('thai lunch'))).toBe(false)
  })

  it('puts server results first and adds anything only found locally', () => {
    const result = (id: number): EmailSearchResult => ({
      id, threadId: id, subject: '', snippet: '', senderName: null, senderEmail: '', sentAt: null, isRead: true,
    })
    expect(mergeResults([result(1), result(2)], [result(3), result(2)]).map(r => r.id)).toEqual([3, 2, 1])
  })
})

describe('displayedUnreadCount', () => {
  it('never goes below zero', () => {
    expect(displayedUnreadCount(1, { folders: { 1: 1 } }, { 1: 3 }, { 1: 0 })).toBe(0)
  })
})
