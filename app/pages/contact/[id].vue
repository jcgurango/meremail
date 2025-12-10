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
  emails: Email[]
}

interface Contact {
  id: number
  name: string | null
  email: string
  bucket: string | null
  isMe: boolean
}

interface ApiResponse {
  contact: Contact
  threads: Thread[]
  totalThreads: number
  hasMore: boolean
}

const route = useRoute()
const contactId = computed(() => Number(route.params.id))

const contact = ref<Contact | null>(null)

const pageTitle = computed(() => {
  if (contact.value) return `${contact.value.name || contact.value.email} - MereMail`
  return 'MereMail'
})
useHead({ title: pageTitle })
const threads = ref<Thread[]>([])
const totalThreads = ref(0)
const hasMore = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)

const buckets = [
  { value: 'approved', label: 'Approved', color: '#22c55e' },
  { value: 'feed', label: 'Feed', color: '#3b82f6' },
  { value: 'paper_trail', label: 'Paper Trail', color: '#a855f7' },
  { value: 'blocked', label: 'Blocked', color: '#ef4444' },
]

async function setBucket(bucket: string) {
  if (!contact.value) return

  const previousBucket = contact.value.bucket
  contact.value.bucket = bucket

  try {
    await $fetch(`/api/screener/${contact.value.id}`, {
      method: 'PATCH',
      body: { bucket },
    })
  } catch (e) {
    contact.value.bucket = previousBucket
    console.error('Failed to update bucket:', e)
  }
}

async function loadThreads(reset = false) {
  if (loading.value) return
  loading.value = true
  error.value = null

  try {
    const offset = reset ? 0 : threads.value.length
    const params = new URLSearchParams({ limit: '20', offset: String(offset) })
    const data = await $fetch<ApiResponse>(`/api/contacts/${contactId.value}?${params}`)

    contact.value = data.contact
    totalThreads.value = data.totalThreads
    hasMore.value = data.hasMore

    if (reset) {
      threads.value = data.threads
    } else {
      threads.value.push(...data.threads)
    }
  } catch (e: any) {
    error.value = e.data?.message || 'Failed to load contact'
  } finally {
    loading.value = false
  }
}

// Initial load
loadThreads(true)
</script>

<template>
  <div class="contact-page">
    <header class="page-header">
      <a href="#" class="back-link" @click.prevent="$router.back()">&larr; Back</a>

      <div v-if="contact" class="contact-header">
        <h1>{{ contact.name || contact.email }}</h1>
        <div class="contact-email" v-if="contact.name">{{ contact.email }}</div>
        <div class="contact-meta">
          <span class="thread-count">{{ totalThreads }} conversation{{ totalThreads !== 1 ? 's' : '' }}</span>
          <span v-if="contact.isMe" class="me-badge">You</span>
        </div>
        <div v-if="!contact.isMe" class="bucket-buttons">
          <button
            v-for="bucket in buckets"
            :key="bucket.value"
            class="bucket-btn"
            :class="{ active: contact.bucket === bucket.value }"
            :style="{ '--btn-color': bucket.color }"
            @click="setBucket(bucket.value)"
          >
            {{ bucket.label }}
          </button>
        </div>
      </div>
    </header>

    <div v-if="error" class="error">{{ error }}</div>

    <div v-else-if="loading && threads.length === 0" class="loading">Loading...</div>

    <div v-else class="threads-list">
      <div v-for="thread in threads" :key="thread.id" class="thread-section">
        <div class="thread-header">
          <NuxtLink :to="`/thread/${thread.id}`" class="thread-subject">
            {{ thread.subject }}
          </NuxtLink>
          <span class="email-count">{{ thread.emails.length }} email{{ thread.emails.length !== 1 ? 's' : '' }}</span>
        </div>

        <div class="emails">
          <EmailMessage
            v-for="email in thread.emails"
            :key="email.id"
            :email="email"
          />
        </div>
      </div>
    </div>

    <div v-if="hasMore" class="load-more">
      <button @click="loadThreads(false)" :disabled="loading">
        {{ loading ? 'Loading...' : 'Load More Conversations' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.contact-page {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
}

.page-header {
  margin-bottom: 24px;
}

.back-link {
  display: inline-block;
  color: #666;
  text-decoration: none;
  font-size: 14px;
  margin-bottom: 12px;
}

.back-link:hover {
  color: #000;
}

.contact-header h1 {
  font-size: 24px;
  font-weight: 600;
  margin: 0 0 4px 0;
}

.contact-email {
  font-size: 14px;
  color: #666;
  margin-bottom: 8px;
}

.contact-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
}

.thread-count {
  color: #666;
}

.me-badge {
  padding: 2px 8px;
  background: #f5f5f5;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  color: #666;
}

.bucket-buttons {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.bucket-btn {
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid var(--btn-color);
  background: #fff;
  color: var(--btn-color);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
}

.bucket-btn:hover {
  background: var(--btn-color);
  color: #fff;
}

.bucket-btn.active {
  background: var(--btn-color);
  color: #fff;
}

.loading,
.error {
  text-align: center;
  padding: 40px 20px;
  color: #666;
}

.error {
  color: #dc2626;
}

.threads-list {
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.thread-section {
  border: 1px solid #e5e5e5;
  border-radius: 8px;
  overflow: hidden;
}

.thread-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
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

.email-count {
  font-size: 12px;
  color: #666;
}

.emails {
  display: flex;
  flex-direction: column;
}

.load-more {
  text-align: center;
  margin-top: 24px;
}

.load-more button {
  padding: 12px 32px;
  background: #000;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  transition: opacity 0.15s;
}

.load-more button:hover:not(:disabled) {
  opacity: 0.85;
}

.load-more button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
