<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import EmailMessage from '@/components/EmailMessage.vue'
import EmailComposer from '@/components/EmailComposer.vue'
import { getThread as apiGetThread } from '@/utils/api'
import { retractNotification } from '@/composables/useOffline'

interface Participant {
  id: number
  name: string | null
  email: string
  isMe?: boolean
  role: string
}

interface Attachment {
  id: number
  filename: string
  mimeType: string | null
  size: number | null
  isInline: boolean | null
}

interface Email {
  id: number
  subject: string
  content: string
  contentText: string
  contentHtml?: string | null
  sentAt: string | null
  receivedAt: string | null
  isRead: boolean
  status: 'draft' | 'queued' | 'sent'
  sender: Participant | null
  recipients: Participant[]
  attachments: Attachment[]
  messageId?: string | null
  references?: string[] | null
  inReplyTo?: string | null
  replyTo?: string | null
  queuedAt?: string | null
  sendAttempts?: number
  lastSendError?: string | null
}

interface Thread {
  id: number
  subject: string
  createdAt: string
  replyLaterAt: string | null
  setAsideAt: string | null
  emails: Email[]
  defaultFromId: number | null
}

const route = useRoute()
const router = useRouter()

const thread = ref<Thread | null>(null)
const pending = ref(true)
const error = ref<Error | null>(null)

const pageTitle = computed(() => thread.value?.subject ? `${thread.value.subject} - MereMail` : 'MereMail')

onMounted(async () => {
  document.title = pageTitle.value
  await loadThread()
})

watch(pageTitle, (newTitle) => {
  document.title = newTitle
})

const isFromCache = ref(false)

async function loadThread() {
  pending.value = true
  error.value = null
  isFromCache.value = false

  const threadId = Number(route.params.id)

  try {
    const result = await apiGetThread(threadId)
    if (result) {
      thread.value = result.data
      isFromCache.value = result.fromCache

      // Retract notifications for all emails in this thread (they're now marked as read)
      for (const email of result.data.emails) {
        retractNotification(`email-${email.id}`)
      }
    } else {
      throw new Error('Thread not found')
    }
  } catch (e) {
    error.value = e as Error
  } finally {
    pending.value = false
  }
}

async function refresh() {
  await loadThread()
}

// Sort emails: drafts appear above the email they're replying to
const sortedEmails = computed(() => {
  if (!thread.value?.emails) return []

  const emails = [...thread.value.emails]
  const result: Email[] = []
  const drafts: Email[] = []

  // Separate drafts from sent emails
  for (const email of emails) {
    if (email.status === 'draft') {
      drafts.push(email)
    } else {
      result.push(email)
    }
  }

  // Sort sent/queued emails by date descending
  // For queued emails, use queuedAt since they don't have sentAt yet
  result.sort((a, b) => {
    const dateA = a.sentAt ? new Date(a.sentAt).getTime()
      : (a.queuedAt ? new Date(a.queuedAt).getTime() : 0)
    const dateB = b.sentAt ? new Date(b.sentAt).getTime()
      : (b.queuedAt ? new Date(b.queuedAt).getTime() : 0)
    return dateB - dateA
  })

  // Insert each draft above the email it's replying to
  for (const draft of drafts) {
    const targetMessageId = draft.inReplyTo
    const targetIndex = result.findIndex(e => e.messageId === targetMessageId)
    if (targetIndex !== -1) {
      result.splice(targetIndex, 0, draft) // Insert at target's index (pushes target down, so draft appears above)
    } else {
      result.unshift(draft) // No target found, put at top
    }
  }

  return result
})

// Composer state - track which email we're replying to or draft we're editing
const replyingToEmailId = ref<number | null>(null)
const replyAll = ref(false)
const editingDraftId = ref<number | null>(null)

// Find the email being replied to
const replyToEmail = computed(() => {
  if (!replyingToEmailId.value || !thread.value) return null
  return thread.value.emails.find(e => e.id === replyingToEmailId.value) || null
})

// Find the draft being edited
const editingDraft = computed(() => {
  if (!editingDraftId.value || !thread.value) return null
  return thread.value.emails.find(e => e.id === editingDraftId.value) || null
})

function handleReply(emailId: number, all: boolean) {
  // Close any draft editing
  editingDraftId.value = null

  // If clicking same email's reply, toggle off
  if (replyingToEmailId.value === emailId && replyAll.value === all) {
    replyingToEmailId.value = null
    return
  }
  replyingToEmailId.value = emailId
  replyAll.value = all
}

function handleEditDraft(emailId: number) {
  // Close any reply composer
  replyingToEmailId.value = null

  // Toggle draft editing
  if (editingDraftId.value === emailId) {
    editingDraftId.value = null
    return
  }
  editingDraftId.value = emailId
}

async function closeComposer() {
  replyingToEmailId.value = null
  editingDraftId.value = null
  // Refresh to show any newly created/updated drafts
  await refresh()
}

async function onDraftDiscarded() {
  replyingToEmailId.value = null
  editingDraftId.value = null
  await refresh() // Refresh to remove deleted draft from list
}

function onDraftSaved(_draftId: number) {
  closeComposer()
}

// Send to menu state
const showSendToMenu = ref(false)

// Count drafts in thread
const draftCount = computed(() => {
  if (!thread.value?.emails) return 0
  return thread.value.emails.filter(e => e.status === 'draft').length
})

// Reply Later is "on" if explicitly set OR if there are drafts
const isInReplyLater = computed(() => {
  return !!thread.value?.replyLaterAt || draftCount.value > 0
})

async function toggleReplyLater(deleteDrafts = false) {
  if (!thread.value) return

  // Determine new value based on current "combined" state
  const newValue = !isInReplyLater.value

  try {
    const response = await fetch(`/api/threads/${thread.value.id}/reply-later`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ replyLater: newValue, deleteDrafts })
    })

    if (response.ok) {
      const data = await response.json() as {
        success: boolean
        requiresConfirmation?: boolean
        draftCount?: number
        message?: string
        replyLater?: boolean
        replyLaterAt?: string | null
      }

      // If confirmation is required (has drafts), show confirm dialog
      if (data.requiresConfirmation) {
        const confirmed = window.confirm(
          `${data.message}\n\nAre you sure you want to remove this thread from Reply Later and delete the draft${data.draftCount! > 1 ? 's' : ''}?`
        )
        if (confirmed) {
          // Retry with deleteDrafts: true
          await toggleReplyLater(true)
        }
        return
      }

      // Update local state
      thread.value.replyLaterAt = data.replyLaterAt || null

      // If drafts were deleted, refresh to update the email list
      if (deleteDrafts) {
        await refresh()
      }

      showSendToMenu.value = false
    }
  } catch (e) {
    console.error('Failed to update reply later status:', e)
  }
}

async function toggleSetAside() {
  if (!thread.value) return
  const newValue = !thread.value.setAsideAt

  try {
    await fetch(`/api/threads/${thread.value.id}/set-aside`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setAside: newValue })
    })
    // Update local state - set to current time or null
    thread.value.setAsideAt = newValue ? new Date().toISOString() : null
    showSendToMenu.value = false
  } catch (e) {
    console.error('Failed to update set aside status:', e)
  }
}

function goBack() {
  router.back()
}
</script>

<template>
  <div class="thread-view">
    <header class="header">
      <div class="header-top">
        <button class="back-link" @click="goBack">&larr; Back</button>
        <div v-if="thread" class="header-actions">
          <div class="send-to-wrapper">
            <button
              class="send-to-btn"
              :class="{ active: isInReplyLater || thread.setAsideAt }"
              @click="showSendToMenu = !showSendToMenu"
            >
              Send to
              <span class="dropdown-arrow">▼</span>
            </button>
            <div v-if="showSendToMenu" class="send-to-menu">
              <button class="menu-item" @click="toggleReplyLater()">
                <span class="menu-check">{{ isInReplyLater ? '✓' : '' }}</span>
                Reply Later
                <span v-if="draftCount > 0" class="draft-indicator">({{ draftCount }} draft{{ draftCount > 1 ? 's' : '' }})</span>
              </button>
              <button class="menu-item" @click="toggleSetAside">
                <span class="menu-check">{{ thread.setAsideAt ? '✓' : '' }}</span>
                Set Aside
              </button>
            </div>
          </div>
        </div>
      </div>
      <h1 v-if="thread">{{ thread.subject }}</h1>
    </header>

    <main class="main">
      <div v-if="pending" class="loading">Loading...</div>

      <div v-else-if="error" class="error">
        Failed to load thread: {{ error.message }}
      </div>

      <template v-else-if="thread">
        <div v-if="isFromCache" class="offline-notice">
          Viewing cached version (offline)
        </div>
        <div class="emails">
          <template v-for="email in sortedEmails" :key="email.id">
            <!-- Inline composer for replying -->
            <div v-if="replyingToEmailId === email.id" class="inline-composer">
              <EmailComposer
                :thread-id="thread.id"
                :original-email="{
                  id: email.id,
                  subject: email.subject,
                  sentAt: email.sentAt,
                  sender: email.sender,
                  recipients: email.recipients,
                  contentText: email.contentText,
                  messageId: email.messageId || undefined,
                  references: email.references || undefined,
                  replyTo: email.replyTo || undefined,
                }"
                :reply-all="replyAll"
                :default-from-id="thread.defaultFromId || undefined"
                @close="closeComposer"
                @discarded="onDraftDiscarded"
                @sent="onDraftSaved"
              />
            </div>

            <!-- Inline composer for editing draft -->
            <div v-if="editingDraftId === email.id && email.status === 'draft'" class="inline-composer">
              <EmailComposer
                :thread-id="thread.id"
                :existing-draft="{
                  id: email.id,
                  subject: email.subject,
                  contentText: email.contentText,
                  contentHtml: email.contentHtml,
                  sender: email.sender,
                  recipients: email.recipients.map(r => ({ id: r.id, email: r.email, name: r.name, role: r.role || 'to' })),
                  attachments: email.attachments,
                }"
                :default-from-id="thread.defaultFromId || undefined"
                @close="closeComposer"
                @discarded="onDraftDiscarded"
                @sent="onDraftSaved"
              />
            </div>

            <!-- Draft email - show as editable -->
            <article v-if="email.status === 'draft' && editingDraftId !== email.id" class="draft-email" @click="handleEditDraft(email.id)">
              <div class="draft-badge">Draft</div>
              <div class="draft-preview">
                <div class="draft-to" v-if="email.recipients.length">
                  To: {{ email.recipients.filter(r => r.role === 'to').map(r => r.name || r.email).join(', ') || 'No recipients' }}
                </div>
                <div class="draft-subject">{{ email.subject || '(No subject)' }}</div>
                <div class="draft-snippet">{{ email.contentText?.slice(0, 100) || '(No content)' }}</div>
              </div>
              <button class="edit-draft-btn">Edit</button>
            </article>

            <!-- Queued email - show like regular email with status badge -->
            <div v-else-if="email.status === 'queued'" class="queued-email-wrapper">
              <div class="queued-status-bar">
                <span class="queued-badge">Queued</span>
                <span v-if="email.lastSendError" class="queued-error">
                  Send failed: {{ email.lastSendError }}
                  <span class="retry-info">(Retrying automatically)</span>
                </span>
              </div>
              <EmailMessage
                :email="email"
                :show-reply-buttons="false"
              />
            </div>

            <!-- Regular sent email -->
            <EmailMessage
              v-else
              :email="email"
              :show-reply-buttons="true"
              @reply="handleReply"
            />
          </template>
        </div>
      </template>
    </main>
  </div>
</template>

<style scoped>
.thread-view {
  min-height: 100vh;
}

.header {
  padding: 20px;
  border-bottom: 1px solid #e5e5e5;
}

.header-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}

.back-link {
  display: inline-block;
  color: #666;
  text-decoration: none;
  font-size: 14px;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
}

.back-link:hover {
  color: #000;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.send-to-wrapper {
  position: relative;
}

.send-to-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: #fff;
  border: 1px solid #e5e5e5;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.send-to-btn:hover {
  border-color: #ccc;
}

.send-to-btn.active {
  background: #dbeafe;
  border-color: #3b82f6;
  color: #1d4ed8;
}

.dropdown-arrow {
  font-size: 10px;
  opacity: 0.6;
}

.send-to-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  min-width: 160px;
  background: #fff;
  border: 1px solid #e5e5e5;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  z-index: 100;
  overflow: hidden;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  background: none;
  border: none;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
  transition: background 0.1s;
}

.menu-item:hover {
  background: #f5f5f5;
}

.menu-check {
  width: 16px;
  text-align: center;
  color: #22c55e;
}

.draft-indicator {
  margin-left: auto;
  font-size: 12px;
  color: #f59e0b;
  font-weight: 500;
}

h1 {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.02em;
  margin: 0;
}

.main {
  max-width: 800px;
  margin: 0 auto;
}

.loading,
.error {
  padding: 40px 20px;
  text-align: center;
  color: #666;
}

.error {
  color: #dc2626;
}

.offline-notice {
  margin: 20px;
  padding: 12px 16px;
  background: #fef3c7;
  border: 1px solid #f59e0b;
  border-radius: 8px;
  color: #92400e;
  font-size: 14px;
  text-align: center;
}

.emails {
  border: 1px solid #e5e5e5;
  border-radius: 8px;
  margin: 20px;
  overflow: hidden;
}

.inline-composer {
  background: #fafafa;
  border-bottom: 1px solid #eee;
}

.draft-email {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  border-bottom: 1px solid #eee;
  background: #fffbeb;
  cursor: pointer;
  transition: background 0.15s;
}

.draft-email:hover {
  background: #fef3c7;
}

.draft-badge {
  padding: 4px 8px;
  background: #f59e0b;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  border-radius: 4px;
  flex-shrink: 0;
}

.draft-preview {
  flex: 1;
  min-width: 0;
}

.draft-to {
  font-size: 13px;
  color: #666;
  margin-bottom: 2px;
}

.draft-subject {
  font-weight: 500;
  font-size: 14px;
  margin-bottom: 2px;
}

.draft-snippet {
  font-size: 13px;
  color: #666;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.edit-draft-btn {
  padding: 6px 12px;
  background: #fff;
  border: 1px solid #e5e5e5;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
  flex-shrink: 0;
}

.edit-draft-btn:hover {
  border-color: #999;
}

.queued-email-wrapper {
  border-bottom: 1px solid #eee;
}

.queued-status-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  background: #eff6ff;
  border-bottom: 1px solid #dbeafe;
}

.queued-badge {
  padding: 4px 8px;
  background: #3b82f6;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  border-radius: 4px;
}

.queued-error {
  font-size: 13px;
  color: #dc2626;
}

.retry-info {
  color: #666;
  font-style: italic;
  margin-left: 4px;
}
</style>
