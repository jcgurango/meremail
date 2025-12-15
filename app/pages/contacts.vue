<script setup lang="ts">
useHead({ title: 'Contacts - MereMail' })

const route = useRoute()
const router = useRouter()

interface Contact {
  id: number
  name: string | null
  email: string
  bucket: string | null
  isMe: boolean
  lastEmailAt: string | null
  emailCount: number
}

interface ApiResponse {
  contacts: Contact[]
  hasMore: boolean
  counts: Record<string, number>
}

// View state from URL - default to 'contacts' (approved contacts)
// 'contacts' = approved contacts only (default)
// 'screener' = unsorted contacts
// bucket names (approved, feed, paper_trail, blocked, quarantine) = filter within screener mode
const activeView = computed(() => (route.query.view as string) || 'contacts')
const searchQuery = ref((route.query.q as string) || '')

// Screener mode: any view that's not 'contacts'
const isScreenerMode = computed(() => activeView.value !== 'contacts')

const contacts = ref<Contact[]>([])
const hasMore = ref(false)
const counts = ref<Record<string, number>>({})
const loading = ref(false)
const loadingMore = ref(false)

// Debounce search
let searchTimeout: ReturnType<typeof setTimeout> | null = null

const buckets = [
  { value: 'approved', label: 'Approved', color: '#22c55e' },
  { value: 'feed', label: 'Feed', color: '#3b82f6' },
  { value: 'paper_trail', label: 'Paper Trail', color: '#a855f7' },
  { value: 'blocked', label: 'Blocked', color: '#ef4444' },
  { value: 'quarantine', label: 'Quarantine', color: '#f59e0b' },
]

function getBucketLabel(bucket: string | null): string {
  if (!bucket) return 'Unscreened'
  const found = buckets.find(b => b.value === bucket)
  return found?.label || bucket
}

function getBucketColor(bucket: string | null): string {
  if (!bucket) return '#999'
  const found = buckets.find(b => b.value === bucket)
  return found?.color || '#999'
}

function updateUrl() {
  const query: Record<string, string> = {}
  if (activeView.value !== 'contacts') query.view = activeView.value
  if (searchQuery.value) query.q = searchQuery.value
  router.replace({ query })
}

function setView(view: string) {
  router.replace({ query: { ...route.query, view: view === 'contacts' ? undefined : view } })
}

async function loadContacts(reset = false) {
  if (loading.value) return
  loading.value = true

  try {
    const offset = reset ? 0 : contacts.value.length
    const params = new URLSearchParams({
      limit: '50',
      offset: String(offset),
      view: activeView.value,
    })
    if (searchQuery.value) {
      params.set('q', searchQuery.value)
    }

    const data = await $fetch<ApiResponse>(`/api/contacts?${params}`)

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

async function loadMore() {
  if (loadingMore.value || !hasMore.value) return
  loadingMore.value = true
  try {
    const params = new URLSearchParams({
      limit: '50',
      offset: String(contacts.value.length),
      view: activeView.value,
    })
    if (searchQuery.value) {
      params.set('q', searchQuery.value)
    }

    const data = await $fetch<ApiResponse>(`/api/contacts?${params}`)
    contacts.value.push(...data.contacts)
    hasMore.value = data.hasMore
  } finally {
    loadingMore.value = false
  }
}

async function setBucket(contactId: number, bucket: string) {
  const index = contacts.value.findIndex(c => c.id === contactId)
  if (index === -1) return

  const contact = contacts.value[index]
  if (!contact) return

  const previousBucket = contact.bucket

  // Optimistically update
  contact.bucket = bucket

  // If in screener view, remove from list
  if (activeView.value === 'screener') {
    contacts.value.splice(index, 1)
    counts.value.unsorted = Math.max(0, (counts.value.unsorted || 0) - 1)
    counts.value[bucket] = (counts.value[bucket] || 0) + 1
  }

  try {
    await $fetch(`/api/screener/${contactId}`, {
      method: 'PATCH',
      body: { bucket },
    })
  } catch (e) {
    // Revert on error
    contact.bucket = previousBucket
    if (activeView.value === 'screener') {
      contacts.value.splice(index, 0, contact)
      counts.value.unsorted = (counts.value.unsorted || 0) + 1
      counts.value[bucket] = Math.max(0, (counts.value[bucket] || 0) - 1)
    }
    console.error('Failed to update bucket:', e)
  }
}

function handleSearchInput() {
  if (searchTimeout) clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    updateUrl()
    loadContacts(true)
  }, 300)
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

// Watch for view changes
watch(() => route.query.view, () => {
  loadContacts(true)
})

// Initial load
loadContacts(true)
</script>

<template>
  <div class="contacts-page">
    <header class="page-header">
      <NuxtLink to="/" class="back-link">&larr; Inbox</NuxtLink>
      <h1>Contacts</h1>

      <nav class="view-nav">
        <button
          class="view-pill"
          :class="{ active: activeView === 'contacts' }"
          @click="setView('contacts')"
        >
          Contacts
        </button>
        <button
          class="view-pill"
          :class="{ active: isScreenerMode }"
          @click="setView('screener')"
        >
          Screener
          <span v-if="counts.unsorted" class="pill-count">{{ counts.unsorted }}</span>
        </button>
      </nav>

      <div class="search-box">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Search contacts..."
          @input="handleSearchInput"
        />
      </div>
    </header>

    <div v-if="isScreenerMode" class="bucket-counts">
      <button
        class="count-item"
        :class="{ active: activeView === 'screener' }"
        @click="setView('screener')"
      >
        <span class="count-number">{{ counts.unsorted || 0 }}</span>
        <span class="count-label">Unsorted</span>
      </button>
      <button
        v-for="bucket in buckets"
        :key="bucket.value"
        class="count-item"
        :class="{ active: activeView === bucket.value }"
        @click="setView(bucket.value)"
      >
        <span class="count-number">{{ counts[bucket.value] || 0 }}</span>
        <span class="count-label">{{ bucket.label }}</span>
      </button>
    </div>

    <div v-if="contacts.length === 0 && !loading" class="empty-state">
      {{ activeView === 'screener' ? 'No contacts to screen' : 'No contacts found' }}
    </div>

    <div v-if="loading && contacts.length === 0" class="loading-state">
      Loading...
    </div>

    <div class="contacts-list">
      <div v-for="contact in contacts" :key="contact.id" class="contact-card">
        <NuxtLink :to="`/contact/${contact.id}`" class="contact-info">
          <div class="contact-name">{{ contact.name || contact.email.split('@')[0] }}</div>
          <div class="contact-email">{{ contact.email }}</div>
          <div class="contact-meta">
            <span class="email-count">{{ contact.emailCount }} email{{ contact.emailCount !== 1 ? 's' : '' }}</span>
            <span v-if="contact.lastEmailAt" class="last-email"> &middot; Last: {{ formatDate(contact.lastEmailAt) }}</span>
            <span
              v-if="activeView === 'all' && contact.bucket"
              class="bucket-badge"
              :style="{ background: getBucketColor(contact.bucket), color: '#fff' }"
            >
              {{ getBucketLabel(contact.bucket) }}
            </span>
            <span
              v-else-if="activeView === 'all' && !contact.bucket"
              class="bucket-badge unscreened"
            >
              Unscreened
            </span>
          </div>
        </NuxtLink>
        <div v-if="activeView === 'screener' || !contact.bucket" class="bucket-buttons">
          <button
            v-for="bucket in buckets.filter(b => b.value !== 'quarantine')"
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
      <button @click="loadMore" :disabled="loadingMore">
        {{ loadingMore ? 'Loading...' : 'Load More' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.contacts-page {
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
  margin: 0 0 16px 0;
}

.view-nav {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.view-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: 1px solid #e5e5e5;
  border-radius: 20px;
  background: #fff;
  font-size: 14px;
  font-weight: 500;
  color: #666;
  cursor: pointer;
  transition: all 0.15s;
}

.view-pill:hover {
  border-color: #ccc;
  color: #333;
}

.view-pill.active {
  background: #1a1a1a;
  border-color: #1a1a1a;
  color: #fff;
}

.pill-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  background: #ef4444;
  color: #fff;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
}

.view-pill.active .pill-count {
  background: #fff;
  color: #1a1a1a;
}

.search-box input {
  width: 100%;
  padding: 10px 14px;
  font-size: 14px;
  border: 1px solid #e5e5e5;
  border-radius: 8px;
  outline: none;
  transition: border-color 0.15s;
}

.search-box input:focus {
  border-color: #999;
}

.bucket-counts {
  display: flex;
  gap: 8px;
  margin-bottom: 24px;
  padding: 12px;
  background: #f5f5f5;
  border-radius: 8px;
  flex-wrap: wrap;
}

.count-item {
  text-align: center;
  flex: 1;
  min-width: 70px;
  padding: 8px 4px;
  background: transparent;
  border: 2px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
}

.count-item:hover {
  background: #fff;
}

.count-item.active {
  background: #fff;
  border-color: #1a1a1a;
}

.count-number {
  display: block;
  font-size: 20px;
  font-weight: 600;
}

.count-label {
  font-size: 11px;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.count-item.active .count-label {
  color: #1a1a1a;
}

.empty-state,
.loading-state {
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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.contact-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #999;
  flex-wrap: wrap;
}

.bucket-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
}

.bucket-badge.unscreened {
  background: #f5f5f5;
  color: #666;
}

.bucket-buttons {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
  flex-wrap: wrap;
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

@media (max-width: 600px) {
  .contact-card {
    flex-direction: column;
    align-items: stretch;
  }

  .bucket-buttons {
    margin-top: 12px;
    justify-content: flex-start;
  }
}
</style>
