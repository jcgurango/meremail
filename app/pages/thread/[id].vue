<script setup lang="ts">
interface Participant {
  id: number
  name: string | null
  email: string
  isMe?: boolean
  role?: string
}

interface Attachment {
  id: number
  filename: string
  mimeType: string | null
  size: number | null
}

interface Email {
  id: number
  subject: string
  content: string
  sentAt: string | null
  receivedAt: string | null
  isRead: boolean
  sender: Participant | null
  recipients: Participant[]
  attachments: Attachment[]
}

interface Thread {
  id: number
  subject: string
  createdAt: string
  emails: Email[]
}

interface SplitContent {
  visible: string
  quoted: string | null
}

const route = useRoute()
const { data: thread, pending, error } = await useFetch<Thread>(`/api/threads/${route.params.id}`)

// Track which emails have their quoted content expanded
const expandedQuotes = ref<Set<number>>(new Set())

function toggleQuote(emailId: number) {
  if (expandedQuotes.value.has(emailId)) {
    expandedQuotes.value.delete(emailId)
  } else {
    expandedQuotes.value.add(emailId)
  }
  // Trigger reactivity
  expandedQuotes.value = new Set(expandedQuotes.value)
}

// Quote detection patterns
const QUOTE_PATTERNS = [
  // "On May 26, 2016, at 1:31 AM, Name <email> wrote:" (Apple Mail, Gmail)
  /On\s+.{1,150}\s+wrote:\s*/i,
  // "---------- Forwarded message ----------"
  /-{5,}\s*Forwarded message\s*-{5,}/i,
  // Outlook: "From: ... Sent: ..." or "From: ... Date: ..."
  /From:\s*[^\n]+\n\s*(Sent|Date):\s*[^\n]+\n\s*(To|Subject):/i,
  // German: "Am ... schrieb ..."
  /Am\s+.{1,100}\s+schrieb\s+.{1,100}:/i,
]

// Gmail quote div pattern (for HTML)
const GMAIL_QUOTE_PATTERN = /<div\s+class="gmail_quote"/i

function splitQuotedContent(content: string): SplitContent {
  // Check if content is wrapped in <pre> (plain text email)
  const preMatch = content.match(/^<pre([^>]*)>([\s\S]*)<\/pre>$/i)
  if (preMatch) {
    const preAttrs = preMatch[1]
    const innerContent = preMatch[2]

    // Split the inner content
    const innerSplit = splitInnerContent(innerContent)
    if (innerSplit.quoted) {
      return {
        visible: `<pre${preAttrs}>${innerSplit.visible}</pre>`,
        quoted: `<pre${preAttrs}>${innerSplit.quoted}</pre>`,
      }
    }
    return { visible: content, quoted: null }
  }

  // For HTML content, split directly
  return splitInnerContent(content)
}

function splitInnerContent(content: string): SplitContent {
  // First check for Gmail quote div (very reliable)
  const gmailMatch = content.match(GMAIL_QUOTE_PATTERN)
  if (gmailMatch && gmailMatch.index !== undefined) {
    return {
      visible: content.substring(0, gmailMatch.index).trim(),
      quoted: content.substring(gmailMatch.index),
    }
  }

  // Check text-based patterns
  for (const pattern of QUOTE_PATTERNS) {
    const match = content.match(pattern)
    if (match && match.index !== undefined) {
      // Only split if the quote marker isn't at the very beginning
      if (match.index > 50) {
        return {
          visible: content.substring(0, match.index).trim(),
          quoted: content.substring(match.index),
        }
      }
    }
  }

  return { visible: content, quoted: null }
}

// Cache split content for each email
const splitContentCache = computed(() => {
  const cache = new Map<number, SplitContent>()
  if (thread.value) {
    for (const email of thread.value.emails) {
      cache.set(email.id, splitQuotedContent(email.content))
    }
  }
  return cache
})

function getSplitContent(emailId: number): SplitContent {
  return splitContentCache.value.get(emailId) || { visible: '', quoted: null }
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  return date.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getSenderDisplay(sender: Participant | null): string {
  if (!sender) return 'Unknown'
  if (sender.isMe) return 'Me'
  return sender.name || sender.email.split('@')[0]
}

function getRecipientsDisplay(recipients: Participant[]): string {
  const toRecipients = recipients.filter((r) => r.role === 'to')
  if (toRecipients.length === 0) return ''
  const names = toRecipients.map((r) => {
    if (r.isMe) return 'me'
    return r.name || r.email.split('@')[0]
  })
  return names.join(', ')
}

// File type icons based on mime type or extension
function getFileIcon(mimeType: string | null, filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''

  // Check mime type first
  if (mimeType) {
    if (mimeType.startsWith('image/')) return '🖼'
    if (mimeType.startsWith('video/')) return '🎬'
    if (mimeType.startsWith('audio/')) return '🎵'
    if (mimeType === 'application/pdf') return '📄'
    if (mimeType.includes('zip') || mimeType.includes('compressed')) return '📦'
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return '📊'
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '📽'
    if (mimeType.includes('document') || mimeType.includes('word')) return '📝'
  }

  // Fall back to extension
  const iconMap: Record<string, string> = {
    pdf: '📄',
    doc: '📝', docx: '📝', odt: '📝', rtf: '📝',
    xls: '📊', xlsx: '📊', ods: '📊', csv: '📊',
    ppt: '📽', pptx: '📽', odp: '📽',
    zip: '📦', rar: '📦', '7z': '📦', tar: '📦', gz: '📦',
    jpg: '🖼', jpeg: '🖼', png: '🖼', gif: '🖼', webp: '🖼', svg: '🖼', bmp: '🖼',
    mp4: '🎬', mov: '🎬', avi: '🎬', mkv: '🎬', webm: '🎬',
    mp3: '🎵', wav: '🎵', ogg: '🎵', flac: '🎵', m4a: '🎵',
    txt: '📃', md: '📃', json: '📃', xml: '📃',
    html: '🌐', htm: '🌐', css: '🌐',
    js: '⚙', ts: '⚙', py: '⚙', rb: '⚙', java: '⚙', c: '⚙', cpp: '⚙',
  }

  return iconMap[ext] || '📎'
}

function formatFileSize(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
</script>

<template>
  <div class="thread-view">
    <header class="header">
      <NuxtLink to="/" class="back-link">&larr; Back</NuxtLink>
      <h1 v-if="thread">{{ thread.subject }}</h1>
    </header>

    <main class="main">
      <div v-if="pending" class="loading">Loading...</div>

      <div v-else-if="error" class="error">
        Failed to load thread: {{ error.message }}
      </div>

      <div v-else-if="thread" class="emails">
        <article v-for="email in thread.emails" :key="email.id" class="email">
          <div class="email-header">
            <div class="email-meta">
              <span class="email-sender">{{ getSenderDisplay(email.sender) }}</span>
              <span v-if="getRecipientsDisplay(email.recipients)" class="email-recipients">
                to {{ getRecipientsDisplay(email.recipients) }}
              </span>
            </div>
            <time class="email-date">{{ formatDateTime(email.sentAt) }}</time>
          </div>
          <ClientOnly>
            <div class="email-body">
              <div class="email-content" v-html="getSplitContent(email.id).visible"></div>
              <template v-if="getSplitContent(email.id).quoted">
                <button
                  v-if="!expandedQuotes.has(email.id)"
                  class="show-quoted-btn"
                  @click="toggleQuote(email.id)"
                >
                  &hellip;
                </button>
                <div
                  v-if="expandedQuotes.has(email.id)"
                  class="email-content quoted-content"
                  v-html="getSplitContent(email.id).quoted"
                ></div>
                <button
                  v-if="expandedQuotes.has(email.id)"
                  class="hide-quoted-btn"
                  @click="toggleQuote(email.id)"
                >
                  Hide quoted text
                </button>
              </template>
              <div v-if="email.attachments.length > 0" class="attachments">
                <div class="attachments-header">
                  {{ email.attachments.length }} attachment{{ email.attachments.length > 1 ? 's' : '' }}
                </div>
                <ul class="attachment-list">
                  <li v-for="attachment in email.attachments" :key="attachment.id">
                    <a :href="`/api/attachments/${attachment.id}`" target="_blank" class="attachment-item">
                      <span class="attachment-icon">{{ getFileIcon(attachment.mimeType, attachment.filename) }}</span>
                      <span class="attachment-name">{{ attachment.filename }}</span>
                      <span v-if="attachment.size" class="attachment-size">{{ formatFileSize(attachment.size) }}</span>
                    </a>
                  </li>
                </ul>
              </div>
            </div>
            <template #fallback>
              <div class="email-body">
                <div class="email-content" v-html="email.content"></div>
                <div v-if="email.attachments.length > 0" class="attachments">
                  <div class="attachments-header">
                    {{ email.attachments.length }} attachment{{ email.attachments.length > 1 ? 's' : '' }}
                  </div>
                  <ul class="attachment-list">
                    <li v-for="attachment in email.attachments" :key="attachment.id">
                      <a :href="`/api/attachments/${attachment.id}`" target="_blank" class="attachment-item">
                        <span class="attachment-icon">{{ getFileIcon(attachment.mimeType, attachment.filename) }}</span>
                        <span class="attachment-name">{{ attachment.filename }}</span>
                        <span v-if="attachment.size" class="attachment-size">{{ formatFileSize(attachment.size) }}</span>
                      </a>
                    </li>
                  </ul>
                </div>
              </div>
            </template>
          </ClientOnly>
        </article>
      </div>
    </main>
  </div>
</template>

<style scoped>
.thread-view {
  min-height: 100vh;
}

.header {
  padding: 24px 20px;
  border-bottom: 1px solid #e5e5e5;
}

.back-link {
  display: inline-block;
  margin-bottom: 12px;
  color: #666;
  text-decoration: none;
  font-size: 14px;
}

.back-link:hover {
  color: #333;
}

.header h1 {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: #1a1a1a;
}

.main {
  padding: 0;
}

.loading,
.error {
  padding: 40px 20px;
  text-align: center;
  color: #666;
}

.error {
  color: #991b1b;
}

.emails {
  display: flex;
  flex-direction: column;
}

.email {
  padding: 24px 20px;
  border-bottom: 1px solid #f0f0f0;
}

.email:last-child {
  border-bottom: none;
}

.email-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 16px;
}

.email-meta {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.email-sender {
  font-weight: 600;
  font-size: 14px;
  color: #1a1a1a;
}

.email-recipients {
  font-size: 13px;
  color: #666;
}

.email-date {
  font-size: 12px;
  color: #888;
  flex-shrink: 0;
}

.email-content {
  font-size: 14px;
  line-height: 1.6;
  color: #333;
  overflow-wrap: break-word;
  word-wrap: break-word;
}

.email-content :deep(blockquote) {
  margin: 12px 0;
  padding-left: 12px;
  border-left: 2px solid #ddd;
  color: #666;
}

.email-content :deep(a) {
  color: #333;
}

.email-content :deep(img) {
  max-width: 100%;
  height: auto;
}

.email-content :deep(pre) {
  background: #f5f5f5;
  padding: 12px;
  border-radius: 4px;
  overflow-x: auto;
}

.email-body {
  position: relative;
}

.show-quoted-btn {
  display: inline-block;
  margin-top: 12px;
  padding: 4px 12px;
  font-size: 14px;
  font-weight: 500;
  color: #666;
  background: #f5f5f5;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  letter-spacing: 2px;
}

.show-quoted-btn:hover {
  background: #eee;
  color: #333;
}

.quoted-content {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px dashed #ddd;
  opacity: 0.75;
}

.hide-quoted-btn {
  display: inline-block;
  margin-top: 12px;
  padding: 4px 12px;
  font-size: 12px;
  color: #888;
  background: none;
  border: none;
  cursor: pointer;
}

.hide-quoted-btn:hover {
  color: #333;
}

.attachments {
  margin-top: 16px;
  padding: 12px;
  background: #f9f9f9;
  border-radius: 6px;
}

.attachments-header {
  font-size: 12px;
  font-weight: 500;
  color: #666;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.attachment-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

a.attachment-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: #fff;
  border: 1px solid #e5e5e5;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
  text-decoration: none;
  color: inherit;
}

a.attachment-item:hover {
  border-color: #ccc;
  background: #fafafa;
}

.attachment-icon {
  font-size: 16px;
  line-height: 1;
}

.attachment-name {
  color: #333;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attachment-size {
  color: #888;
  font-size: 11px;
}
</style>
