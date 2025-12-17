<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import EmailMessage from '@/components/EmailMessage.vue'

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
  isMe: boolean
}

interface ApiResponse {
  contact: Contact
  threads: Thread[]
  totalThreads: number
  hasMore: boolean
}

const route = useRoute()
const router = useRouter()
const contactId = computed(() => Number(route.params.id))

const contact = ref<Contact | null>(null)

// Name editing
const isEditingName = ref(false)
const editedName = ref('')
const savingName = ref(false)

function startEditingName() {
  editedName.value = contact.value?.name || ''
  isEditingName.value = true
}

function cancelEditingName() {
  isEditingName.value = false
  editedName.value = ''
}

async function saveName() {
  if (!contact.value) return
  savingName.value = true

  try {
    const res = await fetch(`/api/contacts/${contact.value.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editedName.value.trim() || null }),
    })

    if (res.ok) {
      const data = await res.json()
      contact.value = data.contact
      isEditingName.value = false
      document.title = pageTitle.value
    } else {
      alert('Failed to save name')
    }
  } catch (e) {
    console.error('Failed to save name:', e)
    alert('Failed to save name')
  } finally {
    savingName.value = false
  }
}

const pageTitle = computed(() => {
  if (contact.value) return `${contact.value.name || contact.value.email} - MereMail`
  return 'MereMail'
})

const threads = ref<Thread[]>([])
const totalThreads = ref(0)
const hasMore = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)

onMounted(() => {
  document.title = pageTitle.value
  loadThreads(true)
})

async function loadThreads(reset = false) {
  if (loading.value) return
  loading.value = true
  error.value = null

  try {
    const offset = reset ? 0 : threads.value.length
    const params = new URLSearchParams({ limit: '20', offset: String(offset) })
    const response = await fetch(`/api/contacts/${contactId.value}?${params}`)

    if (response.ok) {
      const data = await response.json() as ApiResponse

      contact.value = data.contact
      totalThreads.value = data.totalThreads
      hasMore.value = data.hasMore
      document.title = pageTitle.value

      if (reset) {
        threads.value = data.threads
      } else {
        threads.value.push(...data.threads)
      }
    } else {
      const errorData = await response.json() as { message?: string }
      error.value = errorData.message || 'Failed to load contact'
    }
  } catch (e: any) {
    error.value = e.message || 'Failed to load contact'
  } finally {
    loading.value = false
  }
}

function goBack() {
  router.back()
}
</script>

<template>
  <div class="contact-page">
    <header class="page-header">
      <button class="back-link" @click="goBack">&larr; Back</button>

      <div v-if="contact" class="contact-header">
        <div v-if="isEditingName" class="name-edit-form">
          <input
            v-model="editedName"
            type="text"
            class="name-input"
            placeholder="Enter name..."
            @keydown.enter="saveName"
            @keydown.escape="cancelEditingName"
            autofocus
          />
          <button class="save-btn" @click="saveName" :disabled="savingName">
            {{ savingName ? 'Saving...' : 'Save' }}
          </button>
          <button class="cancel-btn" @click="cancelEditingName" :disabled="savingName">
            Cancel
          </button>
        </div>
        <div v-else class="name-display">
          <h1>{{ contact.name || contact.email }}</h1>
          <button class="edit-name-btn" @click="startEditingName" title="Edit name">
            Edit
          </button>
        </div>
        <div class="contact-email" v-if="contact.name">{{ contact.email }}</div>
        <div class="contact-meta">
          <span class="thread-count">{{ totalThreads }} conversation{{ totalThreads !== 1 ? 's' : '' }}</span>
          <span v-if="contact.isMe" class="me-badge">You</span>
        </div>
      </div>
    </header>

    <div v-if="error" class="error">{{ error }}</div>

    <div v-else-if="loading && threads.length === 0" class="loading">Loading...</div>

    <div v-else class="threads-list">
      <div v-for="thread in threads" :key="thread.id" class="thread-section">
        <div class="thread-header">
          <RouterLink :to="`/thread/${thread.id}`" class="thread-subject">
            {{ thread.subject }}
          </RouterLink>
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
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
}

.back-link:hover {
  color: #000;
}

.name-display {
  display: flex;
  align-items: center;
  gap: 12px;
}

.contact-header h1 {
  font-size: 24px;
  font-weight: 600;
  margin: 0;
}

.edit-name-btn {
  padding: 4px 10px;
  background: #f3f4f6;
  color: #374151;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s;
}

.edit-name-btn:hover {
  background: #e5e7eb;
}

.name-edit-form {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.name-input {
  padding: 8px 12px;
  font-size: 18px;
  font-weight: 600;
  border: 1px solid #e5e5e5;
  border-radius: 4px;
  outline: none;
  min-width: 250px;
}

.name-input:focus {
  border-color: #999;
}

.save-btn {
  padding: 8px 16px;
  background: #000;
  color: #fff;
  border: none;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
}

.save-btn:hover:not(:disabled) {
  opacity: 0.85;
}

.save-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.cancel-btn {
  padding: 8px 16px;
  background: #f3f4f6;
  color: #374151;
  border: none;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
}

.cancel-btn:hover:not(:disabled) {
  background: #e5e7eb;
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
