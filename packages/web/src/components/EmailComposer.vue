<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import type { SyncDraftInput } from '@meremail/shared/sync-types'
import { getMeta, type LocalDraft } from '@/local/db'
import { listIdentities, searchContacts } from '@/local/queries'
import { enqueue, saveDraft as queueSaveDraft, sendDraft as queueSendDraft, discardDraft as queueDiscardDraft, removeDraftAttachment } from '@/local/actions'
import { putFile, draftAttachmentKey } from '@/local/files'
import { syncNow, isOnline } from '@/local/sync'
import { uuid } from '@/local/uuid'

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
  sentAt: number | null
  sender: Contact | null
  recipients: (Contact & { role: string })[]
  contentText: string
  messageId?: string
  references?: string[]
  replyTo?: string | null
}

interface ForwardEmail {
  id: number
  subject: string
  messageId?: string
}

interface UploadedFile {
  id: string
  filename: string
  mimeType: string
  size: number
  url: string
  isInline?: boolean
}

const props = defineProps<{
  /** ID this draft is (or will be) stored under */
  draftId: string
  threadId?: number  // Optional for standalone drafts
  originalEmail?: OriginalEmail
  forwardEmail?: ForwardEmail
  replyAll?: boolean
  defaultFromId?: number
  existingDraft?: LocalDraft
}>()

const emit = defineEmits<{
  close: []
  sent: []
  discarded: []
}>()

// What this draft is a reply to / forward of. For an existing draft this
// comes from the draft itself; otherwise from the email being answered.
const threading = props.existingDraft
  ? {
      threadId: props.existingDraft.threadId,
      inReplyTo: props.existingDraft.inReplyTo,
      references: props.existingDraft.references,
      forwardedMessageId: props.existingDraft.forwardedMessageId,
    }
  : {
      threadId: props.threadId ?? null,
      inReplyTo: props.originalEmail?.messageId ?? null,
      references: props.originalEmail
        ? [...(props.originalEmail.references || []), props.originalEmail.messageId].filter((r): r is string => !!r)
        : [],
      forwardedMessageId: props.forwardEmail?.messageId ?? null,
    }

// From identities
const meContacts = ref<Contact[]>([])
const selectedFromId = ref<number | null>(null)
const fromSearchQuery = ref('')
const fromDropdownOpen = ref(false)

// Filter identities based on search
const filteredFromContacts = computed(() => {
  const query = fromSearchQuery.value.toLowerCase().trim()
  if (!query) return meContacts.value
  return meContacts.value.filter(c =>
    c.email.toLowerCase().includes(query) ||
    (c.name && c.name.toLowerCase().includes(query))
  )
})

// Get selected from contact
const selectedFromContact = computed(() => {
  if (!selectedFromId.value) return null
  return meContacts.value.find(c => c.id === selectedFromId.value) || null
})

function selectFromContact(contact: Contact) {
  selectedFromId.value = contact.id
  fromSearchQuery.value = ''
  fromDropdownOpen.value = false
  triggerAutoSave()
}

function handleFromInputFocus() {
  fromDropdownOpen.value = true
}

function handleFromInputBlur() {
  // Delay to allow click on dropdown item
  setTimeout(() => {
    fromDropdownOpen.value = false
    fromSearchQuery.value = ''
  }, 150)
}

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
const uploadError = ref<string | null>(null)

// Contact search
const searchQuery = ref('')
const searchResults = ref<Contact[]>([])
const searchLoading = ref(false)
const activeField = ref<'to' | 'cc' | 'bcc' | null>(null)
let searchDebounce: ReturnType<typeof setTimeout> | null = null

// Saving state
// True once the draft exists in the local database
const saved = ref(!!props.existingDraft)
// True once the draft has been sent or discarded - nothing more should be saved
let finished = false
// Don't save while the form is still being filled in from props
let initializing = true
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
            attachAndInsertImage(file)
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
        attachAndInsertImage(file)
      }
      return true
    },
  },
  onUpdate: () => {
    triggerAutoSave()
  },
})

// Attach a file to the draft. The file is stored on this device and its
// upload is queued, so this works offline.
async function attachFile(file: File, isInline: boolean): Promise<UploadedFile> {
  if (!selectedFromId.value) {
    throw new Error('No sender selected')
  }

  const maxSize = (await getMeta('config'))?.maxAttachmentSize
  if (maxSize && file.size > maxSize) {
    throw new Error(`File too large. Maximum size is ${Math.round(maxSize / 1024 / 1024)}MB`)
  }

  // The draft has to exist before something can be attached to it
  await saveDraft({ force: true })

  const attachmentId = uuid()
  const mimeType = file.type || 'application/octet-stream'
  await putFile(draftAttachmentKey(attachmentId), file, file.name)
  await enqueue({
    type: 'draft.upload',
    payload: {
      draftId: props.draftId,
      attachmentId,
      filename: file.name || 'unnamed',
      mimeType,
      size: file.size,
      isInline,
    },
  })

  return {
    id: attachmentId,
    filename: file.name || 'unnamed',
    mimeType,
    size: file.size,
    url: `/api/draft-attachments/${attachmentId}`,
    isInline,
  }
}

// Attach image and insert into editor
async function attachAndInsertImage(file: File) {
  uploading.value = true
  uploadError.value = null

  try {
    const attached = await attachFile(file, true)
    attachments.value.push(attached)

    // The image is shown from its upload URL. The service worker serves that
    // from this device; without one, wait for the upload so the URL works.
    if (!navigator.serviceWorker?.controller && isOnline.value) {
      await syncNow()
    }

    editor.value?.chain().focus().setImage({ src: attached.url, alt: attached.filename }).run()
  } catch (e) {
    uploadError.value = e instanceof Error ? e.message : 'Failed to attach image'
    console.error('Attach failed:', e)
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
  uploadError.value = null

  try {
    for (const file of files) {
      attachments.value.push(await attachFile(file, false))
    }
  } catch (e) {
    uploadError.value = e instanceof Error ? e.message : 'Failed to attach file'
    console.error('Attach failed:', e)
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

  // If it's an inline image, remove from editor too
  if (att.isInline && editor.value) {
    const html = editor.value.getHTML()
    const newHtml = html.replace(new RegExp(`<img[^>]*src="${att.url}"[^>]*>`, 'g'), '')
    editor.value.commands.setContent(newHtml)
  }
  attachments.value.splice(index, 1)

  await removeDraftAttachment(props.draftId, att.id)
}

// Format file size for display
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// Load "me" contacts for From dropdown
async function loadMeContacts() {
  const contacts = await listIdentities()

  meContacts.value = contacts

  // Set default From
  if (props.defaultFromId && contacts.some(c => c.id === props.defaultFromId)) {
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

// Initialize forward data
function initializeForward() {
  if (!props.forwardEmail) return

  const fwd = props.forwardEmail

  // Set subject with "Fwd:" prefix
  const subjectPrefix = fwd.subject.toLowerCase().startsWith('fwd:') ? '' : 'Fwd: '
  subject.value = subjectPrefix + fwd.subject

  // For forward, recipients are left empty (user will add them).
  // The original email's attachments are added by the server when it sends.
}

// Load existing draft for editing
function loadExistingDraft() {
  if (!props.existingDraft) return

  const draft = props.existingDraft
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
  if (meContacts.value.some(m => m.id === draft.senderId)) {
    selectedFromId.value = draft.senderId
  }
  // If sender isn't in meContacts, keep the default that was set by loadMeContacts

  // Load recipients
  for (const r of draft.recipients) {
    const recipient: Recipient = { id: r.contactId, email: r.email, name: r.name }
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
  for (const att of draft.attachments) {
    attachments.value.push({
      id: att.id,
      filename: att.filename,
      mimeType: att.mimeType || 'application/octet-stream',
      size: att.size || 0,
      url: `/api/draft-attachments/${att.id}`,
      isInline: att.isInline,
    })
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
      await attachAndInsertImage(file)
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

    const contacts = await searchContacts(searchQuery.value, 20)

    searchResults.value = contacts
      .filter(c => !addedIds.has(c.id) && !meContacts.value.some(m => m.id === c.id))
      .slice(0, 10)
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

// The draft as it currently stands in the form
function currentDraft(): SyncDraftInput | null {
  if (!selectedFromId.value) return null

  const toDraftRecipient = (role: 'to' | 'cc' | 'bcc') => (r: Recipient) => ({
    contactId: r.id,
    email: r.email,
    name: r.name ?? null,
    role,
  })

  return {
    id: props.draftId,
    threadId: threading.threadId,
    senderId: selectedFromId.value,
    subject: subject.value,
    contentText: isRichText.value ? getPlainText() : bodyText.value,
    contentHtml: isRichText.value ? getEditorContent() : null,
    inReplyTo: threading.inReplyTo,
    forwardedMessageId: threading.forwardedMessageId,
    references: threading.references,
    recipients: [
      ...toRecipients.value.map(toDraftRecipient('to')),
      ...ccRecipients.value.map(toDraftRecipient('cc')),
      ...bccRecipients.value.map(toDraftRecipient('bcc')),
    ],
  }
}

// Save the draft. It is written to this device immediately and sent to the
// server in the background.
async function saveDraft(options: { force?: boolean } = {}) {
  if (finished || initializing) return
  if (autoSaveTimeout) {
    clearTimeout(autoSaveTimeout)
    autoSaveTimeout = null
  }

  const draft = currentDraft()
  if (!draft) return
  // Nothing written yet - don't create an empty draft
  if (!options.force && !hasContent() && !saved.value) return

  try {
    await queueSaveDraft(draft)
    saved.value = true
  } catch (e) {
    console.error('Failed to save draft:', e)
  }
}

// Trigger auto-save with debounce
function triggerAutoSave() {
  if (finished || initializing) return
  if (autoSaveTimeout) clearTimeout(autoSaveTimeout)
  autoSaveTimeout = setTimeout(saveDraft, 1000)
}

// Delete draft and close
async function discardDraft() {
  if (autoSaveTimeout) clearTimeout(autoSaveTimeout)
  finished = true

  if (saved.value) {
    try {
      await queueDiscardDraft(props.draftId)
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
async function closeKeepDraft() {
  await saveDraft()
  finished = true
  emit('close')
}

// Queue draft for sending
async function handleSend() {
  if (!canSend.value || finished) return

  const draft = currentDraft()
  if (!draft) return

  if (autoSaveTimeout) clearTimeout(autoSaveTimeout)
  finished = true

  try {
    // The Message-ID is chosen here so the sent email can be recognised when it comes back
    const domain = selectedFromContact.value?.email.split('@')[1] || 'meremail.local'
    await queueSendDraft(draft, `<${uuid()}@${domain}>`)
    emit('sent')
  } catch (e) {
    finished = false
    console.error('Failed to queue send:', e)
  }
}

function getRecipientDisplay(r: Recipient): string {
  return r.name || r.email
}

// Watch for changes and trigger auto-save
watch([toRecipients, ccRecipients, bccRecipients, subject], triggerAutoSave, { deep: true })
watch(bodyText, triggerAutoSave)

// Initialize on mount
onMounted(async () => {
  await loadMeContacts()
  if (props.existingDraft) {
    loadExistingDraft()
  } else if (props.forwardEmail) {
    initializeForward()
  } else {
    initializeReply()
  }
  // Let the watchers triggered by filling in the form run before saving is enabled
  setTimeout(() => { initializing = false }, 0)
})

// Cleanup on unmount
onUnmounted(() => {
  // Leaving with unsaved typing (e.g. via the back button) shouldn't lose it
  if (autoSaveTimeout) saveDraft()
  editor.value?.destroy()
})
</script>

<template>
  <div class="email-composer">
    <div class="composer-header">
      <h3>{{ existingDraft ? 'Edit Draft' : (forwardEmail ? 'Forward' : (originalEmail ? (replyAll ? 'Reply All' : 'Reply') : 'New Email')) }}</h3>
      <div class="header-right">
        <span v-if="uploading" class="uploading-indicator">Attaching...</span>
        <span v-else-if="saved" class="saved-indicator">Draft saved</span>
        <button class="close-btn" @click="closeKeepDraft" title="Close (draft saved)">×</button>
      </div>
    </div>

    <div class="composer-fields">
      <!-- From -->
      <div class="field-row">
        <label>From</label>
        <div class="from-field">
          <input
            v-model="fromSearchQuery"
            type="text"
            class="from-input"
            :placeholder="selectedFromContact ? (selectedFromContact.name ? `${selectedFromContact.name} <${selectedFromContact.email}>` : selectedFromContact.email) : 'Select identity...'"
            @focus="handleFromInputFocus"
            @blur="handleFromInputBlur"
          />
          <div v-if="fromDropdownOpen && filteredFromContacts.length > 0" class="from-dropdown">
            <button
              v-for="contact in filteredFromContacts"
              :key="contact.id"
              class="from-option"
              :class="{ selected: contact.id === selectedFromId }"
              @mousedown.prevent="selectFromContact(contact)"
            >
              <span class="from-option-name">{{ contact.name || contact.email.split('@')[0] }}</span>
              <span class="from-option-email">{{ contact.email }}</span>
            </button>
          </div>
        </div>
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
      <button class="send-btn" @click="handleSend" :disabled="!canSend">
        Send
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

.from-field {
  flex: 1;
  position: relative;
}

.from-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #e5e5e5;
  border-radius: 4px;
  font-size: 14px;
  background: #fff;
  outline: none;
}

.from-input:focus {
  border-color: #999;
}

.from-input::placeholder {
  color: #000;
  opacity: 1;
}

.from-input:focus::placeholder {
  color: #999;
}

.from-dropdown {
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
  margin-top: 2px;
}

.from-option {
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: 10px 12px;
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
}

.from-option:hover {
  background: #f5f5f5;
}

.from-option.selected {
  background: #e8f4ff;
}

.from-option-name {
  font-size: 14px;
  color: #000;
}

.from-option-email {
  font-size: 12px;
  color: #666;
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
