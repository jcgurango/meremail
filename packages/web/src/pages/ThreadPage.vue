<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import EmailMessage from '@/components/EmailMessage.vue'
import EmailComposer from '@/components/EmailComposer.vue'
import { db, getMeta, type LocalDraft } from '@/local/db'
import { useLiveQuery } from '@/local/live'
import { getThreadView, defaultFromId as pickDefaultFromId, type ThreadView } from '@/local/queries'
import { toEmailView, type EmailView } from '@/local/views'
import { enqueue, discardDraft } from '@/local/actions'
import { ensureThreads } from '@/local/sync'
import { uuid } from '@/local/uuid'
import { retractNotification } from '@/composables/useOffline'
import { goBackOr } from '@/utils/navigation'

const route = useRoute()
const router = useRouter()

const threadId = computed(() => Number(route.params.id))

// The thread as held on this device; updates live as mail arrives or changes are made
const { data: view, loaded } = useLiveQuery<{ thread: ThreadView | null; imageProxyUrl: string }>(async () => ({
  thread: await getThreadView(threadId.value),
  imageProxyUrl: (await getMeta('config'))?.imageProxyUrl ?? '',
}), { thread: null, imageProxyUrl: '' }, [threadId])

const { data: folders } = useLiveQuery(() => db.folders.orderBy('position').toArray(), [])

const thread = computed(() => view.value.thread?.thread ?? null)
const drafts = computed(() => view.value.thread?.drafts ?? [])
const emails = computed<EmailView[]>(() =>
  (view.value.thread?.emails ?? []).map(e => toEmailView(e, view.value.imageProxyUrl))
)
const defaultFromId = computed(() => pickDefaultFromId(view.value.thread?.emails ?? []) ?? undefined)

// Fetching a thread that isn't on this device (an old link, a search result)
const fetching = ref(false)
const error = ref<Error | null>(null)
const pending = computed(() => !loaded.value || (fetching.value && !thread.value))

async function fetchIfMissing() {
  if (await db.threads.get(threadId.value)) return

  fetching.value = true
  error.value = null
  try {
    await ensureThreads([threadId.value])
    if (!(await db.threads.get(threadId.value))) {
      throw new Error('Thread not found')
    }
  } catch (e) {
    error.value = e instanceof Error && e.message === 'Thread not found'
      ? e
      : new Error('This thread isn\'t on this device, and the server couldn\'t be reached')
  } finally {
    fetching.value = false
  }
}

onMounted(fetchIfMissing)
watch(threadId, fetchIfMissing)

const pageTitle = computed(() => thread.value?.subject ? `${thread.value.subject} - MereMail` : 'MereMail')
watch(pageTitle, (newTitle) => {
  document.title = newTitle
}, { immediate: true })

// Opening a thread reads it
watch(emails, (current) => {
  const unread = current.filter(e => !e.isRead).map(e => e.id)
  if (unread.length === 0) return

  enqueue({ type: 'emails.markRead', payload: { emailIds: unread } })
  for (const id of unread) {
    retractNotification(`email-${id}`)
  }
}, { immediate: true })

type ThreadItem =
  | { kind: 'email'; key: string; email: EmailView }
  | { kind: 'draft'; key: string; draft: LocalDraft }

// Emails newest first, with each draft above the email it's replying to
const items = computed<ThreadItem[]>(() => {
  const result: ThreadItem[] = [...emails.value]
    // For queued emails, use queuedAt since they don't have sentAt yet
    .sort((a, b) => (b.sentAt ?? b.queuedAt ?? 0) - (a.sentAt ?? a.queuedAt ?? 0))
    .map(email => ({ kind: 'email', key: `email-${email.id}`, email }))

  for (const draft of drafts.value) {
    // A reply or forward being written is shown in its composer, not as a separate entry
    if (draft.id === composingDraftId.value && draft.id !== editingDraftId.value) continue

    const item: ThreadItem = { kind: 'draft', key: `draft-${draft.id}`, draft }
    const targetIndex = result.findIndex(i => i.kind === 'email' && i.email.messageId === draft.inReplyTo)
    if (draft.inReplyTo && targetIndex !== -1) {
      result.splice(targetIndex, 0, item)
    } else {
      result.unshift(item)
    }
  }

  return result
})

// Composer state - track which email we're replying to, forwarding, or draft we're editing
const replyingToEmailId = ref<number | null>(null)
const replyAll = ref(false)
const forwardingEmailId = ref<number | null>(null)
const editingDraftId = ref<string | null>(null)
// ID of the draft the open composer is writing to
const composingDraftId = ref<string | null>(null)

function closeComposer() {
  replyingToEmailId.value = null
  forwardingEmailId.value = null
  editingDraftId.value = null
  composingDraftId.value = null
}

function handleReply(emailId: number, all: boolean) {
  // If clicking same email's reply, toggle off
  const same = replyingToEmailId.value === emailId && replyAll.value === all
  closeComposer()
  if (same) return

  replyingToEmailId.value = emailId
  replyAll.value = all
  composingDraftId.value = uuid()
}

function handleForward(emailId: number) {
  // If clicking same email's forward, toggle off
  const same = forwardingEmailId.value === emailId
  closeComposer()
  if (same) return

  forwardingEmailId.value = emailId
  composingDraftId.value = uuid()
}

function handleEditDraft(draftId: string) {
  closeComposer()
  editingDraftId.value = draftId
  composingDraftId.value = draftId
}

// Send to menu state
const showSendToMenu = ref(false)

// Drafts that are still being written (not ones already on their way out)
const draftCount = computed(() => drafts.value.filter(d => !d.sending).length)

// Reply Later is "on" if explicitly set OR if there are drafts
const isInReplyLater = computed(() => {
  return !!thread.value?.replyLaterAt || draftCount.value > 0
})

async function toggleReplyLater() {
  if (!thread.value) return
  const newValue = !isInReplyLater.value

  // Taking a thread out of Reply Later abandons the replies being written for it
  if (!newValue && draftCount.value > 0) {
    const plural = draftCount.value > 1 ? 's' : ''
    const confirmed = window.confirm(
      `This thread has ${draftCount.value} draft${plural}. Removing from Reply Later will delete ${draftCount.value > 1 ? 'them' : 'it'}.\n\nAre you sure you want to remove this thread from Reply Later and delete the draft${plural}?`
    )
    if (!confirmed) return

    closeComposer()
    for (const draft of drafts.value.filter(d => !d.sending)) {
      await discardDraft(draft.id)
    }
  }

  await enqueue({ type: 'thread.replyLater', payload: { threadId: thread.value.id, value: newValue } })
  showSendToMenu.value = false
}

async function toggleSetAside() {
  if (!thread.value) return
  await enqueue({ type: 'thread.setAside', payload: { threadId: thread.value.id, value: !thread.value.setAsideAt } })
  showSendToMenu.value = false
}

async function moveToFolder(folderId: number) {
  if (!thread.value) return
  await enqueue({ type: 'thread.move', payload: { threadId: thread.value.id, folderId } })
  showSendToMenu.value = false
}

// The list this thread belongs in - where Back leads when the thread was opened directly
function listRoute(): string {
  const folder = folders.value.find(f => f.id === thread.value?.folderId)
  if (!folder || folder.id === 1) return '/'
  return `/folder/${folder.name.toLowerCase()}`
}

async function handleTrashThread() {
  if (!thread.value) return
  if (!confirm('Move this thread to Trash?')) return

  // Work out where to return to before the thread moves to Trash
  const returnTo = listRoute()
  await enqueue({ type: 'thread.trash', payload: { threadId: thread.value.id } })
  goBackOr(router, returnTo)
}

async function handleDeleteEmail(emailId: number) {
  if (!confirm('Delete this email?')) return

  // Deleting the last email deletes the thread
  const wasLast = emails.value.length === 1
  const returnTo = listRoute()
  await enqueue({ type: 'email.delete', payload: { emailId } })
  if (wasLast) goBackOr(router, returnTo)
}

function goBack() {
  goBackOr(router, listRoute())
}
</script>

<template>
  <div class="thread-view">
    <header class="header">
      <div class="header-top">
        <button class="back-link" @click="goBack">&larr; Back</button>
        <div v-if="thread" class="header-actions">
          <button class="trash-btn" title="Move to Trash" @click="handleTrashThread">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
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
              <div v-if="folders.length > 0" class="menu-divider"></div>
              <div v-if="folders.length > 0" class="menu-label">Move to folder</div>
              <button
                v-for="folder in folders"
                :key="folder.id"
                class="menu-item"
                @click="moveToFolder(folder.id)"
              >
                <span class="menu-check">{{ thread.folderId === folder.id ? '✓' : '' }}</span>
                {{ folder.name }}
              </button>
            </div>
          </div>
        </div>
      </div>
      <h1 v-if="thread">{{ thread.subject }}</h1>
    </header>

    <main class="main">
      <div v-if="pending" class="loading">Loading...</div>

      <div v-else-if="error && !thread" class="error">
        Failed to load thread: {{ error.message }}
      </div>

      <div v-else-if="!thread" class="error">
        This thread no longer exists.
      </div>

      <template v-else>
        <div class="emails">
          <template v-for="item in items" :key="item.key">
            <template v-if="item.kind === 'email'">
              <!-- Inline composer for replying -->
              <div v-if="replyingToEmailId === item.email.id && composingDraftId" class="inline-composer">
                <EmailComposer
                  :key="composingDraftId"
                  :draft-id="composingDraftId"
                  :thread-id="thread.id"
                  :original-email="{
                    id: item.email.id,
                    subject: item.email.subject,
                    sentAt: item.email.sentAt,
                    sender: item.email.sender,
                    recipients: item.email.recipients,
                    contentText: item.email.contentText,
                    messageId: item.email.messageId || undefined,
                    references: item.email.references,
                    replyTo: item.email.replyTo || undefined,
                  }"
                  :reply-all="replyAll"
                  :default-from-id="defaultFromId"
                  @close="closeComposer"
                  @discarded="closeComposer"
                  @sent="closeComposer"
                />
              </div>

              <!-- Inline composer for forwarding -->
              <div v-if="forwardingEmailId === item.email.id && composingDraftId" class="inline-composer">
                <EmailComposer
                  :key="composingDraftId"
                  :draft-id="composingDraftId"
                  :thread-id="thread.id"
                  :forward-email="{
                    id: item.email.id,
                    subject: item.email.subject,
                    messageId: item.email.messageId || undefined,
                  }"
                  :default-from-id="defaultFromId"
                  @close="closeComposer"
                  @discarded="closeComposer"
                  @sent="closeComposer"
                />
              </div>

              <!-- Queued email - show like regular email with status badge -->
              <div v-if="item.email.status === 'queued'" class="queued-email-wrapper">
                <div class="queued-status-bar">
                  <span class="queued-badge">Queued</span>
                  <span v-if="item.email.lastSendError" class="queued-error">
                    Send failed: {{ item.email.lastSendError }}
                    <span class="retry-info">(Retrying automatically)</span>
                  </span>
                </div>
                <EmailMessage
                  :email="item.email"
                  :show-reply-buttons="false"
                />
              </div>

              <!-- Regular sent email -->
              <EmailMessage
                v-else
                :email="item.email"
                :show-reply-buttons="true"
                @reply="handleReply"
                @forward="handleForward"
                @delete="handleDeleteEmail"
              />
            </template>

            <!-- Inline composer for editing draft, in place of the draft -->
            <div v-else-if="editingDraftId === item.draft.id && !item.draft.sending" class="inline-composer">
              <EmailComposer
                :draft-id="item.draft.id"
                :thread-id="thread.id"
                :existing-draft="item.draft"
                :default-from-id="defaultFromId"
                @close="closeComposer"
                @discarded="closeComposer"
                @sent="closeComposer"
              />
            </div>

            <!-- A reply that has been sent from this device but not yet picked up by the server -->
            <article v-else-if="item.draft.sending" class="draft-email">
              <div class="queued-badge">Queued</div>
              <div class="draft-preview">
                <div class="draft-subject">{{ item.draft.subject || '(No subject)' }}</div>
                <div class="draft-snippet">{{ item.draft.contentText.slice(0, 100) || '(No content)' }}</div>
              </div>
            </article>

            <!-- Draft email - show as editable -->
            <article v-else class="draft-email" @click="handleEditDraft(item.draft.id)">
              <div class="draft-badge">Draft</div>
              <div class="draft-preview">
                <div class="draft-to" v-if="item.draft.recipients.length">
                  To: {{ item.draft.recipients.filter(r => r.role === 'to').map(r => r.name || r.email).join(', ') || 'No recipients' }}
                </div>
                <div class="draft-subject">{{ item.draft.subject || '(No subject)' }}</div>
                <div class="draft-snippet">{{ item.draft.contentText.slice(0, 100) || '(No content)' }}</div>
              </div>
              <button class="edit-draft-btn">Edit</button>
            </article>
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

.trash-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: #fff;
  border: 1px solid #e5e5e5;
  border-radius: 6px;
  cursor: pointer;
  color: #666;
  transition: all 0.15s;
}

.trash-btn:hover {
  border-color: #dc2626;
  color: #dc2626;
  background: #fef2f2;
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

.menu-divider {
  height: 1px;
  background: #e5e5e5;
  margin: 4px 0;
}

.menu-label {
  padding: 6px 12px 4px;
  font-size: 11px;
  font-weight: 600;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.5px;
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
