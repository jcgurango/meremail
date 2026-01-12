<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { RouterLink } from 'vue-router'
import DOMPurify from 'dompurify'
import {
  parseIcs,
  isIcsAttachment,
  formatEventDateRange,
  generateGoogleCalendarUrl,
  generateOutlookCalendarUrl,
  type IcsEvent,
} from '../utils/ics'
import { getRules, addSenderToRule, type Rule } from '../utils/api'

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
  contentText?: string
  sentAt: string | null
  receivedAt: string | null
  isRead: boolean
  sender: Participant | null
  recipients: Participant[]
  attachments: Attachment[]
  replyTo?: string | null
  headers?: { key: string, value: string }[] | null
  messageId?: string | null
  references?: string[] | null
}

const props = defineProps<{
  email: Email
  showReplyButtons?: boolean
}>()

const emit = defineEmits<{
  reply: [emailId: number, replyAll: boolean]
  delete: [emailId: number]
}>()

const showQuoted = ref(false)
const showHeaders = ref(false)

// ICS event parsing
const icsEvents = ref<Map<number, IcsEvent[]>>(new Map())
const icsLoading = ref<Set<number>>(new Set())
const icsError = ref<Map<number, string>>(new Map())
const showCalendarMenu = ref<number | null>(null)

// Find ICS attachments
const icsAttachments = computed(() => {
  return props.email.attachments.filter(
    (a) => isIcsAttachment(a.mimeType, a.filename)
  )
})

// Fetch and parse ICS content
async function fetchIcsContent(attachment: Attachment) {
  if (icsLoading.value.has(attachment.id) || icsEvents.value.has(attachment.id)) {
    return
  }

  icsLoading.value.add(attachment.id)
  icsError.value.delete(attachment.id)

  try {
    const response = await fetch(`/api/attachments/${attachment.id}`)
    if (!response.ok) {
      throw new Error('Failed to fetch ICS file')
    }
    const content = await response.text()
    const events = parseIcs(content)
    icsEvents.value.set(attachment.id, events)
  } catch (err) {
    icsError.value.set(attachment.id, err instanceof Error ? err.message : 'Unknown error')
  } finally {
    icsLoading.value.delete(attachment.id)
  }
}

// Auto-fetch ICS content for detected attachments
watch(
  () => icsAttachments.value,
  (attachments) => {
    for (const attachment of attachments) {
      fetchIcsContent(attachment)
    }
  },
  { immediate: true }
)

function toggleCalendarMenu(attachmentId: number) {
  if (showCalendarMenu.value === attachmentId) {
    showCalendarMenu.value = null
  } else {
    showCalendarMenu.value = attachmentId
  }
}

function closeCalendarMenu() {
  showCalendarMenu.value = null
}

// Add sender to rule feature
const showAddToRuleMenu = ref(false)
const rules = ref<Rule[]>([])
const rulesLoaded = ref(false)
const addingToRule = ref(false)

async function toggleAddToRuleMenu() {
  if (showAddToRuleMenu.value) {
    showAddToRuleMenu.value = false
    return
  }

  // Load rules if not loaded
  if (!rulesLoaded.value) {
    try {
      const result = await getRules()
      rules.value = result.rules
      rulesLoaded.value = true
    } catch (e) {
      console.error('Failed to load rules:', e)
      alert('Failed to load rules')
      return
    }
  }

  showAddToRuleMenu.value = true
}

function closeAddToRuleMenu() {
  showAddToRuleMenu.value = false
}

async function handleAddToRule(rule: Rule) {
  if (!props.email.sender) {
    alert('No sender found')
    return
  }

  addingToRule.value = true
  try {
    const result = await addSenderToRule(rule.id, props.email.sender.email)
    if (result.success) {
      alert(`Added ${props.email.sender.email} to "${rule.name}"`)
      showAddToRuleMenu.value = false
    } else {
      alert(result.error || 'Failed to add sender to rule')
    }
  } catch (e) {
    console.error('Failed to add sender to rule:', e)
    alert('Failed to add sender to rule')
  } finally {
    addingToRule.value = false
  }
}

function sanitizeHtml(html: string): string {
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

const QUOTE_PATTERNS = [
  /On\s+.{1,250}\s+wrote:\s*/i,
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

  const gmailMatch = content.match(GMAIL_QUOTE_PATTERN)
  if (gmailMatch && gmailMatch.index !== undefined && gmailMatch.index > 50) {
    const afterMatch = content.slice(gmailMatch.index, gmailMatch.index + 200)
    const isForward = /forwarded message/i.test(afterMatch)
    if (!isForward) {
      return {
        visible: sanitizeHtml(content.slice(0, gmailMatch.index).trim()),
        quoted: sanitizeHtml(content.slice(gmailMatch.index).trim()),
      }
    }
  }

  const preMatch = content.match(/^<pre([^>]*)>([\s\S]*)<\/pre>$/i)
  if (preMatch) {
    const preAttrs = preMatch[1] ?? ''
    const innerContent = preMatch[2] ?? ''
    const { visible, quoted } = splitInnerContent(innerContent)
    if (quoted) {
      return {
        visible: sanitizeHtml(`<pre${preAttrs}>${visible}</pre>`),
        quoted: sanitizeHtml(`<pre${preAttrs}>${quoted}</pre>`),
      }
    }
    return { visible: sanitizeHtml(content), quoted: null }
  }

  const split = splitInnerContent(content)
  return {
    visible: sanitizeHtml(split.visible),
    quoted: split.quoted ? sanitizeHtml(split.quoted) : null,
  }
})

function getParticipantDisplay(participant: Participant | null, showEmail: boolean = true): string {
  if (!participant) return 'Unknown'
  const emailPart = participant.email.split('@')[0] ?? participant.email
  const displayName = participant.isMe ? 'Me' : (participant.name || emailPart)
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
          <RouterLink
            v-if="email.sender"
            :to="`/contact/${email.sender.id}`"
            class="email-sender contact-link"
          >
            {{ getParticipantDisplay(email.sender) }}
          </RouterLink>
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
            <RouterLink :to="`/contact/${recipient.id}`" class="contact-link">
              {{ getParticipantDisplay(recipient) }}
            </RouterLink>
            <span v-if="idx < getRecipientsByRole(email.recipients, 'to').length - 1">, </span>
          </template>
        </div>
        <div v-if="getRecipientsByRole(email.recipients, 'cc').length" class="email-recipients">
          <span class="recipient-label">Cc:</span>
          <template v-for="(recipient, idx) in getRecipientsByRole(email.recipients, 'cc')" :key="recipient.id">
            <RouterLink :to="`/contact/${recipient.id}`" class="contact-link">
              {{ getParticipantDisplay(recipient) }}
            </RouterLink>
            <span v-if="idx < getRecipientsByRole(email.recipients, 'cc').length - 1">, </span>
          </template>
        </div>
        <div v-if="getRecipientsByRole(email.recipients, 'bcc').length" class="email-recipients">
          <span class="recipient-label">Bcc:</span>
          <template v-for="(recipient, idx) in getRecipientsByRole(email.recipients, 'bcc')" :key="recipient.id">
            <RouterLink :to="`/contact/${recipient.id}`" class="contact-link">
              {{ getParticipantDisplay(recipient) }}
            </RouterLink>
            <span v-if="idx < getRecipientsByRole(email.recipients, 'bcc').length - 1">, </span>
          </template>
        </div>
        <div v-if="email.replyTo" class="email-recipients">
          <span class="recipient-label">Reply-To:</span>
          <span class="reply-to-value">{{ email.replyTo }}</span>
        </div>
      </div>
      <div class="email-date-actions">
        <time class="email-date">{{ formatDateTime(email.sentAt) }}</time>
        <div v-if="showReplyButtons" class="reply-icons">
          <button
            class="reply-icon-btn"
            title="Reply"
            @click="emit('reply', email.id, false)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 17 4 12 9 7"></polyline>
              <path d="M20 18v-2a4 4 0 0 0-4-4H4"></path>
            </svg>
          </button>
          <button
            class="reply-icon-btn"
            title="Reply All"
            @click="emit('reply', email.id, true)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="7 17 2 12 7 7"></polyline>
              <polyline points="12 17 7 12 12 7"></polyline>
              <path d="M22 18v-2a4 4 0 0 0-4-4H7"></path>
            </svg>
          </button>
          <button
            class="reply-icon-btn delete-btn"
            title="Delete email"
            @click="emit('delete', email.id)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
          <div v-if="email.sender && !email.sender.isMe" class="add-to-rule-wrapper">
            <button
              class="reply-icon-btn"
              title="Add sender to rule"
              @click="toggleAddToRuleMenu"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="12" y1="18" x2="12" y2="12"></line>
                <line x1="9" y1="15" x2="15" y2="15"></line>
              </svg>
            </button>
            <div v-if="showAddToRuleMenu" class="add-to-rule-menu" @click.stop>
              <div class="add-to-rule-header">Add sender to rule</div>
              <div v-if="rules.length === 0" class="add-to-rule-empty">
                No rules available
              </div>
              <button
                v-for="rule in rules"
                :key="rule.id"
                class="add-to-rule-item"
                :disabled="addingToRule"
                @click="handleAddToRule(rule)"
              >
                {{ rule.name }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="showHeaders && email.headers" class="headers-panel">
      <div class="headers-title">Email Headers</div>
      <dl class="headers-list">
        <template v-for="header in email.headers">
          <template v-if="header">
            <dt>{{ header.key }}</dt>
            <dd>{{ header.value }}</dd>
          </template>
        </template>
      </dl>
    </div>

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
      <!-- ICS Calendar Events -->
      <div v-for="attachment in icsAttachments" :key="`ics-${attachment.id}`" class="ics-event-container">
        <div v-if="icsLoading.has(attachment.id)" class="ics-loading">
          Loading calendar event...
        </div>
        <div v-else-if="icsError.get(attachment.id)" class="ics-error">
          Failed to load calendar event: {{ icsError.get(attachment.id) }}
        </div>
        <div v-else-if="icsEvents.get(attachment.id)?.length" class="ics-events">
          <div v-for="(event, idx) in icsEvents.get(attachment.id)" :key="idx" class="ics-event-card">
            <div class="ics-event-icon">📅</div>
            <div class="ics-event-details">
              <div class="ics-event-title">{{ event.summary || 'Untitled Event' }}</div>
              <div v-if="event.startDate" class="ics-event-time">
                {{ formatEventDateRange(event.startDate, event.endDate) }}
              </div>
              <div v-if="event.location" class="ics-event-location">
                📍 {{ event.location }}
              </div>
              <div v-if="event.description" class="ics-event-description">
                {{ event.description.length > 150 ? event.description.slice(0, 150) + '...' : event.description }}
              </div>
              <div v-if="event.organizer" class="ics-event-organizer">
                Organized by {{ event.organizer }}
              </div>
            </div>
            <div class="ics-event-actions">
              <div class="calendar-menu-container">
                <button class="add-to-calendar-btn" @click="toggleCalendarMenu(attachment.id)">
                  Add to Calendar
                </button>
                <div v-if="showCalendarMenu === attachment.id" class="calendar-menu" @click.stop>
                  <a
                    :href="generateGoogleCalendarUrl(event)"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="calendar-menu-item"
                    @click="closeCalendarMenu"
                  >
                    Google Calendar
                  </a>
                  <a
                    :href="generateOutlookCalendarUrl(event)"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="calendar-menu-item"
                    @click="closeCalendarMenu"
                  >
                    Outlook.com
                  </a>
                  <a
                    :href="`/api/attachments/${attachment.id}`"
                    download
                    class="calendar-menu-item"
                    @click="closeCalendarMenu"
                  >
                    Download .ics
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

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

.email-date-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
}

.email-date {
  font-size: 12px;
  color: #999;
}

.reply-icons {
  display: flex;
  gap: 4px;
}

.reply-icon-btn {
  background: none;
  border: none;
  padding: 4px;
  cursor: pointer;
  color: #999;
  border-radius: 4px;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.reply-icon-btn:hover {
  color: #000;
  background: #f0f0f0;
}

.reply-icon-btn.delete-btn:hover {
  color: #dc2626;
  background: #fef2f2;
}

.add-to-rule-wrapper {
  position: relative;
}

.add-to-rule-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  background: #fff;
  border: 1px solid #e5e5e5;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 100;
  min-width: 200px;
  max-height: 300px;
  overflow-y: auto;
}

.add-to-rule-header {
  padding: 10px 12px;
  font-size: 12px;
  font-weight: 600;
  color: #666;
  border-bottom: 1px solid #e5e5e5;
}

.add-to-rule-empty {
  padding: 12px;
  font-size: 13px;
  color: #999;
  text-align: center;
}

.add-to-rule-item {
  display: block;
  width: 100%;
  padding: 10px 12px;
  border: none;
  background: none;
  text-align: left;
  font-size: 13px;
  color: #333;
  cursor: pointer;
  transition: background 0.15s;
}

.add-to-rule-item:hover:not(:disabled) {
  background: #f5f5f5;
}

.add-to-rule-item:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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
  overflow-x: auto;
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

/* ICS Calendar Event Styles */
.ics-event-container {
  margin-top: 16px;
}

.ics-loading {
  padding: 12px;
  background: #f9f9f9;
  border-radius: 6px;
  color: #666;
  font-size: 13px;
}

.ics-error {
  padding: 12px;
  background: #fef2f2;
  border-radius: 6px;
  color: #b91c1c;
  font-size: 13px;
}

.ics-event-card {
  display: flex;
  gap: 12px;
  padding: 16px;
  background: linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%);
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  align-items: flex-start;
}

.ics-event-icon {
  font-size: 32px;
  flex-shrink: 0;
}

.ics-event-details {
  flex: 1;
  min-width: 0;
}

.ics-event-title {
  font-weight: 600;
  font-size: 15px;
  color: #1e40af;
  margin-bottom: 4px;
}

.ics-event-time {
  font-size: 14px;
  color: #1e3a8a;
  margin-bottom: 6px;
}

.ics-event-location {
  font-size: 13px;
  color: #4b5563;
  margin-bottom: 4px;
}

.ics-event-description {
  font-size: 13px;
  color: #6b7280;
  margin-top: 8px;
  line-height: 1.4;
}

.ics-event-organizer {
  font-size: 12px;
  color: #9ca3af;
  margin-top: 6px;
}

.ics-event-actions {
  flex-shrink: 0;
}

.calendar-menu-container {
  position: relative;
}

.add-to-calendar-btn {
  padding: 8px 16px;
  background: #2563eb;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
  white-space: nowrap;
}

.add-to-calendar-btn:hover {
  background: #1d4ed8;
}

.calendar-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  min-width: 160px;
  z-index: 10;
  overflow: hidden;
}

.calendar-menu-item {
  display: block;
  padding: 10px 14px;
  font-size: 13px;
  color: #374151;
  text-decoration: none;
  transition: background 0.15s;
}

.calendar-menu-item:hover {
  background: #f3f4f6;
}

.calendar-menu-item:not(:last-child) {
  border-bottom: 1px solid #e5e7eb;
}
</style>
