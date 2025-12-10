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
  contentText: string
  sentAt: string | null
  receivedAt: string | null
  isRead: boolean
  sender: Participant | null
  recipients: Participant[]
  attachments: Attachment[]
  messageId?: string | null
  references?: string[] | null
}

interface Thread {
  id: number
  subject: string
  createdAt: string
  emails: Email[]
  defaultFromId: number | null
}

const route = useRoute()
const { data: thread, pending, error } = await useFetch<Thread>(`/api/threads/${route.params.id}`)

const pageTitle = computed(() => thread.value?.subject ? `${thread.value.subject} - MereMail` : 'MereMail')
useHead({ title: pageTitle })

// Composer state
const showComposer = ref(false)
const replyAll = ref(false)
const replyToEmail = ref<Email | null>(null)

// Get the last email for replying
const lastEmail = computed(() => {
  if (!thread.value?.emails.length) return null
  return thread.value.emails[thread.value.emails.length - 1]
})

function openReply(all: boolean) {
  replyAll.value = all
  replyToEmail.value = lastEmail.value
  showComposer.value = true
}

function closeComposer() {
  showComposer.value = false
  replyToEmail.value = null
}

function onDraftSaved(draftId: number) {
  // For now just close the composer
  // Later we could show a success message or refresh the thread
  closeComposer()
}
</script>

<template>
  <div class="thread-view">
    <header class="header">
      <button class="back-link" @click="$router.back()">&larr; Back</button>
      <h1 v-if="thread">{{ thread.subject }}</h1>
    </header>

    <main class="main">
      <div v-if="pending" class="loading">Loading...</div>

      <div v-else-if="error" class="error">
        Failed to load thread: {{ error.message }}
      </div>

      <template v-else-if="thread">
        <div class="emails">
          <EmailMessage
            v-for="email in thread.emails"
            :key="email.id"
            :email="email"
          />
        </div>

        <!-- Reply buttons -->
        <div class="reply-actions">
          <button class="reply-btn" @click="openReply(false)">
            Reply
          </button>
          <button class="reply-btn reply-all" @click="openReply(true)">
            Reply All
          </button>
        </div>

        <!-- Composer modal -->
        <Teleport to="body">
          <div v-if="showComposer" class="composer-overlay" @click.self="closeComposer">
            <div class="composer-modal">
              <EmailComposer
                :thread-id="thread.id"
                :original-email="replyToEmail ? {
                  id: replyToEmail.id,
                  subject: replyToEmail.subject,
                  sentAt: replyToEmail.sentAt,
                  sender: replyToEmail.sender,
                  recipients: replyToEmail.recipients,
                  contentText: replyToEmail.contentText,
                  messageId: replyToEmail.messageId || undefined,
                  references: replyToEmail.references || undefined,
                } : undefined"
                :reply-all="replyAll"
                :default-from-id="thread.defaultFromId || undefined"
                @close="closeComposer"
                @sent="onDraftSaved"
              />
            </div>
          </div>
        </Teleport>
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

.back-link {
  display: inline-block;
  color: #666;
  text-decoration: none;
  font-size: 14px;
  margin-bottom: 8px;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
}

.back-link:hover {
  color: #000;
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

.emails {
  border: 1px solid #e5e5e5;
  border-radius: 8px;
  margin: 20px;
  overflow: hidden;
}

.reply-actions {
  display: flex;
  gap: 12px;
  padding: 0 20px 20px;
}

.reply-btn {
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 500;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
}

.reply-btn:first-child {
  background: #000;
  color: #fff;
  border: none;
}

.reply-btn:first-child:hover {
  opacity: 0.9;
}

.reply-btn.reply-all {
  background: #fff;
  color: #000;
  border: 1px solid #e5e5e5;
}

.reply-btn.reply-all:hover {
  border-color: #999;
}

.composer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.composer-modal {
  width: 100%;
  max-width: 700px;
  max-height: 90vh;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
</style>
