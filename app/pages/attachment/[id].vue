<script setup lang="ts">
interface Attachment {
  id: number
  filename: string
  mimeType: string | null
  size: number | null
  isInline: boolean
  extractedText: string | null
  createdAt: string
  email: {
    id: number
    subject: string
    sentAt: string | null
  }
  thread: {
    id: number
    subject: string
  } | null
  sender: {
    id: number
    name: string | null
    email: string
  } | null
}

const route = useRoute()
const { data: attachment, pending, error } = await useFetch<Attachment>(
  `/api/attachments/${route.params.id}/details`
)

const pageTitle = computed(() =>
  attachment.value?.filename ? `${attachment.value.filename} - MereMail` : 'MereMail'
)
useHead({ title: pageTitle })

function formatFileSize(bytes: number | null): string {
  if (bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function getFileIcon(mimeType: string | null, filename: string): string {
  if (mimeType) {
    if (mimeType.startsWith('image/')) return '🖼'
    if (mimeType.startsWith('video/')) return '🎬'
    if (mimeType.startsWith('audio/')) return '🎵'
    if (mimeType === 'application/pdf') return '📄'
    if (mimeType.includes('zip') || mimeType.includes('compressed')) return '📦'
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return '📊'
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '📽'
    if (mimeType.includes('document') || mimeType.includes('word')) return '📝'
  }
  const ext = filename.split('.').pop()?.toLowerCase()
  const iconMap: Record<string, string> = {
    pdf: '📄', doc: '📝', docx: '📝', xls: '📊', xlsx: '📊',
    ppt: '📽', pptx: '📽', zip: '📦', rar: '📦',
    jpg: '🖼', jpeg: '🖼', png: '🖼', gif: '🖼', webp: '🖼',
    mp4: '🎬', mov: '🎬', mp3: '🎵', wav: '🎵',
  }
  return iconMap[ext || ''] || '📎'
}

const isPreviewable = computed(() => {
  if (!attachment.value?.mimeType) return false
  return attachment.value.mimeType.startsWith('image/') ||
         attachment.value.mimeType === 'application/pdf'
})

const isImage = computed(() =>
  attachment.value?.mimeType?.startsWith('image/')
)
</script>

<template>
  <div class="attachment-page">
    <header class="page-header">
      <a href="#" class="back-link" @click.prevent="$router.back()">&larr; Back</a>
    </header>

    <div v-if="pending" class="loading">Loading...</div>
    <div v-else-if="error" class="error">{{ error.message }}</div>

    <div v-else-if="attachment" class="attachment-detail">
      <div class="file-header">
        <span class="file-icon">{{ getFileIcon(attachment.mimeType, attachment.filename) }}</span>
        <div class="file-info">
          <h1>{{ attachment.filename }}</h1>
          <div class="file-meta">
            <span v-if="attachment.size">{{ formatFileSize(attachment.size) }}</span>
            <span v-if="attachment.mimeType" class="mime-type">{{ attachment.mimeType }}</span>
          </div>
        </div>
      </div>

      <div class="preview-section" v-if="isPreviewable">
        <img
          v-if="isImage"
          :src="`/api/attachments/${attachment.id}`"
          :alt="attachment.filename"
          class="preview-image"
        />
        <iframe
          v-else-if="attachment.mimeType === 'application/pdf'"
          :src="`/api/attachments/${attachment.id}`"
          class="preview-pdf"
        ></iframe>
      </div>

      <div class="actions">
        <a
          :href="`/api/attachments/${attachment.id}`"
          target="_blank"
          rel="noopener noreferrer"
          class="download-btn"
        >
          Download
        </a>
      </div>

      <div class="context-section">
        <h2>From</h2>
        <div class="context-item">
          <div class="context-label">Email</div>
          <div class="context-value">
            <NuxtLink v-if="attachment.thread" :to="`/thread/${attachment.thread.id}`">
              {{ attachment.email.subject }}
            </NuxtLink>
            <span v-else>{{ attachment.email.subject }}</span>
          </div>
        </div>

        <div v-if="attachment.sender" class="context-item">
          <div class="context-label">Sender</div>
          <div class="context-value">
            <NuxtLink :to="`/contact/${attachment.sender.id}`">
              {{ attachment.sender.name || attachment.sender.email }}
            </NuxtLink>
          </div>
        </div>

        <div v-if="attachment.email.sentAt" class="context-item">
          <div class="context-label">Date</div>
          <div class="context-value">{{ formatDate(attachment.email.sentAt) }}</div>
        </div>
      </div>

      <div v-if="attachment.extractedText" class="extracted-text">
        <h2>Extracted Text</h2>
        <pre>{{ attachment.extractedText }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.attachment-page {
  max-width: 900px;
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
}

.back-link:hover {
  color: #000;
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

.file-header {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 24px;
}

.file-icon {
  font-size: 48px;
  line-height: 1;
}

.file-info h1 {
  font-size: 20px;
  font-weight: 600;
  margin: 0 0 8px 0;
  word-break: break-word;
}

.file-meta {
  display: flex;
  gap: 16px;
  font-size: 14px;
  color: #666;
}

.mime-type {
  font-family: monospace;
  background: #f5f5f5;
  padding: 2px 6px;
  border-radius: 3px;
}

.preview-section {
  margin-bottom: 24px;
  background: #f9f9f9;
  border-radius: 8px;
  overflow: hidden;
}

.preview-image {
  max-width: 100%;
  max-height: 500px;
  display: block;
  margin: 0 auto;
}

.preview-pdf {
  width: 100%;
  height: 600px;
  border: none;
}

.actions {
  margin-bottom: 24px;
}

.download-btn {
  display: inline-block;
  padding: 12px 24px;
  background: #000;
  color: #fff;
  text-decoration: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  transition: opacity 0.15s;
}

.download-btn:hover {
  opacity: 0.85;
}

.context-section {
  background: #f9f9f9;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 24px;
}

.context-section h2 {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #666;
  margin: 0 0 12px 0;
}

.context-item {
  display: flex;
  gap: 16px;
  padding: 8px 0;
  border-bottom: 1px solid #eee;
}

.context-item:last-child {
  border-bottom: none;
}

.context-label {
  flex-shrink: 0;
  width: 80px;
  font-size: 13px;
  color: #666;
}

.context-value {
  font-size: 14px;
}

.context-value a {
  color: #000;
  text-decoration: none;
}

.context-value a:hover {
  text-decoration: underline;
}

.extracted-text {
  background: #f9f9f9;
  border-radius: 8px;
  padding: 16px;
}

.extracted-text h2 {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #666;
  margin: 0 0 12px 0;
}

.extracted-text pre {
  margin: 0;
  white-space: pre-wrap;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.5;
}
</style>
