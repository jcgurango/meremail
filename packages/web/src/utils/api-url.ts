let cachedBaseUrl: string = ''

export function setApiBaseUrl(url: string): void {
  cachedBaseUrl = url
}

export function getApiBaseUrl(): string {
  return cachedBaseUrl
}

export function resolveApiUrl(path: string): string {
  if (!cachedBaseUrl || !path.startsWith('/api')) return path
  return cachedBaseUrl + path
}

export function resolveContentUrls(html: string): string {
  if (!cachedBaseUrl) return html
  return html
    .replace(/src="\/api\//g, `src="${cachedBaseUrl}/api/`)
    .replace(/href="\/api\//g, `href="${cachedBaseUrl}/api/`)
}
