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

const route = useRoute()
const { data: thread, pending, error } = await useFetch<Thread>(`/api/threads/${route.params.id}`)
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
        <EmailMessage
          v-for="email in thread.emails"
          :key="email.id"
          :email="email"
        />
      </div>
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
</style>
