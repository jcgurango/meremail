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
  replyTo?: string | null
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

// Composer state - track which email we're replying to
const replyingToEmailId = ref<number | null>(null)
const replyAll = ref(false)

// Find the email being replied to
const replyToEmail = computed(() => {
  if (!replyingToEmailId.value || !thread.value) return null
  return thread.value.emails.find(e => e.id === replyingToEmailId.value) || null
})

function handleReply(emailId: number, all: boolean) {
  // If clicking same email's reply, toggle off
  if (replyingToEmailId.value === emailId && replyAll.value === all) {
    replyingToEmailId.value = null
    return
  }
  replyingToEmailId.value = emailId
  replyAll.value = all
}

function closeComposer() {
  replyingToEmailId.value = null
}

function onDraftSaved(draftId: number) {
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
          <template v-for="email in thread.emails" :key="email.id">
            <!-- Inline composer appears above the email being replied to -->
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
                @sent="onDraftSaved"
              />
            </div>
            <EmailMessage
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

.inline-composer {
  background: #fafafa;
  border-bottom: 1px solid #eee;
}
</style>
