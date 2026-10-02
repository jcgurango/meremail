import DOMPurify from 'dompurify'

// Links in an email open in a new tab, and the page they open gets no handle
// on this one (noopener) and isn't told where the click came from (noreferrer)
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.hasAttribute('href')) {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'a', 'abbr', 'address', 'b', 'blockquote', 'br', 'caption', 'cite', 'code',
      'col', 'colgroup', 'dd', 'del', 'dfn', 'div', 'dl', 'dt', 'em', 'figcaption',
      'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd',
      'li', 'mark', 'ol', 'p', 'pre', 'q', 's', 'samp', 'small', 'span', 'strong',
      'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul',
      'var', 'wbr', 'font', 'center',
    ],
    ALLOWED_ATTR: [
      'href', 'src', 'alt', 'title', 'class', 'id', 'style', 'width', 'height',
      'colspan', 'rowspan', 'target', 'rel', 'color', 'size', 'face', 'align',
      'valign', 'bgcolor', 'border', 'cellpadding', 'cellspacing',
    ],
    ALLOW_DATA_ATTR: false,
  })
}
