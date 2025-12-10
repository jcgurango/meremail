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

interface FeedEmail {
  id: number
  threadId: number
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

interface FeedResponse {
  emails: FeedEmail[]
  hasMore: boolean
}

const props = defineProps<{
  bucket: 'feed' | 'paper_trail'
  emptyMessage: string
}>()

const emails = ref<FeedEmail[]>([])
const hasMore = ref(false)
const loading = ref(true)
const loadingMore = ref(false)
const error = ref<Error | null>(null)

async function loadEmails() {
  loading.value = true
  error.value = null
  try {
    const data = await $fetch<FeedResponse>('/api/feed', { query: { bucket: props.bucket } })
    emails.value = data.emails
    hasMore.value = data.hasMore
  } catch (e) {
    error.value = e as Error
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (loadingMore.value || !hasMore.value) return
  loadingMore.value = true
  try {
    const response = await $fetch<FeedResponse>('/api/feed', {
      query: { bucket: props.bucket, offset: emails.value.length }
    })
    emails.value = [...emails.value, ...response.emails]
    hasMore.value = response.hasMore
  } catch (e) {
    console.error('Failed to load more:', e)
  } finally {
    loadingMore.value = false
  }
}

await loadEmails()
</script>

<template>
  <div>
    <div v-if="loading" class="loading">Loading...</div>

    <div v-else-if="error" class="error">
      Failed to load: {{ error?.message }}
    </div>

    <div v-else-if="emails.length === 0" class="empty">
      {{ emptyMessage }}
    </div>

    <div v-else class="email-feed">
      <div v-for="email in emails" :key="email.id" class="feed-email-wrapper">
        <div class="feed-email-header">
          <div class="feed-subject">{{ email.subject }}</div>
          <NuxtLink :to="`/thread/${email.threadId}`" class="thread-link-btn" title="View full thread">
            →
          </NuxtLink>
        </div>
        <EmailMessage :email="email" />
      </div>
    </div>

    <div v-if="hasMore && !loading" class="load-more">
      <button @click="loadMore" :disabled="loadingMore" class="load-more-btn">
        {{ loadingMore ? 'Loading...' : 'Load More' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.loading,
.error,
.empty {
  padding: 40px 20px;
  text-align: center;
  color: #666;
}

.error {
  color: #991b1b;
}

.email-feed {
  max-width: 800px;
  margin: 0 auto;
  padding: 0;
}

.feed-email-wrapper {
  border-bottom: 1px solid #e5e5e5;
}

.feed-email-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 16px 0;
  gap: 12px;
}

.feed-subject {
  font-size: 15px;
  font-weight: 600;
  color: #1a1a1a;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.thread-link-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #f5f5f5;
  color: #666;
  text-decoration: none;
  font-size: 16px;
  flex-shrink: 0;
  transition: all 0.15s;
}

.thread-link-btn:hover {
  background: #e5e5e5;
  color: #333;
}

.load-more {
  padding: 24px 20px;
  text-align: center;
  border-top: 1px solid #f0f0f0;
}

.load-more-btn {
  padding: 10px 24px;
  font-size: 14px;
  font-weight: 500;
  color: #333;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.load-more-btn:hover:not(:disabled) {
  background: #fafafa;
  border-color: #ccc;
}

.load-more-btn:disabled {
  color: #999;
  cursor: not-allowed;
}
</style>
