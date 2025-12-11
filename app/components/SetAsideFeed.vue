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
  emptyMessage: string
}>()

const emails = ref<FeedEmail[]>([])
const hasMore = ref(false)
const loading = ref(true)
const loadingMore = ref(false)
const error = ref<Error | null>(null)

// Track loaded email IDs to exclude from future fetches
const loadedIds = ref<Set<number>>(new Set())

async function loadEmails() {
  loading.value = true
  error.value = null
  loadedIds.value.clear()

  try {
    const data = await $fetch<FeedResponse>('/api/set-aside')
    emails.value = data.emails
    hasMore.value = data.hasMore

    // Track loaded IDs
    for (const email of data.emails) {
      loadedIds.value.add(email.id)
    }
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
    // Pass already-loaded IDs to exclude
    const excludeList = Array.from(loadedIds.value).join(',')
    const response = await $fetch<FeedResponse>('/api/set-aside', {
      query: { exclude: excludeList }
    })

    // Track new IDs
    for (const email of response.emails) {
      loadedIds.value.add(email.id)
    }

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
      <FeedEmailItem
        v-for="email in emails"
        :key="email.id"
        :email="email"
      />
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
