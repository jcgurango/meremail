<script setup lang="ts">
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
  sender: { id: number; name: string | null; email: string; isMe: boolean } | null
  attachments: Attachment[]
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

// Track expanded emails
const expandedEmails = ref<Set<number>>(new Set())

function toggleEmailExpanded(emailId: number) {
  if (expandedEmails.value.has(emailId)) {
    expandedEmails.value.delete(emailId)
  } else {
    expandedEmails.value.add(emailId)
  }
  expandedEmails.value = new Set(expandedEmails.value)
}

function isEmailExpanded(emailId: number): boolean {
  return expandedEmails.value.has(emailId)
}

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

function formatDate(dateStr: string | null): string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (days === 0) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } else if (days === 1) {
    return 'Yesterday'
  } else if (days < 7) {
    return date.toLocaleDateString([], { weekday: 'short' })
  } else if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  } else {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
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
      <article v-for="email in emails" :key="email.id" class="feed-email">
        <div class="feed-email-header">
          <div class="feed-email-meta">
            <NuxtLink
              v-if="email.sender"
              :to="`/contact/${email.sender.id}`"
              class="feed-sender"
            >
              {{ email.sender.name || email.sender.email }}
            </NuxtLink>
            <span v-else class="feed-sender">Unknown</span>
            <span class="feed-date">{{ formatDate(email.sentAt) }}</span>
          </div>
          <NuxtLink :to="`/thread/${email.threadId}`" class="thread-link-btn" title="View thread">
            →
          </NuxtLink>
        </div>
        <div class="feed-subject">{{ email.subject }}</div>
        <ClientOnly>
          <div
            class="feed-content-wrapper"
            :class="{ expanded: isEmailExpanded(email.id) }"
          >
            <div class="feed-content" v-html="email.content"></div>
            <div class="feed-content-fade"></div>
          </div>
          <button
            class="show-more-btn"
            @click="toggleEmailExpanded(email.id)"
          >
            {{ isEmailExpanded(email.id) ? 'Show Less' : 'Show More' }}
          </button>
        </ClientOnly>
        <div v-if="email.attachments.length > 0" class="feed-attachments">
          <span class="attachments-label">{{ email.attachments.length }} attachment{{ email.attachments.length > 1 ? 's' : '' }}</span>
        </div>
      </article>
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

.feed-email {
  padding: 20px;
  border-bottom: 1px solid #e5e5e5;
}

.feed-email-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}

.feed-email-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.feed-sender {
  font-weight: 600;
  font-size: 14px;
  color: #1a1a1a;
  text-decoration: none;
}

.feed-sender:hover {
  text-decoration: underline;
}

.feed-date {
  font-size: 12px;
  color: #888;
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
  transition: all 0.15s;
}

.thread-link-btn:hover {
  background: #e5e5e5;
  color: #333;
}

.feed-subject {
  font-size: 15px;
  font-weight: 600;
  color: #1a1a1a;
  margin-bottom: 12px;
}

.feed-content-wrapper {
  position: relative;
  max-height: 50vh;
  overflow: hidden;
}

.feed-content-wrapper.expanded {
  max-height: none;
}

.feed-content-wrapper:not(.expanded) .feed-content-fade {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 60px;
  background: linear-gradient(to bottom, transparent, white);
  pointer-events: none;
}

.feed-content-wrapper.expanded .feed-content-fade {
  display: none;
}

.feed-content {
  font-size: 14px;
  line-height: 1.6;
  color: #333;
  overflow-wrap: break-word;
  word-wrap: break-word;
}

.feed-content :deep(img) {
  max-width: 100%;
  height: auto;
}

.feed-content :deep(a) {
  color: #2563eb;
  text-decoration: none;
}

.feed-content :deep(a:hover) {
  text-decoration: underline;
}

.feed-content :deep(pre) {
  overflow-x: auto;
  background: #f5f5f5;
  padding: 8px;
  border-radius: 4px;
  white-space: pre-wrap;
  font-family: inherit;
}

.show-more-btn {
  display: block;
  margin-top: 8px;
  padding: 6px 12px;
  background: none;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 13px;
  color: #666;
  cursor: pointer;
  transition: all 0.15s;
}

.show-more-btn:hover {
  border-color: #999;
  color: #333;
}

.feed-attachments {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #f0f0f0;
}

.attachments-label {
  font-size: 12px;
  color: #666;
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
