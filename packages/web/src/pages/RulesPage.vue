<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { RouterLink } from 'vue-router'
import RuleEditor, { type RuleData, type ActionType } from '@/components/RuleEditor.vue'
import {
  getRules,
  createRule,
  updateRule,
  deleteRule,
  reorderRules,
  applyRule,
  getRuleApplications,
  type Rule,
  type RuleApplicationWithName,
} from '@/utils/api'

let pollInterval: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  document.title = 'Rules - MereMail'
  loadRules()
  loadApplications()
  // Poll for application updates every 2 seconds
  pollInterval = setInterval(() => {
    if (applications.value.some(a => a.status === 'running' || a.status === 'pending')) {
      loadApplications()
    }
  }, 2000)
})

onUnmounted(() => {
  if (pollInterval) {
    clearInterval(pollInterval)
  }
})

const rules = ref<Rule[]>([])
const applications = ref<RuleApplicationWithName[]>([])
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

async function loadApplications() {
  try {
    const response = await getRuleApplications()
    applications.value = response.applications
  } catch (e) {
    console.error('Failed to load applications:', e)
  }
}

function openEditor(rule?: Rule) {
  if (rule) {
    editingRule.value = {
      id: rule.id,
      name: rule.name,
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
        conditions: ruleData.conditions,
        actionType: ruleData.actionType,
        actionConfig: ruleData.actionConfig,
        enabled: ruleData.enabled,
      })
    } else {
      await createRule({
        name: ruleData.name,
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

async function toggleEnabled(rule: Rule) {
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

async function handleApply(rule: Rule) {
  if (!confirm(`Apply rule "${rule.name}" to all existing emails? This may take a while.`)) return

  try {
    await applyRule(rule.id)
    // Immediately refresh applications list to show the new job
    await loadApplications()
  } catch (e) {
    console.error('Failed to apply rule:', e)
    alert('Failed to start rule application')
  }
}

function formatAppTime(app: RuleApplicationWithName): string {
  if (app.status === 'running' || app.status === 'pending') {
    if (app.startedAt) {
      const started = new Date(app.startedAt)
      const elapsed = Math.floor((Date.now() - started.getTime()) / 1000)
      if (elapsed < 60) return `Started ${elapsed}s ago`
      return `Started ${Math.floor(elapsed / 60)}m ago`
    }
    return 'Starting...'
  }
  if (app.completedAt) {
    const completed = new Date(app.completedAt)
    const ago = Math.floor((Date.now() - completed.getTime()) / 1000)
    if (ago < 60) return `${ago}s ago`
    if (ago < 3600) return `${Math.floor(ago / 60)}m ago`
    if (ago < 86400) return `${Math.floor(ago / 3600)}h ago`
    return completed.toLocaleDateString()
  }
  return ''
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
          <div class="rule-summary">{{ rule.name }}</div>
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
            title="Apply to existing emails"
          >
            Apply
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

    <!-- Applications Section -->
    <div v-if="applications.length > 0" class="applications-section">
      <h2>Recent Applications</h2>
      <div class="applications-list">
        <div
          v-for="app in applications"
          :key="app.id"
          class="application-card"
          :class="app.status"
        >
          <div class="app-info">
            <span class="app-rule">{{ app.ruleName || `Rule #${app.ruleId}` }}</span>
            <span class="app-status" :class="app.status">{{ app.status }}</span>
          </div>
          <div class="app-progress">
            <template v-if="app.status === 'running' || app.status === 'pending'">
              <div class="progress-bar">
                <div
                  class="progress-fill"
                  :style="{ width: `${app.totalCount > 0 ? (app.processedCount / app.totalCount) * 100 : 0}%` }"
                ></div>
              </div>
              <span class="progress-text">
                {{ app.processedCount }} / {{ app.totalCount }} ({{ app.matchedCount }} matched)
              </span>
            </template>
            <template v-else-if="app.status === 'completed'">
              <span class="result-text">
                {{ app.matchedCount }} matches out of {{ app.totalCount }} threads
              </span>
            </template>
            <template v-else-if="app.status === 'failed'">
              <span class="error-text">{{ app.error || 'Unknown error' }}</span>
            </template>
          </div>
          <div class="app-time">
            {{ formatAppTime(app) }}
          </div>
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

.rule-summary {
  font-size: 14px;
  color: #374151;
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

/* Applications Section */
.applications-section {
  margin-top: 40px;
  padding-top: 24px;
  border-top: 1px solid #e5e7eb;
}

.applications-section h2 {
  font-size: 18px;
  font-weight: 600;
  color: #374151;
  margin: 0 0 16px 0;
}

.applications-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.application-card {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
}

.application-card.running,
.application-card.pending {
  background: #eff6ff;
  border-color: #bfdbfe;
}

.application-card.failed {
  background: #fef2f2;
  border-color: #fecaca;
}

.app-info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 200px;
}

.app-rule {
  font-weight: 500;
  color: #374151;
}

.app-status {
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
}

.app-status.running,
.app-status.pending {
  background: #3b82f6;
  color: #fff;
}

.app-status.completed {
  background: #10b981;
  color: #fff;
}

.app-status.failed {
  background: #ef4444;
  color: #fff;
}

.app-progress {
  flex: 1;
  min-width: 200px;
}

.progress-bar {
  height: 6px;
  background: #e5e7eb;
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 4px;
}

.progress-fill {
  height: 100%;
  background: #3b82f6;
  transition: width 0.3s;
}

.progress-text {
  font-size: 12px;
  color: #6b7280;
}

.result-text {
  font-size: 13px;
  color: #059669;
}

.error-text {
  font-size: 13px;
  color: #dc2626;
}

.app-time {
  font-size: 12px;
  color: #9ca3af;
  min-width: 80px;
  text-align: right;
}

@media (max-width: 600px) {
  .application-card {
    flex-direction: column;
    align-items: stretch;
  }

  .app-info {
    min-width: auto;
  }

  .app-progress {
    min-width: auto;
  }

  .app-time {
    text-align: left;
  }
}
</style>
