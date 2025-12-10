import { JSDOM } from 'jsdom'
import DOMPurify from 'dompurify'

// Create a jsdom window for DOMPurify to use server-side
const window = new JSDOM('').window
const purify = DOMPurify(window)

// Configure DOMPurify for email HTML
purify.setConfig({
  // Allow safe HTML elements
  ALLOWED_TAGS: [
    'a', 'abbr', 'address', 'article', 'aside', 'b', 'bdi', 'bdo', 'blockquote',
    'br', 'caption', 'cite', 'code', 'col', 'colgroup', 'data', 'dd', 'del', 'dfn',
    'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3',
    'h4', 'h5', 'h6', 'header', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'main',
    'mark', 'nav', 'ol', 'p', 'pre', 'q', 'rp', 'rt', 'ruby', 's', 'samp',
    'section', 'small', 'span', 'strong', 'sub', 'sup', 'table', 'tbody', 'td',
    'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul', 'var', 'wbr',
    // Allow center and font for legacy email HTML
    'center', 'font',
  ],
  // Allow safe attributes
  ALLOWED_ATTR: [
    'href', 'src', 'alt', 'title', 'width', 'height', 'style', 'class', 'id',
    'colspan', 'rowspan', 'cellpadding', 'cellspacing', 'border', 'align',
    'valign', 'bgcolor', 'color', 'size', 'face', 'target', 'rel',
  ],
  // Allow data: URLs for images (base64 embedded images)
  ALLOW_DATA_ATTR: false,
  ADD_URI_SAFE_ATTR: ['src'],
  // Block dangerous URI schemes
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|cid):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
})

/**
 * Sanitize email HTML for safe rendering within the app.
 * Uses DOMPurify for robust XSS protection.
 */
export function sanitizeEmailHtml(html: string): string {
  // First pass: DOMPurify sanitization
  let clean = purify.sanitize(html)

  // Second pass: Remove document-level tags that DOMPurify keeps
  clean = clean
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<\/?html[^>]*>/gi, '')
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<body[^>]*>/gi, '')
    .replace(/<\/body>/gi, '')
    .replace(/<meta[^>]*\/?>/gi, '')
    .replace(/<title[^>]*>[\s\S]*?<\/title>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<link[^>]*\/?>/gi, '')
    .trim()

  return clean
}
