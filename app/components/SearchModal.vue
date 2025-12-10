<script setup lang="ts">
interface EmailResult {
  type: 'email'
  id: number
  threadId: number
  subject: string
  snippet: string
  senderName: string | null
  senderEmail: string
  sentAt: string | null
}

interface ContactResult {
  type: 'contact'
  id: number
  name: string | null
  email: string
  bucket: string | null
  isMe: boolean
}

interface AttachmentResult {
  type: 'attachment'
  id: number
  emailId: number
  threadId: number
  filename: string
  mimeType: string | null
  size: number | null
  sentAt: string | null
  senderName: string | null
  senderEmail: string
}

type SearchResult = EmailResult | ContactResult | AttachmentResult

const MAX_QUICK_RESULTS = 5

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const router = useRouter()
const searchQuery = ref('')
const results = ref<SearchResult[]>([])
const loading = ref(false)
const searchInput = ref<HTMLInputElement | null>(null)

let debounceTimer: ReturnType<typeof setTimeout> | null = null

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    nextTick(() => searchInput.value?.focus())
  } else {
    searchQuery.value = ''
    results.value = []
  }
})

async function search() {
  const q = searchQuery.value.trim()
  if (q.length < 2) {
    results.value = []
    return
  }

  loading.value = true
  try {
    const data = await $fetch<{ results: SearchResult[] }>('/api/search', {
      query: { q, limit: 20 }
    })
    results.value = data.results
  } catch (e) {
    console.error('Search failed:', e)
    results.value = []
  } finally {
    loading.value = false
  }
}

function onInput() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(search, 200)
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    emit('close')
  }
}

function navigateToResult(result: SearchResult) {
  emit('close')
  if (result.type === 'email') {
    router.push(`/thread/${result.threadId}`)
  } else if (result.type === 'contact') {
    router.push(`/contact/${result.id}`)
  } else if (result.type === 'attachment') {
    router.push(`/attachment/${result.id}`)
  }
}

function seeMore(type: string) {
  emit('close')
  if (type === 'attachment') {
    router.push(`/attachments?q=${encodeURIComponent(searchQuery.value)}`)
  } else if (type === 'contact') {
    router.push(`/contacts?q=${encodeURIComponent(searchQuery.value)}`)
  } else {
    router.push(`/search?q=${encodeURIComponent(searchQuery.value)}`)
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  const now = new Date()
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Group results by type with cap
const groupedResults = computed(() => {
  const emails = results.value.filter((r): r is EmailResult => r.type === 'email')
  const contacts = results.value.filter((r): r is ContactResult => r.type === 'contact')
  const attachments = results.value.filter((r): r is AttachmentResult => r.type === 'attachment')
  return {
    emails: emails.slice(0, MAX_QUICK_RESULTS),
    emailsHasMore: emails.length > MAX_QUICK_RESULTS,
    contacts: contacts.slice(0, MAX_QUICK_RESULTS),
    contactsHasMore: contacts.length > MAX_QUICK_RESULTS,
    attachments: attachments.slice(0, MAX_QUICK_RESULTS),
    attachmentsHasMore: attachments.length > MAX_QUICK_RESULTS,
  }
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-overlay" @click.self="emit('close')">
      <div class="modal" @keydown="handleKeydown">
        <div class="search-header">
          <span class="search-icon">🔍</span>
          <input
            ref="searchInput"
            v-model="searchQuery"
            type="text"
            placeholder="Search emails, contacts, attachments..."
            class="search-input"
            @input="onInput"
          />
          <button class="close-btn" @click="emit('close')">✕</button>
        </div>

        <div class="results-container">
          <div v-if="loading" class="loading">Searching...</div>

          <div v-else-if="searchQuery.length >= 2 && results.length === 0" class="no-results">
            No results found
          </div>

          <div v-else-if="results.length > 0" class="results">
            <!-- Emails -->
            <div v-if="groupedResults.emails.length > 0" class="result-group">
              <div class="group-header">Emails</div>
              <button
                v-for="result in groupedResults.emails"
                :key="`email-${result.id}`"
                class="result-item email-result"
                @click="navigateToResult(result)"
              >
                <div class="result-icon">✉️</div>
                <div class="result-content">
                  <div class="result-title">{{ result.subject }}</div>
                  <div class="result-meta">
                    <span>{{ result.senderName || result.senderEmail }}</span>
                    <span v-if="result.sentAt" class="result-date">{{ formatDate(result.sentAt) }}</span>
                  </div>
                  <div class="result-snippet">{{ result.snippet }}</div>
                </div>
              </button>
              <button
                v-if="groupedResults.emailsHasMore"
                class="see-more-btn"
                @click="seeMore('email')"
              >
                See more emails →
              </button>
            </div>

            <!-- Contacts -->
            <div v-if="groupedResults.contacts.length > 0" class="result-group">
              <div class="group-header">Contacts</div>
              <button
                v-for="result in groupedResults.contacts"
                :key="`contact-${result.id}`"
                class="result-item contact-result"
                @click="navigateToResult(result)"
              >
                <div class="result-icon">👤</div>
                <div class="result-content">
                  <div class="result-title">{{ result.name || result.email }}</div>
                  <div v-if="result.name" class="result-meta">{{ result.email }}</div>
                  <div v-if="result.bucket" class="result-badge" :class="result.bucket">
                    {{ result.bucket.replace('_', ' ') }}
                  </div>
                </div>
              </button>
              <button
                v-if="groupedResults.contactsHasMore"
                class="see-more-btn"
                @click="seeMore('contact')"
              >
                See more contacts →
              </button>
            </div>

            <!-- Attachments -->
            <div v-if="groupedResults.attachments.length > 0" class="result-group">
              <div class="group-header">Attachments</div>
              <button
                v-for="result in groupedResults.attachments"
                :key="`attachment-${result.id}`"
                class="result-item attachment-result"
                @click="navigateToResult(result)"
              >
                <div class="result-icon">📎</div>
                <div class="result-content">
                  <div class="result-title">{{ result.filename }}</div>
                  <div class="result-meta">
                    <span v-if="result.size">{{ formatFileSize(result.size) }}</span>
                    <span>{{ result.senderName || result.senderEmail }}</span>
                    <span v-if="result.sentAt" class="result-date">{{ formatDate(result.sentAt) }}</span>
                  </div>
                </div>
              </button>
              <button
                v-if="groupedResults.attachmentsHasMore"
                class="see-more-btn"
                @click="seeMore('attachment')"
              >
                See more attachments →
              </button>
            </div>
          </div>

          <div v-else class="search-hint">
            Type at least 2 characters to search
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 10vh;
  z-index: 1000;
}

.modal {
  background: #fff;
  border-radius: 12px;
  width: 100%;
  max-width: 600px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  overflow: hidden;
}

.search-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid #eee;
}

.search-icon {
  font-size: 20px;
}

.search-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 18px;
  padding: 8px 0;
}

.search-input::placeholder {
  color: #999;
}

.close-btn {
  background: none;
  border: none;
  font-size: 18px;
  color: #666;
  cursor: pointer;
  padding: 8px;
  border-radius: 6px;
}

.close-btn:hover {
  background: #f0f0f0;
}

.results-container {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.loading,
.no-results,
.search-hint {
  padding: 32px;
  text-align: center;
  color: #666;
}

.result-group {
  margin-bottom: 8px;
}

.group-header {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #888;
  padding: 8px 12px;
}

.result-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  width: 100%;
  padding: 12px;
  background: none;
  border: none;
  border-radius: 8px;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s;
}

.result-item:hover {
  background: #f5f5f5;
}

.result-icon {
  font-size: 20px;
  line-height: 1;
  flex-shrink: 0;
  padding-top: 2px;
}

.result-content {
  flex: 1;
  min-width: 0;
}

.result-title {
  font-size: 14px;
  font-weight: 500;
  color: #000;
  margin-bottom: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-meta {
  font-size: 12px;
  color: #666;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.result-date {
  color: #999;
}

.result-snippet {
  font-size: 12px;
  color: #888;
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-badge {
  display: inline-block;
  font-size: 10px;
  font-weight: 500;
  text-transform: capitalize;
  padding: 2px 8px;
  border-radius: 10px;
  margin-top: 4px;
}

.result-badge.approved {
  background: #dcfce7;
  color: #166534;
}

.result-badge.feed {
  background: #dbeafe;
  color: #1e40af;
}

.result-badge.paper_trail {
  background: #f3e8ff;
  color: #7c3aed;
}

.result-badge.blocked {
  background: #fee2e2;
  color: #991b1b;
}

.see-more-btn {
  width: 100%;
  padding: 10px 12px;
  background: none;
  border: none;
  text-align: left;
  font-size: 13px;
  color: #666;
  cursor: pointer;
  border-radius: 6px;
  transition: background 0.15s, color 0.15s;
}

.see-more-btn:hover {
  background: #f0f0f0;
  color: #000;
}
</style>
