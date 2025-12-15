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

// Scroll-based read tracking
const feedRef = ref<HTMLElement | null>(null)
const itemRefs = ref<HTMLElement[]>([])
const currentMiddleIndex = ref<number | null>(null)
let readDebounceTimeout: ReturnType<typeof setTimeout> | null = null

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

// Find which item index intersects with the middle of the viewport
function getMiddleItemIndex(): number | null {
  const items = itemRefs.value
  const viewportMiddle = window.scrollY + window.innerHeight / 2

  let lastValidIndex = -1
  let lastValidTop = 0

  for (let i = 0; i < items.length; i++) {
    const el = items[i]
    if (!el) continue

    const rect = el.getBoundingClientRect()
    const top = rect.top + window.scrollY
    const bottom = top + rect.height

    lastValidIndex = i
    lastValidTop = top

    if (viewportMiddle >= top && viewportMiddle <= bottom) {
      return i
    }
  }

  // If we're past all items, return the last one
  if (lastValidIndex >= 0 && viewportMiddle > lastValidTop) {
    return lastValidIndex
  }

  return null
}

// Mark emails up to and including the given index as read
function markEmailsReadUpTo(index: number) {
  const idsToMark: number[] = []

  for (let i = 0; i <= index; i++) {
    const email = emails.value[i]
    if (!email || email.isRead || markedReadIds.value.has(email.id)) continue

    email.isRead = true
    markedReadIds.value.add(email.id)
    idsToMark.push(email.id)
  }

  if (idsToMark.length > 0) {
    for (const id of idsToMark) {
      pendingMarkRead.value.add(id)
    }
    flushMarkRead()
  }
}

function onScroll() {
  const newIndex = getMiddleItemIndex()

  if (newIndex !== currentMiddleIndex.value) {
    // Index changed, reset the debounce timer
    currentMiddleIndex.value = newIndex

    if (readDebounceTimeout) {
      clearTimeout(readDebounceTimeout)
    }

    if (newIndex !== null) {
      readDebounceTimeout = setTimeout(() => {
        // Index stayed the same for 2 seconds, mark as read
        if (currentMiddleIndex.value === newIndex) {
          markEmailsReadUpTo(newIndex)
        }
      }, 2000)
    }
  }
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

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  // Check initial position
  onScroll()
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  if (readDebounceTimeout) {
    clearTimeout(readDebounceTimeout)
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

    <div v-else ref="feedRef" class="email-feed">
      <template v-for="(email, index) in emails" :key="email.id">
        <!-- Show boundary before first already-read email -->
        <div v-if="index === seenBoundaryIndex" class="seen-boundary">
          <span class="seen-boundary-line"></span>
          <span class="seen-boundary-text">Already Seen</span>
          <span class="seen-boundary-line"></span>
        </div>

        <div :ref="el => { if (el) itemRefs[index] = el as HTMLElement }">
          <FeedEmailItem :email="email" />
        </div>
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
