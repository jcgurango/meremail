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
}

const props = defineProps<{
  threadId: number
  originalEmail?: OriginalEmail
  replyAll?: boolean
  defaultFromId?: number
}>()

const emit = defineEmits<{
  close: []
  sent: [draftId: number]
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
const bodyText = ref('')

// Contact search
const searchQuery = ref('')
const searchResults = ref<Contact[]>([])
const searchLoading = ref(false)
const activeField = ref<'to' | 'cc' | 'bcc' | null>(null)
let searchDebounce: ReturnType<typeof setTimeout> | null = null

// Saving state
const saving = ref(false)
const draftId = ref<number | null>(null)

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

// Initialize reply data
function initializeReply() {
  if (!props.originalEmail) return

  const orig = props.originalEmail

  // Set subject
  const subjectPrefix = orig.subject.toLowerCase().startsWith('re:') ? '' : 'Re: '
  subject.value = subjectPrefix + orig.subject

  // Set recipients based on Reply vs Reply All
  if (props.replyAll) {
    // Reply All: To = original sender + original To (except me)
    // CC = original CC (except me)
    if (orig.sender && !meContacts.value.some(m => m.id === orig.sender!.id)) {
      toRecipients.value.push({
        id: orig.sender.id,
        email: orig.sender.email,
        name: orig.sender.name,
      })
    }

    for (const r of orig.recipients) {
      if (meContacts.value.some(m => m.id === r.id)) continue

      if (r.role === 'to') {
        if (!toRecipients.value.some(t => t.id === r.id)) {
          toRecipients.value.push({ id: r.id, email: r.email, name: r.name })
        }
      } else if (r.role === 'cc') {
        ccRecipients.value.push({ id: r.id, email: r.email, name: r.name })
        showCc.value = true
      }
    }
  } else {
    // Reply: To = original sender only
    if (orig.sender) {
      toRecipients.value.push({
        id: orig.sender.id,
        email: orig.sender.email,
        name: orig.sender.name,
      })
    }
  }

  // Set quote
  const date = orig.sentAt ? new Date(orig.sentAt).toLocaleString() : ''
  const from = orig.sender ? (orig.sender.name || orig.sender.email) : 'Unknown'
  bodyText.value = `\n\nOn ${date}, ${from} wrote:\n> ${orig.contentText.replace(/\n/g, '\n> ')}`
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

// Save draft
async function saveDraft() {
  if (!selectedFromId.value) return
  if (toRecipients.value.length === 0) return

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
      contentText: bodyText.value,
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

    emit('sent', draftId.value!)
  } catch (e) {
    console.error('Failed to save draft:', e)
  } finally {
    saving.value = false
  }
}

function getRecipientDisplay(r: Recipient): string {
  return r.name || r.email
}

// Initialize on mount
onMounted(async () => {
  await loadMeContacts()
  initializeReply()
})
</script>

<template>
  <div class="email-composer">
    <div class="composer-header">
      <h3>{{ originalEmail ? (replyAll ? 'Reply All' : 'Reply') : 'New Email' }}</h3>
      <button class="close-btn" @click="emit('close')">×</button>
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
      <textarea
        v-model="bodyText"
        class="body-textarea"
        placeholder="Write your message..."
      ></textarea>
    </div>

    <!-- Actions -->
    <div class="composer-actions">
      <button class="save-btn" @click="saveDraft" :disabled="saving || !selectedFromId || toRecipients.length === 0">
        {{ saving ? 'Saving...' : 'Save Draft' }}
      </button>
      <button class="cancel-btn" @click="emit('close')">Cancel</button>
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
  padding: 16px;
  min-height: 200px;
}

.body-textarea {
  width: 100%;
  height: 100%;
  min-height: 200px;
  border: none;
  outline: none;
  font-size: 14px;
  font-family: inherit;
  line-height: 1.6;
  resize: none;
}

.composer-actions {
  display: flex;
  gap: 12px;
  padding: 16px;
  border-top: 1px solid #e5e5e5;
}

.save-btn {
  padding: 10px 24px;
  background: #000;
  color: #fff;
  border: none;
  border-radius: 4px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.save-btn:hover:not(:disabled) {
  opacity: 0.9;
}

.save-btn:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.cancel-btn {
  padding: 10px 24px;
  background: #fff;
  color: #666;
  border: 1px solid #e5e5e5;
  border-radius: 4px;
  font-size: 14px;
  cursor: pointer;
}

.cancel-btn:hover {
  border-color: #999;
  color: #000;
}
</style>
