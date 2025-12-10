<script setup lang="ts">
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
  recipients: { id: number; email: string; name: string | null; role: string }[]
}

const props = defineProps<{
  threadId: number
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
const bodyHtml = ref('')
const bodyText = ref('')
const editorRef = ref<HTMLDivElement | null>(null)
const isRichText = ref(true)

// Contact search
const searchQuery = ref('')
const searchResults = ref<Contact[]>([])
const searchLoading = ref(false)
const activeField = ref<'to' | 'cc' | 'bcc' | null>(null)
let searchDebounce: ReturnType<typeof setTimeout> | null = null

// Saving state
const saving = ref(false)
const draftId = ref<number | null>(null)
let autoSaveTimeout: ReturnType<typeof setTimeout> | null = null

// Load "me" contacts for From dropdown
async function loadMeContacts() {
  try {
    const data = await $fetch<{ contacts: Contact[] }>('/api/contacts/me')
    meContacts.value = data.contacts

    // Set default From
    if (props.defaultFromId) {
      selectedFromId.value = props.defaultFromId
    } else if (data.contacts.length > 0) {
      selectedFromId.value = data.contacts[0].id
    }
  } catch (e) {
    console.error('Failed to load identities:', e)
  }
}

// Parse Reply-To header string into recipients
// Format: "Name <email>" or "email@domain.com" or "Name <email>, Other <other@email.com>"
function parseReplyTo(replyTo: string): Recipient[] {
  const recipients: Recipient[] = []
  // Match patterns like "Name <email>" or just "email@domain.com"
  const regex = /(?:([^<,]+?)\s*<([^>]+)>|([^\s,<>]+@[^\s,<>]+))/g
  let match
  while ((match = regex.exec(replyTo)) !== null) {
    if (match[2]) {
      // "Name <email>" format
      recipients.push({ email: match[2].trim(), name: match[1]?.trim() || null })
    } else if (match[3]) {
      // Plain email format
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
    // Reply All (or replying to my own email):
    // To = Reply-To (or sender if not me) + original To (except me)
    // CC = original CC (except me)

    // Use Reply-To if available, otherwise use sender (if not me)
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
        // Don't add if already in To from Reply-To
        if (!toRecipients.value.some(t => t.email === r.email)) {
          toRecipients.value.push({ id: r.id, email: r.email, name: r.name })
        }
      } else if (r.role === 'cc') {
        ccRecipients.value.push({ id: r.id, email: r.email, name: r.name })
        showCc.value = true
      }
    }
  } else {
    // Reply: To = Reply-To (or sender)
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

  // No quoted text in composer - server will handle that when sending
  // The inReplyTo field links this draft to the original email
}

// Load existing draft for editing
function loadExistingDraft() {
  if (!props.existingDraft) return

  const draft = props.existingDraft
  draftId.value = draft.id
  subject.value = draft.subject

  // Load content
  if (draft.contentHtml) {
    bodyHtml.value = draft.contentHtml
    isRichText.value = true
  } else {
    bodyText.value = draft.contentText || ''
    isRichText.value = false
  }

  // Set sender
  if (draft.sender) {
    selectedFromId.value = draft.sender.id
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
}

// Rich text formatting
function formatText(command: string, value?: string) {
  document.execCommand(command, false, value)
  editorRef.value?.focus()
}

function insertLink() {
  const url = prompt('Enter URL:')
  if (url) {
    document.execCommand('createLink', false, url)
    editorRef.value?.focus()
  }
}

function getEditorContent(): string {
  return editorRef.value?.innerHTML || ''
}

function getPlainText(): string {
  return editorRef.value?.innerText || ''
}

function toggleEditorMode() {
  if (isRichText.value) {
    // Switching to plain text - convert HTML to text
    bodyText.value = getPlainText()
    isRichText.value = false
  } else {
    // Switching to rich text - convert text to HTML
    bodyHtml.value = bodyText.value
      .split('\n')
      .map(line => line ? `<p>${line}</p>` : '<p><br></p>')
      .join('')
    isRichText.value = true
    // Sync content to editor after it renders
    nextTick(() => syncEditorContent())
  }
}

// Contact search
async function searchContacts() {
  if (searchQuery.value.length < 2) {
    searchResults.value = []
    return
  }

  searchLoading.value = true
  try {
    const data = await $fetch<{ contacts: Contact[] }>('/api/contacts', {
      query: { q: searchQuery.value, limit: 10 }
    })
    // Filter out already added recipients and me contacts
    const addedIds = new Set([
      ...toRecipients.value.map(r => r.id),
      ...ccRecipients.value.map(r => r.id),
      ...bccRecipients.value.map(r => r.id),
    ].filter(Boolean))

    searchResults.value = data.contacts.filter(c =>
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
  searchDebounce = setTimeout(searchContacts, 200)
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
    if (searchResults.value.length > 0) {
      addRecipient(searchResults.value[0], field)
    } else if (searchQuery.value.includes('@')) {
      addRawEmail(field)
    }
  } else if (e.key === 'Backspace' && searchQuery.value === '') {
    // Remove last recipient on backspace when input is empty
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
  return text.trim().length > 0 || toRecipients.value.length > 0
}

// Auto-save draft
async function saveDraft() {
  if (!selectedFromId.value) return
  if (!hasContent() && !draftId.value) return // Don't create empty drafts

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
    }

    if (draftId.value) {
      // Update existing draft
      await $fetch(`/api/drafts/${draftId.value}`, {
        method: 'PATCH',
        body: draftData,
      })
    } else {
      // Create new draft
      const result = await $fetch<{ id: number }>('/api/drafts', {
        method: 'POST',
        body: draftData,
      })
      draftId.value = result.id
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
      await $fetch(`/api/drafts/${draftId.value}`, { method: 'DELETE' })
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
  // Save one final time before closing
  saveDraft()
  emit('close')
}

function getRecipientDisplay(r: Recipient): string {
  return r.name || r.email
}

// Watch for changes and trigger auto-save
watch([toRecipients, ccRecipients, bccRecipients, subject], triggerAutoSave, { deep: true })
watch(bodyText, triggerAutoSave)
watch(bodyHtml, triggerAutoSave)

// Sync bodyHtml to the contenteditable div (one-way, avoids cursor reset)
function syncEditorContent() {
  if (editorRef.value && isRichText.value) {
    editorRef.value.innerHTML = bodyHtml.value
  }
}

// Initialize on mount
onMounted(async () => {
  await loadMeContacts()
  if (props.existingDraft) {
    loadExistingDraft()
  } else {
    initializeReply()
  }
  // Set initial editor content after DOM is ready
  nextTick(() => syncEditorContent())
})

// Cleanup on unmount
onUnmounted(() => {
  if (autoSaveTimeout) clearTimeout(autoSaveTimeout)
})
</script>

<template>
  <div class="email-composer">
    <div class="composer-header">
      <h3>{{ existingDraft ? 'Edit Draft' : (originalEmail ? (replyAll ? 'Reply All' : 'Reply') : 'New Email') }}</h3>
      <div class="header-right">
        <span v-if="saving" class="saving-indicator">Saving...</span>
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
          <button type="button" class="toolbar-btn" title="Bold" @click="formatText('bold')">
            <strong>B</strong>
          </button>
          <button type="button" class="toolbar-btn" title="Italic" @click="formatText('italic')">
            <em>I</em>
          </button>
          <button type="button" class="toolbar-btn" title="Underline" @click="formatText('underline')">
            <u>U</u>
          </button>
          <span class="toolbar-divider"></span>
          <button type="button" class="toolbar-btn" title="Bullet List" @click="formatText('insertUnorderedList')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="9" y1="6" x2="20" y2="6"></line>
              <line x1="9" y1="12" x2="20" y2="12"></line>
              <line x1="9" y1="18" x2="20" y2="18"></line>
              <circle cx="4" cy="6" r="1.5" fill="currentColor"></circle>
              <circle cx="4" cy="12" r="1.5" fill="currentColor"></circle>
              <circle cx="4" cy="18" r="1.5" fill="currentColor"></circle>
            </svg>
          </button>
          <button type="button" class="toolbar-btn" title="Numbered List" @click="formatText('insertOrderedList')">
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
          <button type="button" class="toolbar-btn" title="Quote" @click="formatText('formatBlock', 'blockquote')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z"></path>
              <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z"></path>
            </svg>
          </button>
          <span class="toolbar-divider"></span>
        </template>
        <button
          type="button"
          class="toolbar-btn mode-toggle"
          :class="{ active: !isRichText }"
          :title="isRichText ? 'Switch to plain text' : 'Switch to rich text'"
          @click="toggleEditorMode"
        >
          {{ isRichText ? 'Aa' : 'Aa' }}
        </button>
        <span class="mode-label">{{ isRichText ? 'Rich text' : 'Plain text' }}</span>
      </div>
      <div
        v-if="isRichText"
        ref="editorRef"
        class="body-editor"
        contenteditable="true"
        @input="bodyHtml = ($event.target as HTMLDivElement).innerHTML"
      ></div>
      <textarea
        v-else
        v-model="bodyText"
        class="body-textarea"
        placeholder="Write your message..."
      ></textarea>
    </div>

    <!-- Actions -->
    <div class="composer-actions">
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

.saving-indicator {
  font-size: 12px;
  color: #999;
}

.saved-indicator {
  font-size: 12px;
  color: #22c55e;
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

.mode-toggle {
  font-size: 12px;
  font-weight: 500;
}

.mode-toggle.active {
  background: #e5e5e5;
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

.body-editor {
  flex: 1;
  padding: 16px;
  min-height: 150px;
  outline: none;
  font-size: 14px;
  font-family: inherit;
  line-height: 1.6;
  overflow-y: auto;
}

.body-editor:empty::before {
  content: 'Write your message...';
  color: #999;
  pointer-events: none;
}

.body-editor blockquote {
  margin: 8px 0 8px 12px;
  padding-left: 12px;
  border-left: 2px solid #ccc;
  color: #666;
}

.body-editor a {
  color: #2563eb;
}

.body-editor ul,
.body-editor ol {
  margin: 8px 0;
  padding-left: 24px;
}

.body-editor li {
  margin: 4px 0;
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

.composer-actions {
  display: flex;
  gap: 12px;
  padding: 16px;
  border-top: 1px solid #e5e5e5;
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
