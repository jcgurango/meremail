<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { searchContacts } from '@/utils/api'

export type FieldType = 'thread_subject' | 'email_subject' | 'sender_name' | 'sender_email' |
  'to_name' | 'to_email' | 'cc_name' | 'cc_email' | 'content' | 'attachment_filename' |
  'sender_in_contacts' | 'header'

export type MatchType = 'exact' | 'contains' | 'regex'

export interface Condition {
  field: string // Can be FieldType or 'header:HeaderName'
  matchType: MatchType
  value: string
  negate?: boolean
}

export interface ConditionGroup {
  operator: 'AND' | 'OR'
  conditions: (Condition | ConditionGroup)[]
}

const props = defineProps<{
  modelValue: ConditionGroup
  depth?: number
}>()

const emit = defineEmits<{
  'update:modelValue': [value: ConditionGroup]
}>()

const depth = computed(() => props.depth ?? 0)

const fieldOptions: { value: string; label: string }[] = [
  { value: 'thread_subject', label: 'Thread Subject' },
  { value: 'email_subject', label: 'Email Subject' },
  { value: 'sender_name', label: 'Sender Name' },
  { value: 'sender_email', label: 'Sender Email' },
  { value: 'sender_in_contacts', label: 'Sender In List' },
  { value: 'to_name', label: 'To Name' },
  { value: 'to_email', label: 'To Email' },
  { value: 'cc_name', label: 'CC Name' },
  { value: 'cc_email', label: 'CC Email' },
  { value: 'content', label: 'Email Content' },
  { value: 'attachment_filename', label: 'Attachment Filename' },
  { value: 'header', label: 'Header' },
]

const matchTypeOptions: { value: MatchType; label: string }[] = [
  { value: 'contains', label: 'contains' },
  { value: 'exact', label: 'equals' },
  { value: 'regex', label: 'matches regex' },
]

// Contact search state (keyed by condition index)
const contactSearches = ref<Record<number, string>>({})
const contactResults = ref<Record<number, { email: string; name: string | null }[]>>({})
const searchTimeouts = ref<Record<number, ReturnType<typeof setTimeout>>>({})

function isConditionGroup(item: Condition | ConditionGroup): item is ConditionGroup {
  return 'operator' in item
}

function getBaseField(field: string): string {
  if (field.startsWith('header:')) return 'header'
  return field
}

function getHeaderName(field: string): string {
  if (field.startsWith('header:')) return field.slice(7)
  return ''
}

function toggleOperator() {
  emit('update:modelValue', {
    ...props.modelValue,
    operator: props.modelValue.operator === 'AND' ? 'OR' : 'AND',
  })
}

function addCondition() {
  const newCondition: Condition = {
    field: 'sender_email',
    matchType: 'contains',
    value: '',
  }
  emit('update:modelValue', {
    ...props.modelValue,
    conditions: [...props.modelValue.conditions, newCondition],
  })
}

function addGroup() {
  const newGroup: ConditionGroup = {
    operator: 'AND',
    conditions: [
      { field: 'sender_email', matchType: 'contains', value: '' },
    ],
  }
  emit('update:modelValue', {
    ...props.modelValue,
    conditions: [...props.modelValue.conditions, newGroup],
  })
}

function updateCondition(index: number, updates: Partial<Condition>) {
  const newConditions = [...props.modelValue.conditions]
  const current = newConditions[index] as Condition

  // Handle field type changes (only when selecting from dropdown, not when editing header name)
  if (updates.field !== undefined && !updates.field.startsWith('header:')) {
    const baseField = updates.field
    if (baseField === 'header') {
      // Default header name when first selecting "Header" from dropdown
      updates.field = 'header:X-Custom-Header'
    } else if (baseField === 'sender_in_contacts') {
      // Reset value to empty array
      updates.value = '[]'
    }
  }

  newConditions[index] = { ...current, ...updates }
  emit('update:modelValue', {
    ...props.modelValue,
    conditions: newConditions,
  })
}

function updateHeaderName(index: number, headerName: string) {
  updateCondition(index, { field: `header:${headerName}` })
}

function updateGroup(index: number, newGroup: ConditionGroup) {
  const newConditions = [...props.modelValue.conditions]
  newConditions[index] = newGroup
  emit('update:modelValue', {
    ...props.modelValue,
    conditions: newConditions,
  })
}

function removeCondition(index: number) {
  const newConditions = props.modelValue.conditions.filter((_, i) => i !== index)
  emit('update:modelValue', {
    ...props.modelValue,
    conditions: newConditions,
  })
}

// Contact list helpers
function parseContactList(value: string): string[] {
  try {
    return JSON.parse(value) || []
  } catch {
    return []
  }
}

function addContactToList(index: number, email: string) {
  const item = props.modelValue.conditions[index] as Condition
  const current = parseContactList(item.value)
  if (!current.includes(email.toLowerCase())) {
    const updated = [...current, email.toLowerCase()]
    updateCondition(index, { value: JSON.stringify(updated) })
  }
  contactSearches.value[index] = ''
  contactResults.value[index] = []
}

function removeContactFromList(index: number, email: string) {
  const item = props.modelValue.conditions[index] as Condition
  const current = parseContactList(item.value)
  const updated = current.filter(e => e !== email)
  updateCondition(index, { value: JSON.stringify(updated) })
}

async function handleContactSearch(index: number, query: string) {
  contactSearches.value[index] = query

  // Clear previous timeout
  if (searchTimeouts.value[index]) {
    clearTimeout(searchTimeouts.value[index])
  }

  if (!query.trim()) {
    contactResults.value[index] = []
    return
  }

  // Debounce search
  searchTimeouts.value[index] = setTimeout(async () => {
    try {
      const result = await searchContacts(query, 10)
      contactResults.value[index] = result.data.contacts.map(c => ({
        email: c.email,
        name: c.name,
      }))
    } catch (e) {
      console.error('Contact search failed:', e)
      contactResults.value[index] = []
    }
  }, 200)
}

function handleContactInputKeydown(index: number, event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault()
    const query = contactSearches.value[index]?.trim()
    if (query && query.includes('@')) {
      // Looks like an email, add it directly
      addContactToList(index, query)
    } else {
      const results = contactResults.value[index]
      if (results && results.length > 0 && results[0]) {
        // Add first result
        addContactToList(index, results[0].email)
      }
    }
  }
}
</script>

<template>
  <div class="condition-builder" :class="{ 'nested': depth > 0 }">
    <div class="group-header">
      <button
        type="button"
        class="operator-toggle"
        :class="modelValue.operator.toLowerCase()"
        @click="toggleOperator"
      >
        {{ modelValue.operator }}
      </button>
      <span class="group-label">of the following conditions match:</span>
    </div>

    <div class="conditions-list">
      <div
        v-for="(item, index) in modelValue.conditions"
        :key="index"
        class="condition-row"
      >
        <template v-if="isConditionGroup(item)">
          <ConditionBuilder
            :model-value="item"
            :depth="depth + 1"
            @update:model-value="updateGroup(index, $event)"
          />
        </template>
        <template v-else>
          <div class="condition-item">
            <!-- Field selector -->
            <select
              :value="getBaseField(item.field)"
              @change="updateCondition(index, { field: ($event.target as HTMLSelectElement).value })"
              class="field-select"
            >
              <option v-for="opt in fieldOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>

            <!-- Header name input (for header: fields) -->
            <input
              v-if="getBaseField(item.field) === 'header'"
              type="text"
              :value="getHeaderName(item.field)"
              @input="updateHeaderName(index, ($event.target as HTMLInputElement).value)"
              class="header-name-input"
              placeholder="Header name..."
            />

            <!-- Negate checkbox -->
            <label class="negate-label">
              <input
                type="checkbox"
                :checked="item.negate"
                @change="updateCondition(index, { negate: ($event.target as HTMLInputElement).checked })"
              />
              NOT
            </label>

            <!-- Match type (not for sender_in_contacts) -->
            <select
              v-if="getBaseField(item.field) !== 'sender_in_contacts'"
              :value="item.matchType"
              @change="updateCondition(index, { matchType: ($event.target as HTMLSelectElement).value as MatchType })"
              class="match-select"
            >
              <option v-for="opt in matchTypeOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>

            <!-- Standard value input -->
            <input
              v-if="getBaseField(item.field) !== 'sender_in_contacts'"
              type="text"
              :value="item.value"
              @input="updateCondition(index, { value: ($event.target as HTMLInputElement).value })"
              class="value-input"
              placeholder="Enter value..."
            />

            <!-- Contact list (for sender_in_contacts) -->
            <div v-if="getBaseField(item.field) === 'sender_in_contacts'" class="contact-list-wrapper">
              <div class="contact-chips">
                <span
                  v-for="email in parseContactList(item.value)"
                  :key="email"
                  class="contact-chip"
                >
                  {{ email }}
                  <button type="button" @click="removeContactFromList(index, email)">&times;</button>
                </span>
              </div>
              <div class="contact-search">
                <input
                  type="text"
                  :value="contactSearches[index] || ''"
                  @input="handleContactSearch(index, ($event.target as HTMLInputElement).value)"
                  @keydown="handleContactInputKeydown(index, $event)"
                  placeholder="Search or type email..."
                  class="contact-search-input"
                />
                <div v-if="contactResults[index]?.length" class="contact-dropdown">
                  <div
                    v-for="contact in contactResults[index]"
                    :key="contact.email"
                    class="contact-option"
                    @click="addContactToList(index, contact.email)"
                  >
                    <span class="contact-name">{{ contact.name || contact.email.split('@')[0] }}</span>
                    <span class="contact-email">{{ contact.email }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>

        <button
          type="button"
          class="remove-btn"
          @click="removeCondition(index)"
          title="Remove"
        >
          &times;
        </button>
      </div>
    </div>

    <div class="group-actions">
      <button type="button" class="add-btn" @click="addCondition">
        + Condition
      </button>
      <button type="button" class="add-btn add-group" @click="addGroup" v-if="depth < 2">
        + Group
      </button>
    </div>
  </div>
</template>

<style scoped>
.condition-builder {
  padding: 16px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}

.condition-builder.nested {
  background: #fff;
  border-style: dashed;
  margin: 8px 0;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.operator-toggle {
  padding: 4px 12px;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.15s;
}

.operator-toggle.and {
  background: #dbeafe;
  color: #1d4ed8;
}

.operator-toggle.and:hover {
  background: #bfdbfe;
}

.operator-toggle.or {
  background: #fef3c7;
  color: #b45309;
}

.operator-toggle.or:hover {
  background: #fde68a;
}

.group-label {
  font-size: 13px;
  color: #6b7280;
}

.conditions-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.condition-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.condition-item {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
}

.field-select,
.match-select {
  padding: 6px 10px;
  font-size: 13px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
}

.field-select:focus,
.match-select:focus {
  outline: none;
  border-color: #6366f1;
}

.header-name-input {
  width: 140px;
  padding: 6px 10px;
  font-size: 13px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-family: monospace;
}

.header-name-input:focus {
  outline: none;
  border-color: #6366f1;
}

.negate-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #6b7280;
  cursor: pointer;
  user-select: none;
}

.negate-label input {
  cursor: pointer;
}

.value-input {
  flex: 1;
  min-width: 150px;
  padding: 6px 10px;
  font-size: 13px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
}

.value-input:focus {
  outline: none;
  border-color: #6366f1;
}

/* Contact list styles */
.contact-list-wrapper {
  flex: 1;
  min-width: 200px;
}

.contact-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
}

.contact-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: #e0e7ff;
  color: #3730a3;
  border-radius: 12px;
  font-size: 12px;
}

.contact-chip button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  padding: 0;
  border: none;
  background: transparent;
  color: #6366f1;
  font-size: 14px;
  cursor: pointer;
  border-radius: 50%;
}

.contact-chip button:hover {
  background: #c7d2fe;
}

.contact-search {
  position: relative;
}

.contact-search-input {
  width: 100%;
  padding: 6px 10px;
  font-size: 13px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
}

.contact-search-input:focus {
  outline: none;
  border-color: #6366f1;
}

.contact-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: #fff;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  z-index: 10;
  max-height: 200px;
  overflow-y: auto;
}

.contact-option {
  padding: 8px 12px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
}

.contact-option:hover {
  background: #f3f4f6;
}

.contact-name {
  font-size: 13px;
  font-weight: 500;
}

.contact-email {
  font-size: 12px;
  color: #6b7280;
}

.remove-btn {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: #fee2e2;
  color: #dc2626;
  border-radius: 4px;
  font-size: 18px;
  cursor: pointer;
  transition: background-color 0.15s;
}

.remove-btn:hover {
  background: #fecaca;
}

.group-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.add-btn {
  padding: 6px 12px;
  font-size: 13px;
  border: 1px dashed #d1d5db;
  background: transparent;
  color: #6b7280;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
}

.add-btn:hover {
  border-color: #6366f1;
  color: #6366f1;
}

.add-btn.add-group {
  border-style: dashed;
}

@media (max-width: 600px) {
  .condition-item {
    flex-direction: column;
    align-items: stretch;
  }

  .field-select,
  .match-select,
  .value-input,
  .header-name-input {
    width: 100%;
  }

  .negate-label {
    align-self: flex-start;
  }
}
</style>
