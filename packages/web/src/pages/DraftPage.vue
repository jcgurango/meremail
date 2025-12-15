<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import EmailComposer from '@/components/EmailComposer.vue'
import { getOfflineDraftByServerId } from '@/composables/useOfflineDrafts'

interface Recipient {
  id: number
  name: string | null
  email: string
  role: string
}

interface Attachment {
  id: number
  filename: string
  mimeType: string | null
  size: number | null
  isInline: boolean | null
}

interface Draft {
  id: number
  subject: string
  contentText: string
  contentHtml: string | null
  sender: {
    id: number
    name: string | null
    email: string
  } | null
  recipients: Recipient[]
  attachments: Attachment[]
}

const route = useRoute()
const router = useRouter()
const draftId = Number(route.params.id)

const draft = ref<Draft | null>(null)
const pending = ref(true)
const error = ref<Error | null>(null)

const pageTitle = computed(() => {
  if (draft.value?.subject) {
    return `Draft: ${draft.value.subject} - MereMail`
  }
  return 'New Message - MereMail'
})

onMounted(async () => {
  document.title = pageTitle.value
  await loadDraft()
})

watch(pageTitle, (newTitle) => {
  document.title = newTitle
})

const isFromCache = ref(false)

async function loadDraft() {
  pending.value = true
  error.value = null
  isFromCache.value = false

  try {
    const response = await fetch(`/api/drafts/${draftId}`)
    if (response.ok) {
      draft.value = await response.json() as Draft
    } else {
      throw new Error(`Failed to load draft: ${response.status}`)
    }
  } catch (e) {
    // Try to load from offline drafts cache
    const offlineDraft = await getOfflineDraftByServerId(draftId)
    if (offlineDraft) {
      draft.value = {
        id: offlineDraft.serverId || draftId,
        subject: offlineDraft.subject.value,
        contentText: offlineDraft.contentText.value,
        contentHtml: offlineDraft.contentHtml.value,
        sender: null, // We don't store full sender info in offline drafts
        recipients: offlineDraft.recipients.value.map(r => ({
          id: r.id || 0,
          name: r.name ?? null,
          email: r.email,
          role: r.role,
        })),
        attachments: offlineDraft.attachments.map(a => ({
          id: a.serverId || 0,
          filename: a.filename,
          mimeType: a.mimeType,
          size: a.size,
          isInline: null,
        })),
      }
      isFromCache.value = true
    } else {
      error.value = e as Error
    }
  } finally {
    pending.value = false
  }
}

function onClose() {
  router.push('/')
}

function onDiscarded() {
  router.push('/')
}

function onSent() {
  // After sending, the draft becomes part of a thread
  // Navigate to inbox since we don't know the thread ID from here
  router.push('/')
}

function goBack() {
  router.back()
}
</script>

<template>
  <div class="draft-page">
    <header class="header">
      <div class="header-top">
        <button class="back-link" @click="goBack">&larr; Back</button>
      </div>
      <h1>{{ draft?.subject || 'New Message' }}</h1>
    </header>

    <main class="main">
      <div v-if="pending" class="loading">Loading...</div>

      <div v-else-if="error" class="error">
        Failed to load draft: {{ error.message }}
      </div>

      <div v-if="isFromCache" class="offline-notice">
          Viewing cached version (offline)
        </div>

        <div v-if="draft" class="composer-wrapper">
        <EmailComposer
          :existing-draft="{
            id: draft.id,
            subject: draft.subject,
            contentText: draft.contentText,
            contentHtml: draft.contentHtml,
            sender: draft.sender,
            recipients: draft.recipients.map(r => ({ id: r.id, email: r.email, name: r.name, role: r.role || 'to' })),
            attachments: draft.attachments,
          }"
          :default-from-id="draft.sender?.id"
          @close="onClose"
          @discarded="onDiscarded"
          @sent="onSent"
        />
      </div>
    </main>
  </div>
</template>

<style scoped>
.draft-page {
  min-height: 100vh;
}

.header {
  padding: 20px;
  border-bottom: 1px solid #e5e5e5;
}

.header-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}

.back-link {
  display: inline-block;
  color: #666;
  text-decoration: none;
  font-size: 14px;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
}

.back-link:hover {
  color: #000;
}

h1 {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.02em;
  margin: 0;
}

.main {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
}

.loading,
.error {
  padding: 40px 20px;
  text-align: center;
  color: #666;
}

.error {
  color: #dc2626;
}

.offline-notice {
  margin-bottom: 20px;
  padding: 12px 16px;
  background: #fef3c7;
  border: 1px solid #f59e0b;
  border-radius: 8px;
  color: #92400e;
  font-size: 14px;
  text-align: center;
}

.composer-wrapper {
  border: 1px solid #e5e5e5;
  border-radius: 8px;
  overflow: hidden;
}
</style>
