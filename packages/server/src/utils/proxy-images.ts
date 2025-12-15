import { config } from '@meremail/shared'

/**
 * Rewrites image URLs in HTML content to go through the configured proxy.
 * This helps with privacy (hides user IP) and can improve caching.
 */
export function proxyImagesInHtml(html: string): string {
  const template = config.imageProxy.urlTemplate

  // If no proxy configured, return as-is
  if (!template) return html

  // Match src attributes in img tags (handles both single and double quotes)
  // Also match background-image URLs in style attributes
  return html
    // Proxy <img src="...">
    .replace(
      /<img([^>]*)\ssrc=(["'])([^"']+)\2/gi,
      (match, before, quote, url) => {
        const proxiedUrl = proxyImageUrl(url, template)
        return `<img${before} src=${quote}${proxiedUrl}${quote}`
      }
    )
    // Proxy background-image: url(...)
    .replace(
      /background(-image)?\s*:\s*url\((["']?)([^)"']+)\2\)/gi,
      (match, suffix, quote, url) => {
        const proxiedUrl = proxyImageUrl(url, template)
        return `background${suffix || ''}: url(${quote}${proxiedUrl}${quote})`
      }
    )
}

/**
 * Proxy a single image URL through the configured proxy service.
 */
function proxyImageUrl(url: string, template: string): string {
  // Skip data URIs and already-proxied URLs
  if (url.startsWith('data:')) return url
  if (url.includes('images.weserv.nl')) return url

  // Skip relative URLs (they won't work through proxy anyway)
  if (!url.startsWith('http://') && !url.startsWith('https://')) return url

  // Encode the URL and insert into template
  const encodedUrl = encodeURIComponent(url)
  return template.replace('{url}', encodedUrl)
}
