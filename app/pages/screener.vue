<script setup lang="ts">
useHead({ title: 'Screener - MereMail' })

interface Contact {
  id: number
  name: string | null
  email: string
  bucket: string | null
  firstEmailAt: string | null
  emailCount: number
}

interface ApiResponse {
  contacts: Contact[]
  hasMore: boolean
  counts: Record<string, number>
}

const contacts = ref<Contact[]>([])
const hasMore = ref(false)
const counts = ref<Record<string, number>>({})
const loading = ref(false)

const buckets = [
  { value: 'approved', label: 'Approved', color: '#22c55e' },
  { value: 'feed', label: 'Feed', color: '#3b82f6' },
  { value: 'paper_trail', label: 'Paper Trail', color: '#a855f7' },
  { value: 'blocked', label: 'Blocked', color: '#ef4444' },
]

async function loadContacts(reset = false) {
  if (loading.value) return
  loading.value = true

  try {
    const offset = reset ? 0 : contacts.value.length
    const params = new URLSearchParams({ limit: '50', offset: String(offset) })
    const data = await $fetch<ApiResponse>(`/api/screener?${params}`)

    if (reset) {
      contacts.value = data.contacts
    } else {
      contacts.value.push(...data.contacts)
    }
    hasMore.value = data.hasMore
    counts.value = data.counts
  } finally {
    loading.value = false
  }
}

async function setBucket(contactId: number, bucket: string) {
  // Optimistically remove from list
  const index = contacts.value.findIndex(c => c.id === contactId)
  if (index === -1) return

  const contact = contacts.value[index]
  contacts.value.splice(index, 1)

  // Update counts optimistically
  counts.value.unsorted = (counts.value.unsorted || 0) - 1
  counts.value[bucket] = (counts.value[bucket] || 0) + 1

  try {
    await $fetch(`/api/screener/${contactId}`, {
      method: 'PATCH',
      body: { bucket },
    })
  } catch (e) {
    // Revert on error
    contacts.value.splice(index, 0, contact)
    counts.value.unsorted = (counts.value.unsorted || 0) + 1
    counts.value[bucket] = (counts.value[bucket] || 0) - 1
    console.error('Failed to update bucket:', e)
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'No emails'
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  })
}

// Initial load
loadContacts(true)
</script>

<template>
  <div class="screener-page">
    <header class="page-header">
      <NuxtLink to="/" class="back-link">&larr; Threads</NuxtLink>
      <h1>Screener</h1>
    </header>

    <div class="bucket-counts">
      <div class="count-item unsorted">
        <span class="count-number">{{ counts.unsorted || 0 }}</span>
        <span class="count-label">Unsorted</span>
      </div>
      <div v-for="bucket in buckets" :key="bucket.value" class="count-item">
        <span class="count-number">{{ counts[bucket.value] || 0 }}</span>
        <span class="count-label">{{ bucket.label }}</span>
      </div>
    </div>

    <div v-if="contacts.length === 0 && !loading" class="empty-state">
      No contacts to screen
    </div>

    <div class="contacts-list">
      <div v-for="contact in contacts" :key="contact.id" class="contact-card">
        <NuxtLink :to="`/contact/${contact.id}`" class="contact-info">
          <div class="contact-name">{{ contact.name || contact.email.split('@')[0] }}</div>
          <div class="contact-email">{{ contact.email }}</div>
          <div class="contact-meta">
            {{ contact.emailCount }} email{{ contact.emailCount !== 1 ? 's' : '' }}
            <span v-if="contact.firstEmailAt"> · First: {{ formatDate(contact.firstEmailAt) }}</span>
          </div>
        </NuxtLink>
        <div class="bucket-buttons">
          <button
            v-for="bucket in buckets"
            :key="bucket.value"
            class="bucket-btn"
            :style="{ '--btn-color': bucket.color }"
            @click="setBucket(contact.id, bucket.value)"
          >
            {{ bucket.label }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="hasMore" class="load-more">
      <button @click="loadContacts(false)" :disabled="loading">
        {{ loading ? 'Loading...' : 'Load More' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.screener-page {
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
  margin-bottom: 8px;
}

.back-link:hover {
  color: #000;
}

h1 {
  font-size: 24px;
  font-weight: 600;
  margin: 0;
}

.bucket-counts {
  display: flex;
  gap: 16px;
  margin-bottom: 24px;
  padding: 16px;
  background: #f5f5f5;
  border-radius: 8px;
}

.count-item {
  text-align: center;
  flex: 1;
}

.count-number {
  display: block;
  font-size: 24px;
  font-weight: 600;
}

.count-label {
  font-size: 12px;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.count-item.unsorted .count-number {
  color: #000;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: #666;
}

.contacts-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.contact-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 16px;
  background: #fff;
  border: 1px solid #e5e5e5;
  border-radius: 8px;
}

.contact-info {
  flex: 1;
  min-width: 0;
  text-decoration: none;
  color: inherit;
}

.contact-info:hover .contact-name {
  text-decoration: underline;
}

.contact-name {
  font-weight: 500;
  font-size: 15px;
  margin-bottom: 2px;
}

.contact-email {
  font-size: 13px;
  color: #666;
  margin-bottom: 4px;
}

.contact-meta {
  font-size: 12px;
  color: #999;
}

.bucket-buttons {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
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
