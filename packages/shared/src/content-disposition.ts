// Content-Disposition headers for attachment downloads. Header values must be
// ByteStrings, so a filename outside ASCII (accents, emoji, the narrow no-break
// space macOS puts in screenshot names) goes in `filename*` (RFC 6266/5987),
// with an ASCII-only `filename` as the fallback.
// Used by the server and the service worker, so no Node or DOM imports.

export function contentDisposition(filename: string | null | undefined, type: 'inline' | 'attachment' = 'inline'): string {
  if (!filename) return type
  const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '')
  if (fallback === filename) return `${type}; filename="${filename}"`
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

export function parseContentDispositionFilename(header: string | null | undefined): string | undefined {
  if (!header) return undefined
  const extended = header.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1]
  if (extended) {
    try {
      return decodeURIComponent(extended.trim())
    } catch {
      // fall through to the plain filename
    }
  }
  return header.match(/filename\s*=\s*"([^"]*)"/i)?.[1] ?? header.match(/filename\s*=\s*([^;\s]+)/i)?.[1]
}
