<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { getSetAsideEmails } from '@/utils/api'
import FeedEmailItem from '@/components/FeedEmailItem.vue'
import { retractNotification } from '@/composables/useOffline'

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
}

defineProps<{
  emptyMessage: string
}>()

const emails = ref<FeedEmail[]>([])
const hasMore = ref(false)
const loading = ref(true)
const loadingMore = ref(false)
const error = ref<Error | null>(null)
const fromCache = ref(false)
const loadedIds = ref<Set<number>>(new Set())
const markedReadIds = ref<Set<number>>(new Set())
const pendingMarkRead = ref<Set<number>>(new Set())
const itemRefs = ref<HTMLElement[]>([])
const currentMiddleIndex = ref<number | null>(null)
let readDebounceTimeout: ReturnType<typeof setTimeout> | null = null

async function loadEmails() {
  loading.value = true
  error.value = null
  loadedIds.value.clear()
  markedReadIds.value.clear()
  fromCache.value = false

  try {
    const result = await getSetAsideEmails()
    emails.value = result.data.emails
    hasMore.value = result.data.hasMore
    fromCache.value = result.fromCache

    for (const email of result.data.emails) {
      loadedIds.value.add(email.id)
    }
  } catch (e) {
    error.value = e as Error
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (loadingMore.value || !hasMore.value || fromCache.value) return
  loadingMore.value = true
  try {
    const excludeList = Array.from(loadedIds.value)
    const result = await getSetAsideEmails(excludeList)

    for (const email of result.data.emails) {
      loadedIds.value.add(email.id)
    }

    emails.value = [...emails.value, ...result.data.emails]
    hasMore.value = result.data.hasMore
  } catch (e) {
    console.error('Failed to load more:', e)
  } finally {
    loadingMore.value = false
  }
}

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

  if (lastValidIndex >= 0 && viewportMiddle > lastValidTop) {
    return lastValidIndex
  }

  return null
}

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
    currentMiddleIndex.value = newIndex

    if (readDebounceTimeout) {
      clearTimeout(readDebounceTimeout)
    }

    if (newIndex !== null) {
      readDebounceTimeout = setTimeout(() => {
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

  // Retract notifications for these emails
  for (const id of ids) {
    retractNotification(`email-${id}`)
  }

  try {
    await fetch('/api/emails/mark-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    })
  } catch (e) {
    console.error('Failed to mark emails as read:', e)
  }
}

onMounted(() => {
  loadEmails()
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  if (readDebounceTimeout) {
    clearTimeout(readDebounceTimeout)
  }
  flushMarkRead()
})
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

    <div v-if="fromCache && !loading" class="cache-notice">
      Showing cached data (offline)
    </div>

    <div v-if="emails.length > 0 && !loading" class="email-feed">
      <div
        v-for="(email, index) in emails"
        :key="email.id"
        :ref="el => { if (el) itemRefs[index] = el as HTMLElement }"
      >
        <FeedEmailItem :email="email" />
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

.cache-notice {
  padding: 8px 20px;
  background: #fef3c7;
  color: #92400e;
  font-size: 13px;
  text-align: center;
  border-bottom: 1px solid #fde68a;
}
</style>
