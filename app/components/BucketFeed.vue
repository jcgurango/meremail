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
  unreadCount: number
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

// Track loaded email IDs to exclude from future fetches
const loadedIds = ref<Set<number>>(new Set())

// Track the boundary index between unread and read emails
const seenBoundaryIndex = ref<number | null>(null)

// Track emails that have been marked as read this session
const markedReadIds = ref<Set<number>>(new Set())

// Pending IDs to mark as read (batched)
const pendingMarkRead = ref<Set<number>>(new Set())
let markReadTimeout: ReturnType<typeof setTimeout> | null = null

async function loadEmails() {
  loading.value = true
  error.value = null
  loadedIds.value.clear()
  markedReadIds.value.clear()
  seenBoundaryIndex.value = null

  try {
    const data = await $fetch<FeedResponse>('/api/feed', { query: { bucket: props.bucket } })
    emails.value = data.emails
    hasMore.value = data.hasMore

    // Track loaded IDs
    for (const email of data.emails) {
      loadedIds.value.add(email.id)
    }

    // Find boundary between unread and read
    updateSeenBoundary()
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
    const response = await $fetch<FeedResponse>('/api/feed', {
      query: { bucket: props.bucket, exclude: excludeList }
    })

    // Track new IDs
    for (const email of response.emails) {
      loadedIds.value.add(email.id)
    }

    emails.value = [...emails.value, ...response.emails]
    hasMore.value = response.hasMore

    // Update boundary
    updateSeenBoundary()
  } catch (e) {
    console.error('Failed to load more:', e)
  } finally {
    loadingMore.value = false
  }
}

function updateSeenBoundary() {
  // Find the first read email that hasn't been marked read this session
  const idx = emails.value.findIndex(e => e.isRead && !markedReadIds.value.has(e.id))
  // Show boundary at index 0 if first email is already read, or at idx if there are unread before it
  seenBoundaryIndex.value = idx >= 0 ? idx : null
}

// Mark email as read when it becomes visible
function onEmailVisible(emailId: number) {
  const email = emails.value.find(e => e.id === emailId)
  if (!email || email.isRead || markedReadIds.value.has(emailId)) return

  // Mark as read locally
  email.isRead = true
  markedReadIds.value.add(emailId)

  // Batch the API call
  pendingMarkRead.value.add(emailId)

  if (markReadTimeout) {
    clearTimeout(markReadTimeout)
  }

  markReadTimeout = setTimeout(() => {
    flushMarkRead()
  }, 1000) // Batch for 1 second
}

async function flushMarkRead() {
  if (pendingMarkRead.value.size === 0) return

  const ids = Array.from(pendingMarkRead.value)
  pendingMarkRead.value.clear()

  try {
    await $fetch('/api/emails/mark-read', {
      method: 'POST',
      body: { ids }
    })
  } catch (e) {
    console.error('Failed to mark emails as read:', e)
  }
}

// Flush on unmount
onBeforeUnmount(() => {
  if (markReadTimeout) {
    clearTimeout(markReadTimeout)
  }
  flushMarkRead()
})

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
      <template v-for="(email, index) in emails" :key="email.id">
        <!-- Show boundary before first already-read email -->
        <div v-if="index === seenBoundaryIndex" class="seen-boundary">
          <span class="seen-boundary-line"></span>
          <span class="seen-boundary-text">Already Seen</span>
          <span class="seen-boundary-line"></span>
        </div>

        <FeedEmailItem
          :email="email"
          @visible="onEmailVisible(email.id)"
        />
      </template>
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

.seen-boundary {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 20px;
  color: #999;
}

.seen-boundary-line {
  flex: 1;
  height: 1px;
  background: #ddd;
}

.seen-boundary-text {
  font-size: 12px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
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
