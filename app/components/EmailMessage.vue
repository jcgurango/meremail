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
  replyTo?: string | null
  headers?: Record<string, string> | null
}

const props = defineProps<{
  email: Email
}>()

// Track whether quoted content is expanded
const showQuoted = ref(false)

// Track whether headers panel is visible
const showHeaders = ref(false)

// Quote detection patterns (for hiding previously-seen quoted replies, NOT forwarded content)
const QUOTE_PATTERNS = [
  /On\s+.{1,150}\s+wrote:\s*/i,
  /From:\s*[^\n]+\n\s*(Sent|Date):\s*[^\n]+\n\s*(To|Subject):/i,
  /Am\s+.{1,100}\s+schrieb\s+.{1,100}:/i,
]
const GMAIL_QUOTE_PATTERN = /<div\s+class="gmail_quote"/i

interface SplitContent {
  visible: string
  quoted: string | null
}

function splitInnerContent(content: string): { visible: string; quoted: string | null } {
  for (const pattern of QUOTE_PATTERNS) {
    const match = content.match(pattern)
    if (match && match.index !== undefined && match.index > 50) {
      return {
        visible: content.slice(0, match.index).trim(),
        quoted: content.slice(match.index).trim(),
      }
    }
  }
  return { visible: content, quoted: null }
}

const splitContent = computed<SplitContent>(() => {
  const content = props.email.content
  if (!content) return { visible: '', quoted: null }

  // Check for gmail_quote (but skip if it's a forwarded message, not a quote)
  const gmailMatch = content.match(GMAIL_QUOTE_PATTERN)
  if (gmailMatch && gmailMatch.index !== undefined && gmailMatch.index > 50) {
    // Don't hide gmail_quote if it contains a forwarded message
    const afterMatch = content.slice(gmailMatch.index, gmailMatch.index + 200)
    const isForward = /forwarded message/i.test(afterMatch)
    if (!isForward) {
      return {
        visible: content.slice(0, gmailMatch.index).trim(),
        quoted: content.slice(gmailMatch.index).trim(),
      }
    }
  }

  // Check if content is wrapped in <pre> tags (plain text email)
  const preMatch = content.match(/^<pre([^>]*)>([\s\S]*)<\/pre>$/i)
  if (preMatch) {
    const preAttrs = preMatch[1]
    const innerContent = preMatch[2]
    const { visible, quoted } = splitInnerContent(innerContent)
    if (quoted) {
      return {
        visible: `<pre${preAttrs}>${visible}</pre>`,
        quoted: `<pre${preAttrs}>${quoted}</pre>`,
      }
    }
    return { visible: content, quoted: null }
  }

  return splitInnerContent(content)
})

function getParticipantDisplay(participant: Participant | null, showEmail: boolean = true): string {
  if (!participant) return 'Unknown'
  const displayName = participant.isMe ? 'Me' : (participant.name || participant.email.split('@')[0])
  if (showEmail && participant.email) {
    return `${displayName} <${participant.email}>`
  }
  return displayName
}

function getRecipientsByRole(recipients: Participant[], role: string): Participant[] {
  return recipients.filter(r => r.role === role)
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }
  if (diffDays < 7) {
    return date.toLocaleDateString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function getFileIcon(mimeType: string | null, filename: string): string {
  if (mimeType) {
    if (mimeType.startsWith('image/')) return '🖼'
    if (mimeType.startsWith('video/')) return '🎬'
    if (mimeType.startsWith('audio/')) return '🎵'
    if (mimeType === 'application/pdf') return '📄'
    if (mimeType.includes('zip') || mimeType.includes('compressed') || mimeType.includes('archive')) return '📦'
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return '📊'
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '📽'
    if (mimeType.includes('document') || mimeType.includes('word')) return '📝'
  }
  const ext = filename.split('.').pop()?.toLowerCase()
  const iconMap: Record<string, string> = {
    pdf: '📄', doc: '📝', docx: '📝', xls: '📊', xlsx: '📊',
    ppt: '📽', pptx: '📽', zip: '📦', rar: '📦', '7z': '📦',
    jpg: '🖼', jpeg: '🖼', png: '🖼', gif: '🖼', webp: '🖼',
    mp4: '🎬', mov: '🎬', avi: '🎬', mp3: '🎵', wav: '🎵',
    txt: '📃', md: '📃', json: '📃', html: '🌐', css: '🌐',
    js: '⚙', ts: '⚙', py: '⚙', java: '⚙', c: '⚙',
  }
  return iconMap[ext || ''] || '📎'
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
  <article class="email">
    <div class="email-header">
      <div class="email-meta">
        <div class="email-from-line">
          <NuxtLink
            v-if="email.sender"
            :to="`/contact/${email.sender.id}`"
            class="email-sender contact-link"
          >
            {{ getParticipantDisplay(email.sender) }}
          </NuxtLink>
          <span v-else class="email-sender">Unknown</span>
          <button
            class="headers-toggle"
            :class="{ active: showHeaders }"
            @click="showHeaders = !showHeaders"
            title="Show email headers"
          >
            ⓘ
          </button>
        </div>
        <div v-if="getRecipientsByRole(email.recipients, 'to').length" class="email-recipients">
          <span class="recipient-label">To:</span>
          <template v-for="(recipient, idx) in getRecipientsByRole(email.recipients, 'to')" :key="recipient.id">
            <NuxtLink :to="`/contact/${recipient.id}`" class="contact-link">
              {{ getParticipantDisplay(recipient) }}
            </NuxtLink>
            <span v-if="idx < getRecipientsByRole(email.recipients, 'to').length - 1">, </span>
          </template>
        </div>
        <div v-if="getRecipientsByRole(email.recipients, 'cc').length" class="email-recipients">
          <span class="recipient-label">Cc:</span>
          <template v-for="(recipient, idx) in getRecipientsByRole(email.recipients, 'cc')" :key="recipient.id">
            <NuxtLink :to="`/contact/${recipient.id}`" class="contact-link">
              {{ getParticipantDisplay(recipient) }}
            </NuxtLink>
            <span v-if="idx < getRecipientsByRole(email.recipients, 'cc').length - 1">, </span>
          </template>
        </div>
        <div v-if="getRecipientsByRole(email.recipients, 'bcc').length" class="email-recipients">
          <span class="recipient-label">Bcc:</span>
          <template v-for="(recipient, idx) in getRecipientsByRole(email.recipients, 'bcc')" :key="recipient.id">
            <NuxtLink :to="`/contact/${recipient.id}`" class="contact-link">
              {{ getParticipantDisplay(recipient) }}
            </NuxtLink>
            <span v-if="idx < getRecipientsByRole(email.recipients, 'bcc').length - 1">, </span>
          </template>
        </div>
        <div v-if="email.replyTo" class="email-recipients">
          <span class="recipient-label">Reply-To:</span>
          <span class="reply-to-value">{{ email.replyTo }}</span>
        </div>
      </div>
      <time class="email-date">{{ formatDateTime(email.sentAt) }}</time>
    </div>

    <!-- Headers panel -->
    <div v-if="showHeaders && email.headers" class="headers-panel">
      <div class="headers-title">Email Headers</div>
      <dl class="headers-list">
        <template v-for="(value, key) in email.headers" :key="key">
          <template v-if="value && value !== '[object Object]'">
            <dt>{{ key }}</dt>
            <dd>{{ value }}</dd>
          </template>
        </template>
      </dl>
    </div>

    <ClientOnly>
      <div class="email-body">
        <div class="email-content" v-html="splitContent.visible"></div>
        <template v-if="splitContent.quoted">
          <button
            v-if="!showQuoted"
            class="show-quoted-btn"
            @click="showQuoted = true"
          >
            &hellip;
          </button>
          <div
            v-if="showQuoted"
            class="email-content quoted-content"
            v-html="splitContent.quoted"
          ></div>
          <button
            v-if="showQuoted"
            class="hide-quoted-btn"
            @click="showQuoted = false"
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
</template>

<style scoped>
.email {
  padding: 16px;
  border-bottom: 1px solid #eee;
}

.email:last-child {
  border-bottom: none;
}

.email-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 12px;
}

.email-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.email-from-line {
  display: flex;
  align-items: center;
  gap: 6px;
}

.email-sender {
  font-weight: 600;
  font-size: 14px;
  color: #1a1a1a;
}

.headers-toggle {
  background: none;
  border: none;
  padding: 0;
  font-size: 14px;
  color: #999;
  cursor: pointer;
  opacity: 0.6;
  transition: opacity 0.15s;
}

.headers-toggle:hover,
.headers-toggle.active {
  opacity: 1;
  color: #666;
}

.contact-link {
  color: inherit;
  text-decoration: none;
}

.contact-link:hover {
  text-decoration: underline;
}

.email-recipients {
  font-size: 13px;
  color: #666;
  overflow: hidden;
  text-overflow: ellipsis;
}

.recipient-label {
  color: #999;
  margin-right: 4px;
}

.reply-to-value {
  color: #666;
}

.email-date {
  font-size: 12px;
  color: #999;
  flex-shrink: 0;
}

.headers-panel {
  margin-bottom: 12px;
  padding: 12px;
  background: #f5f5f5;
  border-radius: 6px;
  font-size: 12px;
}

.headers-title {
  font-weight: 600;
  margin-bottom: 8px;
  color: #666;
}

.headers-list {
  margin: 0;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  max-height: 300px;
  overflow-y: auto;
}

.headers-list dt {
  font-weight: 500;
  color: #666;
  word-break: break-word;
}

.headers-list dd {
  margin: 0;
  color: #333;
  word-break: break-all;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
}

.email-body {
  font-size: 14px;
  line-height: 1.6;
}

.email-content {
  overflow-wrap: break-word;
  word-wrap: break-word;
}

.email-content :deep(img) {
  max-width: 100%;
  height: auto;
}

.email-content :deep(a) {
  color: #2563eb;
  text-decoration: none;
}

.email-content :deep(a:hover) {
  text-decoration: underline;
}

.email-content :deep(blockquote) {
  margin: 8px 0;
  padding-left: 12px;
  border-left: 3px solid #ddd;
  color: #666;
}

.email-content :deep(pre) {
  overflow-x: auto;
  background: #f5f5f5;
  padding: 8px;
  border-radius: 4px;
  white-space: pre-wrap;
  font-family: inherit;
}

.show-quoted-btn {
  display: inline-block;
  margin: 8px 0;
  padding: 2px 12px;
  background: #f0f0f0;
  border: 1px solid #ddd;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1;
  color: #666;
  cursor: pointer;
  transition: background 0.15s;
}

.show-quoted-btn:hover {
  background: #e5e5e5;
}

.quoted-content {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed #ddd;
  opacity: 0.75;
}

.hide-quoted-btn {
  display: block;
  margin-top: 8px;
  padding: 4px 0;
  background: none;
  border: none;
  font-size: 12px;
  color: #666;
  cursor: pointer;
}

.hide-quoted-btn:hover {
  color: #000;
  text-decoration: underline;
}

.attachments {
  margin-top: 16px;
  padding: 12px;
  background: #f9f9f9;
  border-radius: 6px;
}

.attachments-header {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #666;
  margin-bottom: 8px;
}

.attachment-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.attachment-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: #fff;
  border: 1px solid #e5e5e5;
  border-radius: 4px;
  text-decoration: none;
  color: inherit;
  font-size: 13px;
  transition: border-color 0.15s;
}

.attachment-item:hover {
  border-color: #999;
}

.attachment-icon {
  font-size: 16px;
}

.attachment-name {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attachment-size {
  color: #999;
  font-size: 11px;
}
</style>
