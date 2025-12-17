<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import RuleEditor, { type RuleData, type ActionType } from '@/components/RuleEditor.vue'
import {
  getRules,
  createRule,
  updateRule,
  deleteRule,
  reorderRules,
  applyRule,
  getRuleApplication,
  type Rule,
} from '@/utils/api'

onMounted(() => {
  document.title = 'Rules - MereMail'
  loadRules()
})

interface RuleWithApplication extends Rule {
  applying?: boolean
  applicationProgress?: { processed: number; total: number; matched: number }
}

const rules = ref<RuleWithApplication[]>([])
const loading = ref(false)
const editorOpen = ref(false)
const editingRule = ref<RuleData | null>(null)
const error = ref('')

async function loadRules() {
  loading.value = true
  error.value = ''
  try {
    const response = await getRules()
    rules.value = response.rules
  } catch (e) {
    error.value = 'Failed to load rules'
    console.error(e)
  } finally {
    loading.value = false
  }
}

function openEditor(rule?: Rule) {
  if (rule) {
    editingRule.value = {
      id: rule.id,
      name: rule.name,
      description: rule.description || undefined,
      conditions: rule.conditions as unknown as RuleData['conditions'],
      actionType: rule.actionType as ActionType,
      actionConfig: rule.actionConfig || undefined,
      enabled: rule.enabled,
    }
  } else {
    editingRule.value = null
  }
  editorOpen.value = true
}

function closeEditor() {
  editorOpen.value = false
  editingRule.value = null
}

async function handleSave(ruleData: RuleData) {
  try {
    if (ruleData.id) {
      await updateRule(ruleData.id, {
        name: ruleData.name,
        description: ruleData.description,
        conditions: ruleData.conditions,
        actionType: ruleData.actionType,
        actionConfig: ruleData.actionConfig,
        enabled: ruleData.enabled,
      })
    } else {
      await createRule({
        name: ruleData.name,
        description: ruleData.description,
        conditions: ruleData.conditions,
        actionType: ruleData.actionType,
        actionConfig: ruleData.actionConfig,
        enabled: ruleData.enabled,
      })
    }
    closeEditor()
    await loadRules()
  } catch (e) {
    console.error('Failed to save rule:', e)
    alert('Failed to save rule')
  }
}

async function toggleEnabled(rule: RuleWithApplication) {
  try {
    await updateRule(rule.id, { enabled: !rule.enabled })
    rule.enabled = !rule.enabled
  } catch (e) {
    console.error('Failed to toggle rule:', e)
  }
}

async function handleDelete(rule: Rule) {
  if (!confirm(`Delete rule "${rule.name}"? This cannot be undone.`)) return

  try {
    await deleteRule(rule.id)
    await loadRules()
  } catch (e) {
    console.error('Failed to delete rule:', e)
    alert('Failed to delete rule')
  }
}

async function moveRule(rule: Rule, direction: 'up' | 'down') {
  const index = rules.value.findIndex(r => r.id === rule.id)
  if (index === -1) return

  const newIndex = direction === 'up' ? index - 1 : index + 1
  if (newIndex < 0 || newIndex >= rules.value.length) return

  const newRules = [...rules.value]
  const temp = newRules[index]!
  newRules[index] = newRules[newIndex]!
  newRules[newIndex] = temp

  rules.value = newRules

  const positions = newRules.map((r, i) => ({ id: r.id, position: i }))
  try {
    await reorderRules(positions)
  } catch (e) {
    console.error('Failed to reorder rules:', e)
    await loadRules()
  }
}

async function handleApply(rule: RuleWithApplication) {
  if (rule.applying) return

  if (!confirm(`Apply rule "${rule.name}" to all existing emails? This may take a while.`)) return

  rule.applying = true
  rule.applicationProgress = undefined

  try {
    const response = await applyRule(rule.id)
    const applicationId = response.application.id

    const pollStatus = async () => {
      const statusResponse = await getRuleApplication(applicationId)
      const status = statusResponse.application

      rule.applicationProgress = {
        processed: status.processedCount,
        total: status.totalCount,
        matched: status.matchedCount,
      }

      if (status.status === 'running' || status.status === 'pending') {
        setTimeout(pollStatus, 1000)
      } else {
        rule.applying = false
        if (status.status === 'completed') {
          alert(`Rule applied: ${status.matchedCount} matches out of ${status.totalCount} threads`)
        } else if (status.status === 'failed') {
          alert(`Rule application failed: ${status.error || 'Unknown error'}`)
        }
      }
    }

    await pollStatus()
  } catch (e) {
    rule.applying = false
    console.error('Failed to apply rule:', e)
    alert('Failed to start rule application')
  }
}

function getActionLabel(actionType: string): string {
  const labels: Record<string, string> = {
    delete_thread: 'Delete Thread',
    delete_email: 'Delete Email',
    move_to_folder: 'Move to Folder',
    mark_read: 'Mark Read',
    add_to_reply_later: 'Reply Later',
    add_to_set_aside: 'Set Aside',
  }
  return labels[actionType] || actionType
}
</script>

<template>
  <div class="rules-page">
    <header class="page-header">
      <RouterLink to="/" class="back-link">&larr; Inbox</RouterLink>
      <h1>Email Rules</h1>
      <p class="subtitle">Automatically organize incoming emails. Rules are applied in order - first match wins.</p>
    </header>

    <div class="actions-bar">
      <button class="btn btn-primary" @click="openEditor()">
        + Create Rule
      </button>
    </div>

    <div v-if="loading && rules.length === 0" class="loading-state">
      Loading rules...
    </div>

    <div v-else-if="error" class="error-state">
      {{ error }}
      <button @click="loadRules">Retry</button>
    </div>

    <div v-else-if="rules.length === 0" class="empty-state">
      <p>No rules yet</p>
      <p class="hint">Create a rule to automatically organize incoming emails</p>
    </div>

    <div v-else class="rules-list">
      <div
        v-for="(rule, index) in rules"
        :key="rule.id"
        class="rule-card"
        :class="{ disabled: !rule.enabled }"
      >
        <div class="rule-order">
          <button
            class="order-btn"
            :disabled="index === 0"
            @click="moveRule(rule, 'up')"
            title="Move up"
          >
            &uarr;
          </button>
          <span class="order-num">{{ index + 1 }}</span>
          <button
            class="order-btn"
            :disabled="index === rules.length - 1"
            @click="moveRule(rule, 'down')"
            title="Move down"
          >
            &darr;
          </button>
        </div>

        <div class="rule-info">
          <div class="rule-name">{{ rule.name }}</div>
          <div v-if="rule.description" class="rule-description">{{ rule.description }}</div>
          <div class="rule-meta">
            <span class="action-badge" :class="rule.actionType">
              {{ getActionLabel(rule.actionType) }}
            </span>
            <span class="condition-count">
              {{ rule.conditions.conditions.length }} condition{{ rule.conditions.conditions.length !== 1 ? 's' : '' }}
            </span>
          </div>
        </div>

        <div class="rule-actions">
          <label class="toggle-label">
            <input
              type="checkbox"
              :checked="rule.enabled"
              @change="toggleEnabled(rule)"
            />
            <span class="toggle-slider"></span>
          </label>

          <button
            class="action-btn apply"
            @click="handleApply(rule)"
            :disabled="rule.applying"
            title="Apply to existing emails"
          >
            <template v-if="rule.applying && rule.applicationProgress">
              {{ rule.applicationProgress.processed }}/{{ rule.applicationProgress.total }}
            </template>
            <template v-else-if="rule.applying">
              ...
            </template>
            <template v-else>
              Apply
            </template>
          </button>

          <button
            class="action-btn edit"
            @click="openEditor(rule)"
            title="Edit rule"
          >
            Edit
          </button>

          <button
            class="action-btn delete"
            @click="handleDelete(rule)"
            title="Delete rule"
          >
            Delete
          </button>
        </div>
      </div>
    </div>

    <RuleEditor
      :open="editorOpen"
      :rule="editingRule"
      @close="closeEditor"
      @save="handleSave"
    />
  </div>
</template>

<style scoped>
.rules-page {
  max-width: 900px;
  margin: 0 auto;
  padding: 20px;
  padding-bottom: 120px;
}

.page-header {
  margin-bottom: 24px;
}

.back-link {
  display: inline-block;
  color: #666;
  text-decoration: none;
  font-size: 14px;
  margin-bottom: 8px;
}

.back-link:hover {
  color: #000;
}

h1 {
  font-size: 24px;
  font-weight: 600;
  margin: 0 0 8px 0;
}

.subtitle {
  font-size: 14px;
  color: #6b7280;
  margin: 0;
}

.actions-bar {
  margin-bottom: 20px;
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

.btn-primary {
  background: #6366f1;
  color: #fff;
}

.btn-primary:hover {
  background: #4f46e5;
}

.loading-state,
.empty-state,
.error-state {
  text-align: center;
  padding: 60px 20px;
  color: #6b7280;
}

.empty-state .hint {
  font-size: 14px;
  margin-top: 8px;
}

.error-state button {
  margin-top: 16px;
  padding: 8px 16px;
  background: #f3f4f6;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.rules-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.rule-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  transition: opacity 0.15s;
}

.rule-card.disabled {
  opacity: 0.6;
}

.rule-order {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.order-btn {
  padding: 4px 8px;
  border: none;
  background: #f3f4f6;
  color: #6b7280;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.15s;
}

.order-btn:hover:not(:disabled) {
  background: #e5e7eb;
  color: #374151;
}

.order-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.order-num {
  font-size: 12px;
  font-weight: 600;
  color: #9ca3af;
}

.rule-info {
  flex: 1;
  min-width: 0;
}

.rule-name {
  font-weight: 500;
  font-size: 15px;
  margin-bottom: 2px;
}

.rule-description {
  font-size: 13px;
  color: #6b7280;
  margin-bottom: 6px;
}

.rule-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
}

.action-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 500;
}

.action-badge.delete_thread,
.action-badge.delete_email {
  background: #fee2e2;
  color: #dc2626;
}

.action-badge.move_to_folder {
  background: #dbeafe;
  color: #1d4ed8;
}

.action-badge.mark_read {
  background: #d1fae5;
  color: #059669;
}

.action-badge.add_to_reply_later,
.action-badge.add_to_set_aside {
  background: #fef3c7;
  color: #b45309;
}

.condition-count {
  color: #9ca3af;
}

.rule-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toggle-label {
  position: relative;
  display: inline-block;
  width: 40px;
  height: 22px;
  cursor: pointer;
}

.toggle-label input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  inset: 0;
  background: #d1d5db;
  border-radius: 22px;
  transition: background-color 0.2s;
}

.toggle-slider::before {
  content: '';
  position: absolute;
  width: 18px;
  height: 18px;
  left: 2px;
  bottom: 2px;
  background: #fff;
  border-radius: 50%;
  transition: transform 0.2s;
}

.toggle-label input:checked + .toggle-slider {
  background: #6366f1;
}

.toggle-label input:checked + .toggle-slider::before {
  transform: translateX(18px);
}

.action-btn {
  padding: 6px 12px;
  font-size: 13px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
}

.action-btn.apply {
  background: #dbeafe;
  color: #1d4ed8;
  min-width: 60px;
}

.action-btn.apply:hover:not(:disabled) {
  background: #bfdbfe;
}

.action-btn.apply:disabled {
  opacity: 0.7;
  cursor: default;
}

.action-btn.edit {
  background: #f3f4f6;
  color: #374151;
}

.action-btn.edit:hover {
  background: #e5e7eb;
}

.action-btn.delete {
  background: #fee2e2;
  color: #dc2626;
}

.action-btn.delete:hover {
  background: #fecaca;
}

@media (max-width: 600px) {
  .rule-card {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }

  .rule-order {
    flex-direction: row;
    justify-content: center;
  }

  .rule-actions {
    flex-wrap: wrap;
    justify-content: flex-end;
  }
}
</style>
