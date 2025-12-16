<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import {
  getMeContacts,
  searchContacts as apiSearchContacts,
  createDraft as apiCreateDraft,
  updateDraft as apiUpdateDraft,
  deleteDraft as apiDeleteDraft,
  sendDraft as apiSendDraft,
} from '@/utils/api'

interface Contact {
  id: number
  name: string | null
  email: string
}

interface Recipient {
  id?: number
  email: string
  name?: string | null
}

interface OriginalEmail {
  id: number
  subject: string
  sentAt: string | null
  sender: Contact | null
  recipients: (Contact & { role: string })[]
  contentText: string
  messageId?: string
  references?: string[]
  replyTo?: string | null
}

interface ExistingDraft {
  id: number
  subject: string
  contentText: string
  contentHtml?: string | null
  sender: { id: number } | null
  recipients: { id?: number; email: string; name: string | null; role: string }[]
  attachments?: { id: number; filename: string; mimeType: string | null; size: number | null; isInline: boolean | null }[]
}

interface UploadedFile {
  id: string | number
  filename: string
  mimeType: string
  size: number
  url: string
  isInline?: boolean
}

const props = defineProps<{
  threadId?: number  // Optional for standalone drafts
  originalEmail?: OriginalEmail
  replyAll?: boolean
  defaultFromId?: number
  existingDraft?: ExistingDraft
}>()

const emit = defineEmits<{
  close: []
  sent: [draftId: number]
  discarded: []
}>()

// From identities
const meContacts = ref<Contact[]>([])
const selectedFromId = ref<number | null>(null)

// Recipients
const toRecipients = ref<Recipient[]>([])
const ccRecipients = ref<Recipient[]>([])
const bccRecipients = ref<Recipient[]>([])
const showCc = ref(false)
const showBcc = ref(false)

// Content
const subject = ref('')
const isRichText = ref(true)
const bodyText = ref('')

// Attachments
const attachments = ref<UploadedFile[]>([])
const uploading = ref(false)
const uploadProgress = ref(0)
const uploadError = ref<string | null>(null)

// Contact search
const searchQuery = ref('')
const searchResults = ref<Contact[]>([])
const searchLoading = ref(false)
const activeField = ref<'to' | 'cc' | 'bcc' | null>(null)
let searchDebounce: ReturnType<typeof setTimeout> | null = null

// Saving state
const saving = ref(false)
const draftId = ref<number | null>(null)  // ID in sync cache (negative for local-only, positive for server)
const isPending = ref(false)  // True if draft is pending sync
const sending = ref(false)  // True while queueing send
let autoSaveTimeout: ReturnType<typeof setTimeout> | null = null

// Whether the draft can be sent (has recipients and sender)
const canSend = computed(() => {
  return toRecipients.value.length > 0 && selectedFromId.value !== null
})

// File input ref
const fileInputRef = ref<HTMLInputElement | null>(null)

// Tiptap editor
const editor = useEditor({
  extensions: [
    StarterKit,
    Image.configure({
      HTMLAttributes: {
        class: 'editor-image',
      },
    }),
    Link.configure({
      openOnClick: false,
      HTMLAttributes: {
        class: 'editor-link',
      },
    }),
    Placeholder.configure({
      placeholder: 'Write your message...',
    }),
  ],
  content: '',
  editorProps: {
    handlePaste: (view, event) => {
      const items = event.clipboardData?.items
      if (!items) return false

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          event.preventDefault()
          const file = item.getAsFile()
          if (file) {
            uploadAndInsertImage(file)
          }
          return true
        }
      }
      return false
    },
    handleDrop: (view, event) => {
      const files = event.dataTransfer?.files
      if (!files || files.length === 0) return false

      const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'))
      if (imageFiles.length === 0) return false

      event.preventDefault()
      for (const file of imageFiles) {
        uploadAndInsertImage(file)
      }
      return true
    },
  },
  onUpdate: () => {
    triggerAutoSave()
  },
})

// Ensure draft exists before uploading (so we can link the attachment)
// Note: This requires being online since attachments need server upload
async function ensureDraftExists(): Promise<number> {
  if (draftId.value && draftId.value > 0) return draftId.value

  // Create a minimal draft first
  if (!selectedFromId.value) {
    throw new Error('No sender selected')
  }

  const recipients = [
    ...toRecipients.value.map(r => ({ ...r, role: 'to' as const })),
    ...ccRecipients.value.map(r => ({ ...r, role: 'cc' as const })),
    ...bccRecipients.value.map(r => ({ ...r, role: 'bcc' as const })),
  ]

  const result = await apiCreateDraft({
    threadId: props.threadId,
    senderId: selectedFromId.value,
    subject: subject.value,
    contentText: isRichText.value ? getPlainText() : bodyText.value,
    contentHtml: isRichText.value ? getEditorContent() : undefined,
    inReplyTo: props.originalEmail?.messageId,
    references: props.originalEmail?.references,
    recipients,
  })

  draftId.value = result.draftId
  isPending.value = result.pending

  // Attachments require a server ID (positive number)
  if (result.draftId < 0) {
    throw new Error('Cannot upload attachments while offline')
  }

  return result.draftId
}

// Upload file and return metadata with progress tracking
async function uploadFile(file: File, isInline: boolean): Promise<UploadedFile> {
  // Ensure draft exists so we can link the attachment
  const emailId = await ensureDraftExists()

  const formData = new FormData()
  formData.append('file', file)
  formData.append('emailId', emailId.toString())
  formData.append('isInline', isInline.toString())

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        uploadProgress.value = Math.round((e.loaded / e.total) * 100)
      }
    })

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const result = JSON.parse(xhr.responseText)
          resolve(result)
        } catch {
          reject(new Error('Invalid response'))
        }
      } else {
        try {
          const error = JSON.parse(xhr.responseText)
          reject({ data: error })
        } catch {
          reject(new Error(`Upload failed: ${xhr.status}`))
        }
      }
    })

    xhr.addEventListener('error', () => {
      reject(new Error('Network error'))
    })

    xhr.open('POST', '/api/uploads')
    xhr.send(formData)
  })
}

// Upload image and insert into editor
async function uploadAndInsertImage(file: File) {
  uploading.value = true
  uploadProgress.value = 0
  uploadError.value = null

  try {
    const uploaded = await uploadFile(file, true)
    attachments.value.push(uploaded)

    editor.value?.chain().focus().setImage({ src: uploaded.url, alt: uploaded.filename }).run()
  } catch (e: any) {
    uploadError.value = e.data?.message || 'Failed to upload image'
    console.error('Upload failed:', e)
  } finally {
    uploading.value = false
  }
}

// Handle attachment button click
function triggerFileUpload() {
  fileInputRef.value?.click()
}

// Handle file selection
async function handleFileSelect(event: Event) {
  const input = event.target as HTMLInputElement
  const files = input.files
  if (!files || files.length === 0) return

  uploading.value = true
  uploadProgress.value = 0
  uploadError.value = null

  try {
    for (const file of files) {
      uploadProgress.value = 0
      const uploaded = await uploadFile(file, false)
      attachments.value.push(uploaded)
    }
  } catch (e: any) {
    uploadError.value = e.data?.message || 'Failed to upload file'
    console.error('Upload failed:', e)
  } finally {
    uploading.value = false
    // Reset input so same file can be selected again
    input.value = ''
  }
}

// Remove attachment
async function removeAttachment(index: number) {
  const att = attachments.value[index]
  if (!att) return

  // If it's saved to DB (numeric ID), delete via API
  if (typeof att.id === 'number') {
    try {
      await fetch(`/api/attachments/${att.id}`, { method: 'DELETE' })
    } catch (e) {
      console.error('Failed to delete attachment:', e)
      // Continue with local removal even if API fails
    }
  }

  // If it's an inline image, remove from editor too
  if (att.isInline && editor.value) {
    const html = editor.value.getHTML()
    const newHtml = html.replace(new RegExp(`<img[^>]*src="${att.url}"[^>]*>`, 'g'), '')
    editor.value.commands.setContent(newHtml)
  }
  attachments.value.splice(index, 1)
}

// Format file size for display
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// Load "me" contacts for From dropdown
async function loadMeContacts() {
  const result = await getMeContacts()
  const contacts = result.data.contacts

  meContacts.value = contacts

  // Set default From
  if (props.defaultFromId) {
    selectedFromId.value = props.defaultFromId
  } else if (contacts.length > 0 && contacts[0]) {
    selectedFromId.value = contacts[0].id
  }
}

// Parse Reply-To header string into recipients
function parseReplyTo(replyTo: string): Recipient[] {
  const recipients: Recipient[] = []
  const regex = /(?:([^<,]+?)\s*<([^>]+)>|([^\s,<>]+@[^\s,<>]+))/g
  let match
  while ((match = regex.exec(replyTo)) !== null) {
    if (match[2]) {
      recipients.push({ email: match[2].trim(), name: match[1]?.trim() || null })
    } else if (match[3]) {
      recipients.push({ email: match[3].trim(), name: null })
    }
  }
  return recipients
}

// Initialize reply data
function initializeReply() {
  if (!props.originalEmail) return

  const orig = props.originalEmail

  // Set subject
  const subjectPrefix = orig.subject.toLowerCase().startsWith('re:') ? '' : 'Re: '
  subject.value = subjectPrefix + orig.subject

  // Check if I sent the original email
  const iSentOriginal = orig.sender && meContacts.value.some(m => m.id === orig.sender!.id)

  // Set recipients based on Reply vs Reply All
  if (props.replyAll || iSentOriginal) {
    if (orig.replyTo) {
      const replyToRecipients = parseReplyTo(orig.replyTo)
      for (const r of replyToRecipients) {
        if (!meContacts.value.some(m => m.email === r.email)) {
          toRecipients.value.push(r)
        }
      }
    } else if (orig.sender && !iSentOriginal) {
      toRecipients.value.push({
        id: orig.sender.id,
        email: orig.sender.email,
        name: orig.sender.name,
      })
    }

    for (const r of orig.recipients) {
      if (meContacts.value.some(m => m.id === r.id)) continue

      if (r.role === 'to') {
        if (!toRecipients.value.some(t => t.email === r.email)) {
          toRecipients.value.push({ id: r.id, email: r.email, name: r.name })
        }
      } else if (r.role === 'cc') {
        ccRecipients.value.push({ id: r.id, email: r.email, name: r.name })
        showCc.value = true
      }
    }
  } else {
    if (orig.replyTo) {
      const replyToRecipients = parseReplyTo(orig.replyTo)
      for (const r of replyToRecipients) {
        if (!meContacts.value.some(m => m.email === r.email)) {
          toRecipients.value.push(r)
        }
      }
    } else if (orig.sender) {
      toRecipients.value.push({
        id: orig.sender.id,
        email: orig.sender.email,
        name: orig.sender.name,
      })
    }
  }
}

// Load existing draft for editing
function loadExistingDraft() {
  if (!props.existingDraft) return

  const draft = props.existingDraft
  draftId.value = draft.id || null
  subject.value = draft.subject

  // Load content
  if (draft.contentHtml) {
    editor.value?.commands.setContent(draft.contentHtml)
    isRichText.value = true
  } else {
    bodyText.value = draft.contentText || ''
    isRichText.value = false
  }

  // Set sender (only if it's a valid "me" contact)
  if (draft.sender) {
    const senderIsMe = meContacts.value.some(m => m.id === draft.sender!.id)
    if (senderIsMe) {
      selectedFromId.value = draft.sender.id
    }
    // If sender isn't in meContacts, keep the default that was set by loadMeContacts
  }

  // Load recipients
  for (const r of draft.recipients) {
    const recipient: Recipient = { id: r.id, email: r.email, name: r.name }
    if (r.role === 'to') {
      toRecipients.value.push(recipient)
    } else if (r.role === 'cc') {
      ccRecipients.value.push(recipient)
      showCc.value = true
    } else if (r.role === 'bcc') {
      bccRecipients.value.push(recipient)
      showBcc.value = true
    }
  }

  // Load attachments
  if (draft.attachments) {
    for (const att of draft.attachments) {
      attachments.value.push({
        id: att.id,
        filename: att.filename,
        mimeType: att.mimeType || 'application/octet-stream',
        size: att.size || 0,
        url: `/api/attachments/${att.id}`,
        isInline: att.isInline || false,
      })
    }
  }
}

// Formatting functions
function toggleBold() {
  editor.value?.chain().focus().toggleBold().run()
}

function toggleItalic() {
  editor.value?.chain().focus().toggleItalic().run()
}

function toggleUnderline() {
  editor.value?.chain().focus().toggleStrike().run() // Tiptap uses strike, we'll style it as underline
}

function toggleBulletList() {
  editor.value?.chain().focus().toggleBulletList().run()
}

function toggleOrderedList() {
  editor.value?.chain().focus().toggleOrderedList().run()
}

function toggleBlockquote() {
  editor.value?.chain().focus().toggleBlockquote().run()
}

function insertLink() {
  const url = prompt('Enter URL:')
  if (url) {
    editor.value?.chain().focus().setLink({ href: url }).run()
  }
}

function insertImage() {
  // Trigger file input for image selection
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (file) {
      await uploadAndInsertImage(file)
    }
  }
  input.click()
}

function getEditorContent(): string {
  return editor.value?.getHTML() || ''
}

function getPlainText(): string {
  return editor.value?.getText() || ''
}

function toggleEditorMode() {
  if (isRichText.value) {
    // Switching to plain text - convert HTML to text
    bodyText.value = getPlainText()
    isRichText.value = false
  } else {
    // Switching to rich text - convert text to HTML
    const html = bodyText.value
      .split('\n')
      .map(line => line ? `<p>${line}</p>` : '<p><br></p>')
      .join('')
    editor.value?.commands.setContent(html)
    isRichText.value = true
  }
}

// Contact search
async function doContactSearch() {
  if (searchQuery.value.length < 2) {
    searchResults.value = []
    return
  }

  searchLoading.value = true
  try {
    const addedIds = new Set([
      ...toRecipients.value.map(r => r.id),
      ...ccRecipients.value.map(r => r.id),
      ...bccRecipients.value.map(r => r.id),
    ].filter(Boolean))

    const result = await apiSearchContacts(searchQuery.value, 10)
    const contacts = result.data.contacts

    searchResults.value = contacts.filter(c =>
      !addedIds.has(c.id) && !meContacts.value.some(m => m.id === c.id)
    )
  } catch (e) {
    searchResults.value = []
  } finally {
    searchLoading.value = false
  }
}

function onSearchInput() {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(doContactSearch, 200)
}

function addRecipient(contact: Contact, field: 'to' | 'cc' | 'bcc') {
  const recipient: Recipient = { id: contact.id, email: contact.email, name: contact.name }

  if (field === 'to') {
    toRecipients.value.push(recipient)
  } else if (field === 'cc') {
    ccRecipients.value.push(recipient)
  } else {
    bccRecipients.value.push(recipient)
  }

  searchQuery.value = ''
  searchResults.value = []
}

function addRawEmail(field: 'to' | 'cc' | 'bcc') {
  const email = searchQuery.value.trim()
  if (!email || !email.includes('@')) return

  const recipient: Recipient = { email, name: null }

  if (field === 'to') {
    toRecipients.value.push(recipient)
  } else if (field === 'cc') {
    ccRecipients.value.push(recipient)
  } else {
    bccRecipients.value.push(recipient)
  }

  searchQuery.value = ''
  searchResults.value = []
}

function removeRecipient(index: number, field: 'to' | 'cc' | 'bcc') {
  if (field === 'to') {
    toRecipients.value.splice(index, 1)
  } else if (field === 'cc') {
    ccRecipients.value.splice(index, 1)
  } else {
    bccRecipients.value.splice(index, 1)
  }
}

function handleInputKeydown(e: KeyboardEvent, field: 'to' | 'cc' | 'bcc') {
  if (e.key === 'Enter' || e.key === 'Tab' || e.key === ',') {
    e.preventDefault()
    const firstResult = searchResults.value[0]
    if (searchResults.value.length > 0 && firstResult) {
      addRecipient(firstResult, field)
    } else if (searchQuery.value.includes('@')) {
      addRawEmail(field)
    }
  } else if (e.key === 'Backspace' && searchQuery.value === '') {
    if (field === 'to' && toRecipients.value.length > 0) {
      toRecipients.value.pop()
    } else if (field === 'cc' && ccRecipients.value.length > 0) {
      ccRecipients.value.pop()
    } else if (field === 'bcc' && bccRecipients.value.length > 0) {
      bccRecipients.value.pop()
    }
  }
}

// Check if there's content worth saving
function hasContent(): boolean {
  const text = isRichText.value ? getPlainText() : bodyText.value
  return text.trim().length > 0 || toRecipients.value.length > 0 || attachments.value.length > 0
}

// Auto-save draft
async function saveDraft() {
  if (!selectedFromId.value) return
  if (!hasContent() && !draftId.value) return

  saving.value = true
  try {
    const recipients = [
      ...toRecipients.value.map(r => ({ ...r, role: 'to' as const })),
      ...ccRecipients.value.map(r => ({ ...r, role: 'cc' as const })),
      ...bccRecipients.value.map(r => ({ ...r, role: 'bcc' as const })),
    ]

    const draftData = {
      threadId: props.threadId,
      senderId: selectedFromId.value,
      subject: subject.value,
      contentText: isRichText.value ? getPlainText() : bodyText.value,
      contentHtml: isRichText.value ? getEditorContent() : undefined,
      inReplyTo: props.originalEmail?.messageId,
      references: props.originalEmail?.references,
      recipients,
      attachmentIds: attachments.value.map(a => typeof a.id === 'number' ? a.id : parseInt(a.id as string)).filter(id => !isNaN(id)),
    }

    if (draftId.value) {
      // Update existing draft
      const result = await apiUpdateDraft(draftId.value, draftData)
      isPending.value = result.pending
    } else {
      // Create new draft
      const result = await apiCreateDraft(draftData)
      draftId.value = result.draftId
      isPending.value = result.pending
    }
  } catch (e) {
    console.error('Failed to save draft:', e)
  } finally {
    saving.value = false
  }
}

// Trigger auto-save with debounce
function triggerAutoSave() {
  if (autoSaveTimeout) clearTimeout(autoSaveTimeout)
  autoSaveTimeout = setTimeout(saveDraft, 1000)
}

// Delete draft and close
async function discardDraft() {
  if (autoSaveTimeout) clearTimeout(autoSaveTimeout)

  if (draftId.value) {
    try {
      await apiDeleteDraft(draftId.value)
      emit('discarded')
    } catch (e) {
      console.error('Failed to delete draft:', e)
      emit('close')
    }
  } else {
    emit('close')
  }
}

// Close without deleting (keep draft)
function closeKeepDraft() {
  if (autoSaveTimeout) clearTimeout(autoSaveTimeout)
  saveDraft()
  emit('close')
}

// Queue draft for sending
async function handleSend() {
  if (!canSend.value || sending.value) return

  // Save draft first if needed
  await saveDraft()

  if (!draftId.value) {
    console.error('Cannot send: no draft ID')
    return
  }

  sending.value = true
  try {
    await apiSendDraft(draftId.value)
    emit('sent', draftId.value)
  } catch (e) {
    console.error('Failed to queue send:', e)
  } finally {
    sending.value = false
  }
}

function getRecipientDisplay(r: Recipient): string {
  return r.name || r.email
}

// Watch for changes and trigger auto-save
watch([toRecipients, ccRecipients, bccRecipients, subject], triggerAutoSave, { deep: true })
watch(bodyText, triggerAutoSave)
watch(attachments, triggerAutoSave, { deep: true })

// Initialize on mount
onMounted(async () => {
  await loadMeContacts()
  if (props.existingDraft) {
    loadExistingDraft()
  } else {
    initializeReply()
  }
})

// Cleanup on unmount
onUnmounted(() => {
  if (autoSaveTimeout) clearTimeout(autoSaveTimeout)
  editor.value?.destroy()
})
</script>

<template>
  <div class="email-composer">
    <div class="composer-header">
      <h3>{{ existingDraft ? 'Edit Draft' : (originalEmail ? (replyAll ? 'Reply All' : 'Reply') : 'New Email') }}</h3>
      <div class="header-right">
        <span v-if="uploading" class="uploading-indicator">Uploading...</span>
        <span v-else-if="saving" class="saving-indicator">Saving...</span>
        <span v-else-if="isPending" class="pending-indicator">Saved locally</span>
        <span v-else-if="draftId" class="saved-indicator">Draft saved</span>
        <button class="close-btn" @click="closeKeepDraft" title="Close (draft saved)">×</button>
      </div>
    </div>

    <div class="composer-fields">
      <!-- From -->
      <div class="field-row">
        <label>From</label>
        <select v-model="selectedFromId" class="from-select">
          <option v-for="contact in meContacts" :key="contact.id" :value="contact.id">
            {{ contact.name ? `${contact.name} <${contact.email}>` : contact.email }}
          </option>
        </select>
      </div>

      <!-- To -->
      <div class="field-row">
        <label>To</label>
        <div class="recipient-field" @click="activeField = 'to'">
          <span
            v-for="(r, i) in toRecipients"
            :key="r.id || r.email"
            class="recipient-pill"
          >
            {{ getRecipientDisplay(r) }}
            <button class="remove-pill" @click.stop="removeRecipient(i, 'to')">×</button>
          </span>
          <input
            v-model="searchQuery"
            type="text"
            class="recipient-input"
            placeholder="Add recipient..."
            @input="onSearchInput"
            @keydown="handleInputKeydown($event, 'to')"
            @focus="activeField = 'to'"
          />
          <div v-if="activeField === 'to' && (searchResults.length > 0 || searchLoading)" class="search-dropdown">
            <div v-if="searchLoading" class="search-loading">Searching...</div>
            <button
              v-for="contact in searchResults"
              :key="contact.id"
              class="search-result"
              @click="addRecipient(contact, 'to')"
            >
              <span class="result-name">{{ contact.name || contact.email }}</span>
              <span v-if="contact.name" class="result-email">{{ contact.email }}</span>
            </button>
          </div>
        </div>
        <button v-if="!showCc" class="add-field-btn" @click="showCc = true">Cc</button>
        <button v-if="!showBcc" class="add-field-btn" @click="showBcc = true">Bcc</button>
      </div>

      <!-- CC -->
      <div v-if="showCc" class="field-row">
        <label>Cc</label>
        <div class="recipient-field" @click="activeField = 'cc'">
          <span
            v-for="(r, i) in ccRecipients"
            :key="r.id || r.email"
            class="recipient-pill"
          >
            {{ getRecipientDisplay(r) }}
            <button class="remove-pill" @click.stop="removeRecipient(i, 'cc')">×</button>
          </span>
          <input
            v-model="searchQuery"
            type="text"
            class="recipient-input"
            placeholder="Add Cc..."
            @input="onSearchInput"
            @keydown="handleInputKeydown($event, 'cc')"
            @focus="activeField = 'cc'"
          />
          <div v-if="activeField === 'cc' && (searchResults.length > 0 || searchLoading)" class="search-dropdown">
            <div v-if="searchLoading" class="search-loading">Searching...</div>
            <button
              v-for="contact in searchResults"
              :key="contact.id"
              class="search-result"
              @click="addRecipient(contact, 'cc')"
            >
              <span class="result-name">{{ contact.name || contact.email }}</span>
              <span v-if="contact.name" class="result-email">{{ contact.email }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- BCC -->
      <div v-if="showBcc" class="field-row">
        <label>Bcc</label>
        <div class="recipient-field" @click="activeField = 'bcc'">
          <span
            v-for="(r, i) in bccRecipients"
            :key="r.id || r.email"
            class="recipient-pill"
          >
            {{ getRecipientDisplay(r) }}
            <button class="remove-pill" @click.stop="removeRecipient(i, 'bcc')">×</button>
          </span>
          <input
            v-model="searchQuery"
            type="text"
            class="recipient-input"
            placeholder="Add Bcc..."
            @input="onSearchInput"
            @keydown="handleInputKeydown($event, 'bcc')"
            @focus="activeField = 'bcc'"
          />
          <div v-if="activeField === 'bcc' && (searchResults.length > 0 || searchLoading)" class="search-dropdown">
            <div v-if="searchLoading" class="search-loading">Searching...</div>
            <button
              v-for="contact in searchResults"
              :key="contact.id"
              class="search-result"
              @click="addRecipient(contact, 'bcc')"
            >
              <span class="result-name">{{ contact.name || contact.email }}</span>
              <span v-if="contact.name" class="result-email">{{ contact.email }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Subject -->
      <div class="field-row">
        <label>Subject</label>
        <input v-model="subject" type="text" class="subject-input" />
      </div>
    </div>

    <!-- Body -->
    <div class="composer-body">
      <div class="editor-toolbar">
        <template v-if="isRichText">
          <button
            type="button"
            class="toolbar-btn"
            :class="{ active: editor?.isActive('bold') }"
            title="Bold"
            @click="toggleBold"
          >
            <strong>B</strong>
          </button>
          <button
            type="button"
            class="toolbar-btn"
            :class="{ active: editor?.isActive('italic') }"
            title="Italic"
            @click="toggleItalic"
          >
            <em>I</em>
          </button>
          <button
            type="button"
            class="toolbar-btn"
            :class="{ active: editor?.isActive('strike') }"
            title="Strikethrough"
            @click="toggleUnderline"
          >
            <s>S</s>
          </button>
          <span class="toolbar-divider"></span>
          <button
            type="button"
            class="toolbar-btn"
            :class="{ active: editor?.isActive('bulletList') }"
            title="Bullet List"
            @click="toggleBulletList"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="9" y1="6" x2="20" y2="6"></line>
              <line x1="9" y1="12" x2="20" y2="12"></line>
              <line x1="9" y1="18" x2="20" y2="18"></line>
              <circle cx="4" cy="6" r="1.5" fill="currentColor"></circle>
              <circle cx="4" cy="12" r="1.5" fill="currentColor"></circle>
              <circle cx="4" cy="18" r="1.5" fill="currentColor"></circle>
            </svg>
          </button>
          <button
            type="button"
            class="toolbar-btn"
            :class="{ active: editor?.isActive('orderedList') }"
            title="Numbered List"
            @click="toggleOrderedList"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="10" y1="6" x2="20" y2="6"></line>
              <line x1="10" y1="12" x2="20" y2="12"></line>
              <line x1="10" y1="18" x2="20" y2="18"></line>
              <text x="4" y="8" font-size="8" fill="currentColor" stroke="none">1</text>
              <text x="4" y="14" font-size="8" fill="currentColor" stroke="none">2</text>
              <text x="4" y="20" font-size="8" fill="currentColor" stroke="none">3</text>
            </svg>
          </button>
          <span class="toolbar-divider"></span>
          <button type="button" class="toolbar-btn" title="Link" @click="insertLink">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
            </svg>
          </button>
          <button
            type="button"
            class="toolbar-btn"
            :class="{ active: editor?.isActive('blockquote') }"
            title="Quote"
            @click="toggleBlockquote"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z"></path>
              <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z"></path>
            </svg>
          </button>
          <button type="button" class="toolbar-btn" title="Insert Image" @click="insertImage">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <circle cx="8.5" cy="8.5" r="1.5"></circle>
              <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
          </button>
          <span class="toolbar-divider"></span>
        </template>
        <button type="button" class="toolbar-btn" title="Attach File" @click="triggerFileUpload">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
          </svg>
        </button>
        <input
          ref="fileInputRef"
          type="file"
          multiple
          accept="*/*"
          class="hidden-file-input"
          @change="handleFileSelect"
        />
        <span class="toolbar-divider"></span>
        <button
          type="button"
          class="toolbar-btn mode-toggle"
          :class="{ active: !isRichText }"
          :title="isRichText ? 'Switch to plain text' : 'Switch to rich text'"
          @click="toggleEditorMode"
        >
          Aa
        </button>
        <span class="mode-label">{{ isRichText ? 'Rich text' : 'Plain text' }}</span>
      </div>

      <!-- Upload progress -->
      <div v-if="uploading" class="upload-progress">
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: uploadProgress + '%' }"></div>
        </div>
        <span class="progress-text">Uploading... {{ uploadProgress }}%</span>
      </div>

      <!-- Upload error -->
      <div v-if="uploadError" class="upload-error">
        {{ uploadError }}
        <button @click="uploadError = null">×</button>
      </div>

      <!-- Tiptap Editor -->
      <div v-if="isRichText" class="editor-wrapper">
        <EditorContent :editor="editor" class="tiptap-editor" />
      </div>
      <textarea
        v-else
        v-model="bodyText"
        class="body-textarea"
        placeholder="Write your message..."
      ></textarea>
    </div>

    <!-- Attachments -->
    <div v-if="attachments.filter(a => !a.isInline).length > 0" class="attachments-list">
      <div class="attachments-header">Attachments</div>
      <div
        v-for="(att, i) in attachments.filter(a => !a.isInline)"
        :key="att.id"
        class="attachment-item"
      >
        <span class="attachment-name">{{ att.filename }}</span>
        <span class="attachment-size">{{ formatFileSize(att.size) }}</span>
        <button class="remove-attachment" @click="removeAttachment(attachments.indexOf(att))">×</button>
      </div>
    </div>

    <!-- Actions -->
    <div class="composer-actions">
      <button class="send-btn" @click="handleSend" :disabled="!canSend || sending">
        {{ sending ? 'Sending...' : 'Send' }}
      </button>
      <button class="discard-btn" @click="discardDraft">Discard</button>
    </div>
  </div>
</template>

<style scoped>
.email-composer {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
}

.composer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid #e5e5e5;
}

.composer-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.uploading-indicator {
  font-size: 12px;
  color: #2563eb;
}

.saving-indicator {
  font-size: 12px;
  color: #999;
}

.saved-indicator {
  font-size: 12px;
  color: #22c55e;
}

.pending-indicator {
  font-size: 12px;
  color: #f59e0b;
}

.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  color: #666;
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.close-btn:hover {
  color: #000;
}

.composer-fields {
  padding: 16px;
  border-bottom: 1px solid #e5e5e5;
}

.field-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}

.field-row:last-child {
  margin-bottom: 0;
}

.field-row label {
  width: 60px;
  padding-top: 8px;
  font-size: 13px;
  color: #666;
  flex-shrink: 0;
}

.from-select {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #e5e5e5;
  border-radius: 4px;
  font-size: 14px;
  background: #fff;
}

.recipient-field {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border: 1px solid #e5e5e5;
  border-radius: 4px;
  min-height: 38px;
  position: relative;
  cursor: text;
}

.recipient-field:focus-within {
  border-color: #999;
}

.recipient-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: #e5e5e5;
  border-radius: 16px;
  font-size: 13px;
}

.remove-pill {
  background: none;
  border: none;
  padding: 0;
  font-size: 14px;
  color: #666;
  cursor: pointer;
  line-height: 1;
}

.remove-pill:hover {
  color: #000;
}

.recipient-input {
  flex: 1;
  min-width: 120px;
  border: none;
  outline: none;
  font-size: 14px;
  padding: 4px 0;
}

.search-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: #fff;
  border: 1px solid #e5e5e5;
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 100;
  max-height: 200px;
  overflow-y: auto;
}

.search-loading {
  padding: 12px;
  color: #666;
  font-size: 13px;
}

.search-result {
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: 10px 12px;
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
}

.search-result:hover {
  background: #f5f5f5;
}

.result-name {
  font-size: 14px;
  color: #000;
}

.result-email {
  font-size: 12px;
  color: #666;
}

.add-field-btn {
  padding: 6px 12px;
  background: none;
  border: 1px solid #e5e5e5;
  border-radius: 4px;
  font-size: 12px;
  color: #666;
  cursor: pointer;
  flex-shrink: 0;
  min-height: 38px;
  display: flex;
  align-items: center;
}

.add-field-btn:hover {
  border-color: #999;
  color: #000;
}

.subject-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #e5e5e5;
  border-radius: 4px;
  font-size: 14px;
}

.composer-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 200px;
}

.editor-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 8px 16px;
  border-bottom: 1px solid #e5e5e5;
  background: #fafafa;
}

.toolbar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: none;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  color: #666;
  font-size: 14px;
  transition: all 0.15s;
}

.toolbar-btn:hover {
  background: #e5e5e5;
  color: #000;
}

.toolbar-btn.active {
  background: #e5e5e5;
  color: #000;
}

.mode-toggle {
  font-size: 12px;
  font-weight: 500;
}

.mode-label {
  font-size: 11px;
  color: #999;
  margin-left: 4px;
}

.toolbar-divider {
  width: 1px;
  height: 20px;
  background: #e5e5e5;
  margin: 0 6px;
}

.hidden-file-input {
  display: none;
}

.upload-progress {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  background: #f0f9ff;
  border-bottom: 1px solid #e5e5e5;
}

.progress-bar {
  flex: 1;
  height: 6px;
  background: #e5e5e5;
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: #2563eb;
  border-radius: 3px;
  transition: width 0.15s ease;
}

.progress-text {
  font-size: 12px;
  color: #2563eb;
  white-space: nowrap;
}

.upload-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: #fef2f2;
  color: #dc2626;
  font-size: 13px;
}

.upload-error button {
  background: none;
  border: none;
  color: #dc2626;
  cursor: pointer;
  font-size: 16px;
}

.editor-wrapper {
  flex: 1;
  overflow-y: auto;
}

.tiptap-editor {
  padding: 16px;
  min-height: 150px;
  font-size: 14px;
  line-height: 1.6;
}

.tiptap-editor :deep(.tiptap) {
  outline: none;
  min-height: 150px;
}

.tiptap-editor :deep(.tiptap p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  color: #999;
  pointer-events: none;
  float: left;
  height: 0;
}

.tiptap-editor :deep(.tiptap blockquote) {
  margin: 8px 0 8px 12px;
  padding-left: 12px;
  border-left: 2px solid #ccc;
  color: #666;
}

.tiptap-editor :deep(.tiptap a) {
  color: #2563eb;
}

.tiptap-editor :deep(.tiptap ul),
.tiptap-editor :deep(.tiptap ol) {
  margin: 8px 0;
  padding-left: 24px;
}

.tiptap-editor :deep(.tiptap li) {
  margin: 4px 0;
}

.tiptap-editor :deep(.tiptap img.editor-image) {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
  margin: 8px 0;
}

.body-textarea {
  flex: 1;
  width: 100%;
  padding: 16px;
  border: none;
  outline: none;
  font-size: 14px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  line-height: 1.6;
  resize: none;
}

.attachments-list {
  border-top: 1px solid #e5e5e5;
  padding: 12px 16px;
}

.attachments-header {
  font-size: 12px;
  font-weight: 600;
  color: #666;
  margin-bottom: 8px;
}

.attachment-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #f5f5f5;
  border-radius: 4px;
  margin-bottom: 6px;
}

.attachment-item:last-child {
  margin-bottom: 0;
}

.attachment-name {
  flex: 1;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attachment-size {
  font-size: 12px;
  color: #666;
}

.remove-attachment {
  background: none;
  border: none;
  color: #666;
  cursor: pointer;
  font-size: 16px;
  padding: 0;
}

.remove-attachment:hover {
  color: #dc2626;
}

.composer-actions {
  display: flex;
  gap: 12px;
  padding: 16px;
  border-top: 1px solid #e5e5e5;
}

.send-btn {
  padding: 8px 24px;
  background: #2563eb;
  color: #fff;
  border: none;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.send-btn:hover:not(:disabled) {
  background: #1d4ed8;
}

.send-btn:disabled {
  background: #93c5fd;
  cursor: not-allowed;
}

.discard-btn {
  padding: 8px 16px;
  background: #fff;
  color: #666;
  border: 1px solid #e5e5e5;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
}

.discard-btn:hover {
  border-color: #dc2626;
  color: #dc2626;
}
</style>
