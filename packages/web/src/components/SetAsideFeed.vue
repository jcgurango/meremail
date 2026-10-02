<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { RouterLink } from 'vue-router'
import EmailMessage from '@/components/EmailMessage.vue'
import { getMeta } from '@/local/db'
import { useLiveQuery } from '@/local/live'
import { listSetAsideEmails } from '@/local/queries'
import { toEmailView, type EmailView } from '@/local/views'
import { enqueue } from '@/local/actions'
import { retractNotification } from '@/composables/useOffline'

defineProps<{
  emptyMessage: string
}>()

const PAGE_SIZE = 20

// Set-aside threads are always held on this device, so the whole feed is local
const { data: feed, loaded } = useLiveQuery(async () => ({
  emails: await listSetAsideEmails(),
  imageProxyUrl: (await getMeta('config'))?.imageProxyUrl ?? '',
}), { emails: [], imageProxyUrl: '' })

// Rendering every email at once would be slow; show them a page at a time
const shown = ref(PAGE_SIZE)
const emails = computed<EmailView[]>(() =>
  feed.value.emails.slice(0, shown.value).map(e => toEmailView(e, feed.value.imageProxyUrl))
)
const hasMore = computed(() => feed.value.emails.length > shown.value)

const itemRefs = ref<HTMLElement[]>([])
const currentMiddleIndex = ref<number | null>(null)
let readDebounceTimeout: ReturnType<typeof setTimeout> | null = null

function loadMore() {
  shown.value += PAGE_SIZE
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

// Scrolling past an email reads it, along with everything above it
function markEmailsReadUpTo(index: number) {
  const idsToMark = emails.value
    .slice(0, index + 1)
    .filter(e => !e.isRead)
    .map(e => e.id)

  if (idsToMark.length === 0) return

  enqueue({ type: 'emails.markRead', payload: { emailIds: idsToMark } })
  for (const id of idsToMark) {
    retractNotification(`email-${id}`)
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

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  if (readDebounceTimeout) {
    clearTimeout(readDebounceTimeout)
  }
})
</script>

<template>
  <div>
    <div v-if="!loaded" class="loading">Loading...</div>

    <div v-else-if="emails.length === 0" class="empty">
      {{ emptyMessage }}
    </div>

    <div v-if="emails.length > 0" class="email-feed">
      <div
        v-for="(email, index) in emails"
        :key="email.id"
        :ref="el => { if (el) itemRefs[index] = el as HTMLElement }"
        class="email-card"
      >
        <div class="email-thread-link">
          <RouterLink :to="`/thread/${email.threadId}`" class="thread-subject">
            {{ email.subject }}
          </RouterLink>
        </div>
        <EmailMessage :email="email" />
      </div>
    </div>

    <div v-if="hasMore" class="load-more">
      <button @click="loadMore" class="load-more-btn">
        Load More
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
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.email-card {
  background: #fff;
  border: 1px solid #e5e5e5;
  border-radius: 8px;
  overflow: hidden;
}

.email-thread-link {
  padding: 12px 16px;
  background: #f9f9f9;
  border-bottom: 1px solid #e5e5e5;
}

.thread-subject {
  font-weight: 600;
  font-size: 14px;
  color: #000;
  text-decoration: none;
}

.thread-subject:hover {
  text-decoration: underline;
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
