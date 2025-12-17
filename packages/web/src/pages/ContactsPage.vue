<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { useOffline } from '@/composables/useOffline'
import MustBeOnline from '@/components/MustBeOnline.vue'

onMounted(() => {
  document.title = 'Contacts - MereMail'
  loadContacts(true)
})

const { isOnline } = useOffline()

const router = useRouter()

interface Contact {
  id: number
  name: string | null
  email: string
  isMe: boolean
  lastEmailAt: string | null
  emailCount: number
}

interface ApiResponse {
  contacts: Contact[]
  hasMore: boolean
}

const searchQuery = ref('')
const contacts = ref<Contact[]>([])
const hasMore = ref(false)
const loading = ref(false)
const loadingMore = ref(false)

// Debounce search
let searchTimeout: ReturnType<typeof setTimeout> | null = null

async function loadContacts(reset = false) {
  if (loading.value) return
  loading.value = true

  try {
    const offset = reset ? 0 : contacts.value.length
    const params = new URLSearchParams({
      limit: '50',
      offset: String(offset),
    })
    if (searchQuery.value) {
      params.set('q', searchQuery.value)
    }

    const response = await fetch(`/api/contacts?${params}`)
    if (response.ok) {
      const data = await response.json() as ApiResponse

      if (reset) {
        contacts.value = data.contacts
      } else {
        contacts.value.push(...data.contacts)
      }
      hasMore.value = data.hasMore
    }
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
    })
    if (searchQuery.value) {
      params.set('q', searchQuery.value)
    }

    const response = await fetch(`/api/contacts?${params}`)
    if (response.ok) {
      const data = await response.json() as ApiResponse
      contacts.value.push(...data.contacts)
      hasMore.value = data.hasMore
    }
  } finally {
    loadingMore.value = false
  }
}

function handleSearchInput() {
  if (searchTimeout) clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
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
</script>

<template>
  <div class="contacts-page">
    <header class="page-header">
      <RouterLink to="/" class="back-link">&larr; Inbox</RouterLink>
      <h1>Contacts</h1>
    </header>

    <MustBeOnline v-if="!isOnline" message="Contact management requires an internet connection" />

    <template v-else>
      <div class="search-box">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Search contacts..."
          @input="handleSearchInput"
        />
      </div>

      <div v-if="contacts.length === 0 && !loading" class="empty-state">
        No contacts found
      </div>

      <div v-if="loading && contacts.length === 0" class="loading-state">
        Loading...
      </div>

      <div class="contacts-list">
        <div v-for="contact in contacts" :key="contact.id" class="contact-card">
          <RouterLink :to="`/contact/${contact.id}`" class="contact-info">
            <div class="contact-name">{{ contact.name || contact.email.split('@')[0] }}</div>
            <div class="contact-email">{{ contact.email }}</div>
            <div class="contact-meta">
              <span class="email-count">{{ contact.emailCount }} email{{ contact.emailCount !== 1 ? 's' : '' }}</span>
              <span v-if="contact.lastEmailAt" class="last-email"> &middot; Last: {{ formatDate(contact.lastEmailAt) }}</span>
              <span v-if="contact.isMe" class="me-badge">You</span>
            </div>
          </RouterLink>
        </div>
      </div>

      <div v-if="hasMore" class="load-more">
        <button @click="loadMore" :disabled="loadingMore">
          {{ loadingMore ? 'Loading...' : 'Load More' }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.contacts-page {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
  padding-bottom: 120px;
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

.search-box {
  margin-bottom: 16px;
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

.me-badge {
  padding: 2px 8px;
  background: #f5f5f5;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  color: #666;
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
