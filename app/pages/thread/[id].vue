<script setup lang="ts">
interface Participant {
  id: number
  name: string | null
  email: string
  isMe?: boolean
  role?: string
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
}

interface Thread {
  id: number
  subject: string
  createdAt: string
  emails: Email[]
}

const route = useRoute()
const { data: thread, pending, error } = await useFetch<Thread>(`/api/threads/${route.params.id}`)

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
          <div class="email-content" v-html="email.content"></div>
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
</style>
