<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import ConditionBuilder, { type ConditionGroup, type Condition } from './ConditionBuilder.vue'
import { getFolders, previewRule, type Folder, type RulePreviewMatch } from '@/utils/api'

export type ActionType = 'delete_thread' | 'delete_email' | 'move_to_folder' | 'mark_read' |
  'add_to_reply_later' | 'add_to_set_aside'

export interface ActionConfig {
  folderId?: number
}

export interface RuleData {
  id?: number
  name: string
  conditions: ConditionGroup
  actionType: ActionType
  actionConfig?: ActionConfig
  enabled: boolean
}

const props = defineProps<{
  open: boolean
  rule?: RuleData | null
}>()

const emit = defineEmits<{
  close: []
  save: [rule: RuleData]
}>()

const defaultConditions: ConditionGroup = {
  operator: 'AND',
  conditions: [
    { field: 'sender_email', matchType: 'contains', value: '' },
  ],
}

const conditions = ref<ConditionGroup>({ ...defaultConditions })
const actionType = ref<ActionType>('move_to_folder')
const actionFolderId = ref<number | null>(null)
const enabled = ref(true)
const folders = ref<Folder[]>([])
const saving = ref(false)

// Preview state
const previewing = ref(false)
const previewResults = ref<RulePreviewMatch[] | null>(null)
const previewScanned = ref(0)
const previewError = ref('')

const actionOptions: { value: ActionType; label: string; shortLabel: string }[] = [
  { value: 'move_to_folder', label: 'Move to Folder', shortLabel: 'Move' },
  { value: 'delete_thread', label: 'Delete Thread', shortLabel: 'Delete' },
  { value: 'delete_email', label: 'Delete Email', shortLabel: 'Delete email' },
  { value: 'mark_read', label: 'Mark as Read', shortLabel: 'Mark read' },
  { value: 'add_to_reply_later', label: 'Add to Reply Later', shortLabel: 'Reply Later' },
  { value: 'add_to_set_aside', label: 'Add to Set Aside', shortLabel: 'Set Aside' },
]

const needsFolderSelection = computed(() => actionType.value === 'move_to_folder')

const nonSystemFolders = computed(() => folders.value.filter(f => !f.isSystem))

const isValid = computed(() => {
  if (needsFolderSelection.value && !actionFolderId.value) return false
  if (conditions.value.conditions.length === 0) return false
  // Check at least one condition has a value
  const hasValidCondition = conditions.value.conditions.some(c => {
    if ('operator' in c) return true // groups count
    return c.value.trim() !== ''
  })
  return hasValidCondition
})

// Field labels for summary
const fieldLabels: Record<string, string> = {
  thread_subject: 'subject',
  email_subject: 'subject',
  sender_name: 'sender',
  sender_email: 'sender',
  sender_in_contacts: 'sender',
  to_name: 'to',
  to_email: 'to',
  cc_name: 'cc',
  cc_email: 'cc',
  content: 'content',
  attachment_filename: 'attachment',
}

function getFieldLabel(field: string): string {
  if (field.startsWith('header:')) {
    return field.slice(7)
  }
  return fieldLabels[field] || field
}

function generateSummary(): string {
  const parts: string[] = []

  // Collect condition field names (max 3)
  const collectFields = (group: ConditionGroup): string[] => {
    const fields: string[] = []
    for (const item of group.conditions) {
      if ('operator' in item) {
        fields.push(...collectFields(item))
      } else {
        const label = getFieldLabel(item.field)
        if (!fields.includes(label)) {
          fields.push(label)
        }
      }
      if (fields.length >= 3) break
    }
    return fields
  }

  const fields = collectFields(conditions.value)
  if (fields.length > 0) {
    parts.push(fields.slice(0, 3).join(', '))
    if (fields.length < countConditions(conditions.value)) {
      parts[0] += '...'
    }
  }

  // Add action
  const action = actionOptions.find(o => o.value === actionType.value)
  let actionLabel = action?.shortLabel || actionType.value
  if (actionType.value === 'move_to_folder' && actionFolderId.value) {
    const folder = folders.value.find(f => f.id === actionFolderId.value)
    if (folder) {
      actionLabel = `→ ${folder.name}`
    }
  } else {
    actionLabel = `→ ${actionLabel}`
  }
  parts.push(actionLabel)

  return parts.join(' ')
}

function countConditions(group: ConditionGroup): number {
  let count = 0
  for (const item of group.conditions) {
    if ('operator' in item) {
      count += countConditions(item)
    } else {
      count++
    }
  }
  return count
}

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    // Clear preview when opening
    clearPreview()
    if (props.rule) {
      conditions.value = JSON.parse(JSON.stringify(props.rule.conditions))
      actionType.value = props.rule.actionType
      actionFolderId.value = props.rule.actionConfig?.folderId || null
      enabled.value = props.rule.enabled
    } else {
      conditions.value = JSON.parse(JSON.stringify(defaultConditions))
      actionType.value = 'move_to_folder'
      actionFolderId.value = null
      enabled.value = true
    }
  }
})

// Clear preview when conditions change
watch(conditions, () => {
  clearPreview()
}, { deep: true })

onMounted(async () => {
  try {
    const response = await getFolders()
    folders.value = response.data.folders
  } catch (e) {
    console.error('Failed to load folders:', e)
  }
})

function handleClose() {
  emit('close')
}

async function handleSave() {
  if (!isValid.value || saving.value) return
  saving.value = true

  try {
    const ruleData: RuleData = {
      id: props.rule?.id,
      name: generateSummary(),
      conditions: conditions.value,
      actionType: actionType.value,
      actionConfig: needsFolderSelection.value && actionFolderId.value
        ? { folderId: actionFolderId.value }
        : undefined,
      enabled: enabled.value,
    }
    emit('save', ruleData)
  } finally {
    saving.value = false
  }
}

async function handlePreview() {
  if (!isValid.value || previewing.value) return
  previewing.value = true
  previewError.value = ''
  previewResults.value = null

  try {
    const result = await previewRule(conditions.value)
    previewResults.value = result.matches
    previewScanned.value = result.scannedCount
  } catch (e) {
    previewError.value = 'Failed to preview rule'
    console.error('Preview error:', e)
  } finally {
    previewing.value = false
  }
}

function clearPreview() {
  previewResults.value = null
  previewScanned.value = 0
  previewError.value = ''
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-overlay" @click.self="handleClose">
      <div class="modal-content">
        <div class="modal-header">
          <h2>{{ rule?.id ? 'Edit Rule' : 'Create Rule' }}</h2>
          <button type="button" class="close-btn" @click="handleClose">&times;</button>
        </div>

        <form @submit.prevent="handleSave" class="modal-body">
          <div class="form-group">
            <label>When</label>
            <ConditionBuilder v-model="conditions" />
          </div>

          <div class="form-group">
            <label for="rule-action">Then</label>
            <select id="rule-action" v-model="actionType">
              <option v-for="opt in actionOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </div>

          <div v-if="needsFolderSelection" class="form-group">
            <label for="rule-folder">To folder</label>
            <select id="rule-folder" v-model="actionFolderId" required>
              <option :value="null" disabled>Select a folder...</option>
              <option v-for="folder in nonSystemFolders" :key="folder.id" :value="folder.id">
                {{ folder.name }}
              </option>
            </select>
            <p v-if="nonSystemFolders.length === 0" class="hint">
              No custom folders available. Create a folder first.
            </p>
          </div>

          <div class="form-group checkbox-group">
            <label class="checkbox-label">
              <input type="checkbox" v-model="enabled" />
              <span>Rule is enabled</span>
            </label>
          </div>

          <!-- Preview section -->
          <div class="preview-section">
            <button
              type="button"
              class="btn btn-preview"
              :disabled="!isValid || previewing"
              @click="handlePreview"
            >
              {{ previewing ? 'Scanning...' : 'Preview matches' }}
            </button>

            <div v-if="previewError" class="preview-error">
              {{ previewError }}
            </div>

            <div v-if="previewResults !== null" class="preview-results">
              <div class="preview-summary">
                Found {{ previewResults.length }} match{{ previewResults.length !== 1 ? 'es' : '' }}
                <span class="preview-scanned">(scanned {{ previewScanned }} emails)</span>
              </div>

              <div v-if="previewResults.length > 0" class="preview-list">
                <a
                  v-for="match in previewResults"
                  :key="match.id"
                  :href="`/thread/${match.threadId || match.id}`"
                  target="_blank"
                  class="preview-item"
                >
                  <div class="preview-sender">
                    {{ match.senderName || match.senderEmail }}
                  </div>
                  <div class="preview-subject">{{ match.subject }}</div>
                  <div class="preview-date">{{ formatDate(match.sentAt) }}</div>
                </a>
              </div>

              <div v-else class="preview-empty">
                No emails match these conditions.
              </div>
            </div>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" @click="handleClose">
              Cancel
            </button>
            <button
              type="submit"
              class="btn btn-primary"
              :disabled="!isValid || saving"
            >
              {{ saving ? 'Saving...' : (rule?.id ? 'Save' : 'Create') }}
            </button>
          </div>
        </form>
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
  padding: 40px 20px;
  overflow-y: auto;
  z-index: 1000;
}

.modal-content {
  width: 100%;
  max-width: 700px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.2);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid #e5e7eb;
}

.modal-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.close-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: #f3f4f6;
  border-radius: 6px;
  font-size: 20px;
  color: #6b7280;
  cursor: pointer;
  transition: all 0.15s;
}

.close-btn:hover {
  background: #e5e7eb;
  color: #374151;
}

.modal-body {
  padding: 24px;
  max-height: calc(100vh - 200px);
  overflow-y: auto;
}

.form-group {
  margin-bottom: 20px;
}

.form-group label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: #374151;
  margin-bottom: 6px;
}

.form-group select {
  width: 100%;
  padding: 10px 12px;
  font-size: 14px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
}

.form-group select:focus {
  outline: none;
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
}

.hint {
  margin-top: 6px;
  font-size: 13px;
  color: #f59e0b;
}

.checkbox-group {
  margin-top: 24px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-weight: normal;
}

.checkbox-label input {
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid #e5e7eb;
}

.btn {
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 500;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-secondary {
  background: #f3f4f6;
  color: #374151;
}

.btn-secondary:hover {
  background: #e5e7eb;
}

.btn-primary {
  background: #6366f1;
  color: #fff;
}

.btn-primary:hover:not(:disabled) {
  background: #4f46e5;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Preview section */
.preview-section {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid #e5e7eb;
}

.btn-preview {
  background: #f3f4f6;
  color: #374151;
  width: 100%;
}

.btn-preview:hover:not(:disabled) {
  background: #e5e7eb;
}

.btn-preview:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.preview-error {
  margin-top: 12px;
  padding: 10px 12px;
  background: #fee2e2;
  color: #dc2626;
  border-radius: 6px;
  font-size: 13px;
}

.preview-results {
  margin-top: 12px;
}

.preview-summary {
  font-size: 14px;
  font-weight: 500;
  color: #374151;
  margin-bottom: 8px;
}

.preview-scanned {
  font-weight: normal;
  color: #9ca3af;
}

.preview-list {
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
}

.preview-item {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  gap: 2px 12px;
  padding: 10px 12px;
  border-bottom: 1px solid #f3f4f6;
  text-decoration: none;
  color: inherit;
  cursor: pointer;
  transition: background-color 0.15s;
}

.preview-item:hover {
  background: #f9fafb;
}

.preview-item:last-child {
  border-bottom: none;
}

.preview-sender {
  font-size: 13px;
  font-weight: 500;
  color: #374151;
  grid-column: 1;
  grid-row: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.preview-date {
  font-size: 12px;
  color: #9ca3af;
  grid-column: 2;
  grid-row: 1;
  white-space: nowrap;
}

.preview-subject {
  font-size: 13px;
  color: #6b7280;
  grid-column: 1 / -1;
  grid-row: 2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.preview-empty {
  padding: 20px;
  text-align: center;
  color: #9ca3af;
  font-size: 13px;
}

@media (max-width: 600px) {
  .modal-overlay {
    padding: 20px 12px;
  }

  .modal-header {
    padding: 16px;
  }

  .modal-body {
    padding: 16px;
  }

  .modal-footer {
    flex-direction: column;
  }

  .btn {
    width: 100%;
  }
}
</style>
