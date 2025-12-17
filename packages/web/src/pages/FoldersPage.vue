<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { RouterLink } from 'vue-router'
import {
  getFolders,
  createFolder,
  updateFolder,
  deleteFolder,
  reorderFolders,
  type Folder,
} from '@/utils/api'

onMounted(() => {
  document.title = 'Folders - MereMail'
  loadFolders()
})

const folders = ref<Folder[]>([])
const loading = ref(false)
const error = ref('')

const showCreateModal = ref(false)
const showEditModal = ref(false)
const showDeleteModal = ref(false)
const showSettingsModal = ref(false)
const editingFolder = ref<Folder | null>(null)
const newFolderName = ref('')
const editFolderName = ref('')
const saving = ref(false)

// Settings form state
const settingsNotifications = ref(false)
const settingsUnreadCount = ref(true)
const settingsSyncOffline = ref(true)

const systemFolders = computed(() => folders.value.filter(f => f.isSystem))
const customFolders = computed(() => folders.value.filter(f => !f.isSystem))

async function loadFolders() {
  loading.value = true
  error.value = ''
  try {
    const response = await getFolders()
    folders.value = response.data.folders
  } catch (e) {
    error.value = 'Failed to load folders'
    console.error(e)
  } finally {
    loading.value = false
  }
}

function openCreateModal() {
  newFolderName.value = ''
  showCreateModal.value = true
}

function openEditModal(folder: Folder) {
  editingFolder.value = folder
  editFolderName.value = folder.name
  showEditModal.value = true
}

function openDeleteModal(folder: Folder) {
  editingFolder.value = folder
  showDeleteModal.value = true
}

function openSettingsModal(folder: Folder) {
  editingFolder.value = folder
  settingsNotifications.value = folder.notificationsEnabled
  settingsUnreadCount.value = folder.showUnreadCount
  settingsSyncOffline.value = folder.syncOffline
  showSettingsModal.value = true
}

function closeModals() {
  showCreateModal.value = false
  showEditModal.value = false
  showDeleteModal.value = false
  showSettingsModal.value = false
  editingFolder.value = null
}

async function handleCreate() {
  if (!newFolderName.value.trim() || saving.value) return
  saving.value = true

  try {
    await createFolder(newFolderName.value.trim())
    closeModals()
    await loadFolders()
  } catch (e) {
    console.error('Failed to create folder:', e)
    alert('Failed to create folder')
  } finally {
    saving.value = false
  }
}

async function handleEdit() {
  if (!editingFolder.value || !editFolderName.value.trim() || saving.value) return
  saving.value = true

  try {
    await updateFolder(editingFolder.value.id, { name: editFolderName.value.trim() })
    closeModals()
    await loadFolders()
  } catch (e) {
    console.error('Failed to update folder:', e)
    alert('Failed to update folder')
  } finally {
    saving.value = false
  }
}

async function handleSettings() {
  if (!editingFolder.value || saving.value) return
  saving.value = true

  try {
    await updateFolder(editingFolder.value.id, {
      notificationsEnabled: settingsNotifications.value,
      showUnreadCount: settingsUnreadCount.value,
      syncOffline: settingsSyncOffline.value,
    })
    closeModals()
    await loadFolders()
  } catch (e) {
    console.error('Failed to update folder settings:', e)
    alert('Failed to update folder settings')
  } finally {
    saving.value = false
  }
}

async function handleDelete() {
  if (!editingFolder.value || saving.value) return
  saving.value = true

  try {
    await deleteFolder(editingFolder.value.id)
    closeModals()
    await loadFolders()
  } catch (e) {
    console.error('Failed to delete folder:', e)
    alert('Failed to delete folder')
  } finally {
    saving.value = false
  }
}

async function moveFolder(folder: Folder, direction: 'up' | 'down') {
  const allFolders = [...folders.value]
  const index = allFolders.findIndex(f => f.id === folder.id)
  if (index === -1) return

  const newIndex = direction === 'up' ? index - 1 : index + 1
  if (newIndex < 0 || newIndex >= allFolders.length) return

  const temp = allFolders[index]!
  allFolders[index] = allFolders[newIndex]!
  allFolders[newIndex] = temp

  folders.value = allFolders

  const positions = allFolders.map((f, i) => ({ id: f.id, position: i }))
  try {
    await reorderFolders(positions)
  } catch (e) {
    console.error('Failed to reorder folders:', e)
    await loadFolders()
  }
}
</script>

<template>
  <div class="folders-page">
    <header class="page-header">
      <RouterLink to="/" class="back-link">&larr; Inbox</RouterLink>
      <h1>Folders</h1>
      <p class="subtitle">Organize your emails into folders</p>
    </header>

    <div class="actions-bar">
      <button class="btn btn-primary" @click="openCreateModal">
        + Create Folder
      </button>
    </div>

    <div v-if="loading && folders.length === 0" class="loading-state">
      Loading folders...
    </div>

    <div v-else-if="error" class="error-state">
      {{ error }}
      <button @click="loadFolders">Retry</button>
    </div>

    <template v-else>
      <section v-if="systemFolders.length > 0" class="folder-section">
        <h2>System Folders</h2>
        <div class="folders-list">
          <div
            v-for="folder in systemFolders"
            :key="folder.id"
            class="folder-card system"
          >
            <div class="folder-icon">
              <span v-if="folder.name === 'Inbox'">&#128229;</span>
              <span v-else-if="folder.name === 'Junk'">&#128465;</span>
              <span v-else-if="folder.name === 'Trash'">&#128465;</span>
              <span v-else>&#128193;</span>
            </div>
            <div class="folder-info">
              <div class="folder-name">{{ folder.name }}</div>
              <div class="folder-meta">
                <span v-if="folder.unreadCount > 0" class="unread-badge">
                  {{ folder.unreadCount }} unread
                </span>
                <span class="system-badge">System folder</span>
              </div>
            </div>
            <div class="folder-actions">
              <button
                class="action-btn settings"
                @click="openSettingsModal(folder)"
                title="Folder settings"
              >
                Settings
              </button>
            </div>
          </div>
        </div>
      </section>

      <section class="folder-section">
        <h2>Custom Folders</h2>
        <div v-if="customFolders.length === 0" class="empty-state small">
          <p>No custom folders yet</p>
        </div>
        <div v-else class="folders-list">
          <div
            v-for="(folder, index) in customFolders"
            :key="folder.id"
            class="folder-card"
          >
            <div class="folder-order">
              <button
                class="order-btn"
                :disabled="index === 0"
                @click="moveFolder(folder, 'up')"
                title="Move up"
              >
                &uarr;
              </button>
              <button
                class="order-btn"
                :disabled="index === customFolders.length - 1"
                @click="moveFolder(folder, 'down')"
                title="Move down"
              >
                &darr;
              </button>
            </div>

            <div class="folder-icon">&#128193;</div>

            <div class="folder-info">
              <div class="folder-name">{{ folder.name }}</div>
              <div class="folder-meta">
                <span v-if="folder.unreadCount > 0" class="unread-badge">
                  {{ folder.unreadCount }} unread
                </span>
              </div>
            </div>

            <div class="folder-actions">
              <button
                class="action-btn settings"
                @click="openSettingsModal(folder)"
                title="Folder settings"
              >
                Settings
              </button>
              <button
                class="action-btn edit"
                @click="openEditModal(folder)"
                title="Edit folder"
              >
                Edit
              </button>
              <button
                class="action-btn delete"
                @click="openDeleteModal(folder)"
                title="Delete folder"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      </section>
    </template>

    <!-- Create Modal -->
    <Teleport to="body">
      <div v-if="showCreateModal" class="modal-overlay" @click.self="closeModals">
        <div class="modal-content small">
          <div class="modal-header">
            <h2>Create Folder</h2>
            <button type="button" class="close-btn" @click="closeModals">&times;</button>
          </div>
          <form @submit.prevent="handleCreate" class="modal-body">
            <div class="form-group">
              <label for="new-folder-name">Folder Name</label>
              <input
                id="new-folder-name"
                v-model="newFolderName"
                type="text"
                placeholder="e.g., Work, Personal, Newsletters"
                autofocus
                required
              />
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" @click="closeModals">
                Cancel
              </button>
              <button
                type="submit"
                class="btn btn-primary"
                :disabled="!newFolderName.trim() || saving"
              >
                {{ saving ? 'Creating...' : 'Create Folder' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>

    <!-- Edit Modal -->
    <Teleport to="body">
      <div v-if="showEditModal" class="modal-overlay" @click.self="closeModals">
        <div class="modal-content small">
          <div class="modal-header">
            <h2>Edit Folder</h2>
            <button type="button" class="close-btn" @click="closeModals">&times;</button>
          </div>
          <form @submit.prevent="handleEdit" class="modal-body">
            <div class="form-group">
              <label for="edit-folder-name">Folder Name</label>
              <input
                id="edit-folder-name"
                v-model="editFolderName"
                type="text"
                autofocus
                required
              />
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" @click="closeModals">
                Cancel
              </button>
              <button
                type="submit"
                class="btn btn-primary"
                :disabled="!editFolderName.trim() || saving"
              >
                {{ saving ? 'Saving...' : 'Save Changes' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>

    <!-- Delete Confirmation Modal -->
    <Teleport to="body">
      <div v-if="showDeleteModal" class="modal-overlay" @click.self="closeModals">
        <div class="modal-content small">
          <div class="modal-header">
            <h2>Delete Folder</h2>
            <button type="button" class="close-btn" @click="closeModals">&times;</button>
          </div>
          <div class="modal-body">
            <div class="warning-message">
              <p><strong>Are you sure you want to delete "{{ editingFolder?.name }}"?</strong></p>
              <p class="warning-text">
                This will permanently delete all emails in this folder. This action cannot be undone.
              </p>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" @click="closeModals">
                Cancel
              </button>
              <button
                type="button"
                class="btn btn-danger"
                @click="handleDelete"
                :disabled="saving"
              >
                {{ saving ? 'Deleting...' : 'Delete Folder' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Settings Modal -->
    <Teleport to="body">
      <div v-if="showSettingsModal" class="modal-overlay" @click.self="closeModals">
        <div class="modal-content small">
          <div class="modal-header">
            <h2>{{ editingFolder?.name }} Settings</h2>
            <button type="button" class="close-btn" @click="closeModals">&times;</button>
          </div>
          <form @submit.prevent="handleSettings" class="modal-body">
            <div class="settings-group">
              <label class="toggle-label">
                <input type="checkbox" v-model="settingsNotifications" />
                <span class="toggle-text">
                  <strong>Notifications</strong>
                  <span class="toggle-desc">Get notified when new emails arrive in this folder</span>
                </span>
              </label>
            </div>

            <div class="settings-group">
              <label class="toggle-label">
                <input type="checkbox" v-model="settingsUnreadCount" />
                <span class="toggle-text">
                  <strong>Show unread count</strong>
                  <span class="toggle-desc">Display unread email count in the sidebar</span>
                </span>
              </label>
            </div>

            <div class="settings-group">
              <label class="toggle-label">
                <input type="checkbox" v-model="settingsSyncOffline" />
                <span class="toggle-text">
                  <strong>Sync offline</strong>
                  <span class="toggle-desc">Cache emails from this folder for offline access</span>
                </span>
              </label>
            </div>

            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" @click="closeModals">
                Cancel
              </button>
              <button
                type="submit"
                class="btn btn-primary"
                :disabled="saving"
              >
                {{ saving ? 'Saving...' : 'Save Settings' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.folders-page {
  max-width: 800px;
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
  margin-bottom: 24px;
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

.btn-primary:hover:not(:disabled) {
  background: #4f46e5;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: #f3f4f6;
  color: #374151;
}

.btn-secondary:hover {
  background: #e5e7eb;
}

.btn-danger {
  background: #dc2626;
  color: #fff;
}

.btn-danger:hover:not(:disabled) {
  background: #b91c1c;
}

.btn-danger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.loading-state,
.empty-state,
.error-state {
  text-align: center;
  padding: 60px 20px;
  color: #6b7280;
}

.empty-state.small {
  padding: 30px 20px;
}

.error-state button {
  margin-top: 16px;
  padding: 8px 16px;
  background: #f3f4f6;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.folder-section {
  margin-bottom: 32px;
}

.folder-section h2 {
  font-size: 14px;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 12px;
}

.folders-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.folder-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}

.folder-card.system {
  background: #f9fafb;
}

.folder-order {
  display: flex;
  flex-direction: column;
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

.folder-icon {
  font-size: 20px;
  width: 32px;
  text-align: center;
}

.folder-info {
  flex: 1;
  min-width: 0;
}

.folder-name {
  font-weight: 500;
  font-size: 15px;
}

.folder-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  font-size: 12px;
}

.unread-badge {
  color: #6366f1;
  font-weight: 500;
}

.system-badge {
  color: #9ca3af;
}

.folder-actions {
  display: flex;
  gap: 8px;
}

.action-btn {
  padding: 6px 12px;
  font-size: 13px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
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

.action-btn.settings {
  background: #f3f4f6;
  color: #374151;
}

.action-btn.settings:hover {
  background: #e5e7eb;
}

/* Settings modal */
.settings-group {
  padding: 16px 0;
  border-bottom: 1px solid #e5e7eb;
}

.settings-group:first-child {
  padding-top: 0;
}

.settings-group:last-of-type {
  border-bottom: none;
}

.toggle-label {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  cursor: pointer;
}

.toggle-label input[type="checkbox"] {
  width: 18px;
  height: 18px;
  margin-top: 2px;
  cursor: pointer;
}

.toggle-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.toggle-text strong {
  font-size: 14px;
  color: #374151;
}

.toggle-desc {
  font-size: 13px;
  color: #6b7280;
}

/* Modal styles */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  z-index: 1000;
}

.modal-content {
  width: 100%;
  max-width: 500px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.2);
}

.modal-content.small {
  max-width: 400px;
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
}

.form-group {
  margin-bottom: 20px;
}

.form-group:last-child {
  margin-bottom: 0;
}

.form-group label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: #374151;
  margin-bottom: 6px;
}

.form-group input {
  width: 100%;
  padding: 10px 12px;
  font-size: 14px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
}

.form-group input:focus {
  outline: none;
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
}

.warning-message {
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 20px;
}

.warning-message p {
  margin: 0;
}

.warning-text {
  margin-top: 8px !important;
  font-size: 14px;
  color: #dc2626;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
}

@media (max-width: 600px) {
  .folder-card {
    flex-wrap: wrap;
  }

  .folder-actions {
    width: 100%;
    justify-content: flex-end;
    margin-top: 8px;
    padding-top: 12px;
    border-top: 1px solid #e5e7eb;
  }

  .modal-footer {
    flex-direction: column;
  }

  .btn {
    width: 100%;
  }
}
</style>
