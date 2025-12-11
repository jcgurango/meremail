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

const props = defineProps<{
  email: FeedEmail
}>()

const emit = defineEmits<{
  visible: []
}>()

const itemRef = ref<HTMLElement | null>(null)
const hasBeenVisible = ref(false)

onMounted(() => {
  if (!itemRef.value) return

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && !hasBeenVisible.value) {
          hasBeenVisible.value = true
          emit('visible')
          observer.disconnect()
        }
      }
    },
    {
      threshold: 0.5, // At least 50% visible
      rootMargin: '0px'
    }
  )

  observer.observe(itemRef.value)

  onBeforeUnmount(() => {
    observer.disconnect()
  })
})
</script>

<template>
  <div ref="itemRef" class="feed-email-wrapper">
    <div class="feed-email-header">
      <div class="feed-subject">
        <span v-if="!email.isRead" class="unread-dot"></span>
        {{ email.subject }}
      </div>
      <NuxtLink :to="`/thread/${email.threadId}`" class="thread-link-btn" title="View full thread">
        &rarr;
      </NuxtLink>
    </div>
    <EmailMessage :email="email" />
  </div>
</template>

<style scoped>
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
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: #1a1a1a;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.unread-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #3b82f6;
  flex-shrink: 0;
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
</style>
