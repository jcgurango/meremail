<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import EmailComposer from '@/components/EmailComposer.vue'
import { db, type LocalDraft } from '@/local/db'

const route = useRoute()
const router = useRouter()

const draftId = computed(() => String(route.params.id))

// The draft as it was when the page opened. An ID with no draft behind it is
// a new message that hasn't been written yet.
const draft = ref<LocalDraft | null>(null)
const pending = ref(true)

const pageTitle = computed(() => {
  if (draft.value?.subject) {
    return `Draft: ${draft.value.subject} - MereMail`
  }
  return 'New Message - MereMail'
})

async function loadDraft() {
  pending.value = true
  draft.value = (await db.drafts.get(draftId.value)) ?? null
  pending.value = false
}

onMounted(() => {
  document.title = pageTitle.value
  loadDraft()
})

watch(draftId, loadDraft)

watch(pageTitle, (newTitle) => {
  document.title = newTitle
})

function leave() {
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

      <div v-else-if="draft?.sending" class="offline-notice">
        This message is on its way out.
      </div>

      <div v-else class="composer-wrapper">
        <EmailComposer
          :key="draftId"
          :draft-id="draftId"
          :existing-draft="draft ?? undefined"
          :default-from-id="draft?.senderId"
          @close="leave"
          @discarded="leave"
          @sent="leave"
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
