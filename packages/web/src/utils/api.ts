/**
 * Direct server calls for the parts of the app that only work online:
 * managing folders, rules and identities.
 *
 * Mail itself is not fetched here. It lives in the local database (see
 * src/local), which the sync engine keeps up to date.
 */

import { searchContacts as searchLocalContacts } from '@/local/queries'
import { syncNow } from '@/local/sync'

export interface Contact {
  id: number
  name: string | null
  email: string
  isMe?: boolean
}

export interface Folder {
  id: number
  name: string
  imapFolder: string | null
  position: number
  isSystem?: boolean
  notificationsEnabled: boolean
  showUnreadCount: boolean
  syncOffline: boolean
  unreadCount: number
}

/**
 * GET /api/folders
 */
export async function getFolders(): Promise<{ data: { folders: Folder[] } }> {
  const res = await fetch('/api/folders')
  if (!res.ok) throw new Error('Failed to fetch folders')
  return { data: await res.json() }
}

/**
 * POST /api/contacts/:id/set-default-identity
 */
export async function setDefaultIdentity(contactId: number): Promise<void> {
  const res = await fetch(`/api/contacts/${contactId}/set-default-identity`, {
    method: 'POST',
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || 'Failed to set default identity')
  }
  // Pick the change up locally
  syncNow()
}

/**
 * Search contacts held on this device
 */
export async function searchContacts(query: string, limit = 20): Promise<{ data: { contacts: Contact[] } }> {
  return { data: { contacts: await searchLocalContacts(query, limit) } }
}

// ============== Rules API ==============

export interface RuleCondition {
  field: string
  matchType: 'exact' | 'contains' | 'regex'
  value: string
  negate?: boolean
}

export interface RuleConditionGroup {
  operator: 'AND' | 'OR'
  conditions: (RuleCondition | RuleConditionGroup)[]
}

export interface Rule {
  id: number
  name: string
  conditions: RuleConditionGroup
  actionType: string
  actionConfig: { folderId?: number } | null
  folderIds: number[]
  position: number
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface RuleApplication {
  id: number
  ruleId: number | null
  status: 'pending' | 'running' | 'completed' | 'failed'
  totalCount: number
  processedCount: number
  matchedCount: number
  matchBreakdown: Record<number, number> | null
  error: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
}

export async function getRules(): Promise<{ rules: Rule[] }> {
  const response = await fetch('/api/rules')
  if (!response.ok) throw new Error('Failed to fetch rules')
  return response.json()
}

export async function getRule(id: number): Promise<{ rule: Rule }> {
  const response = await fetch(`/api/rules/${id}`)
  if (!response.ok) throw new Error('Failed to fetch rule')
  return response.json()
}

export async function createRule(data: {
  name: string
  conditions: RuleConditionGroup
  actionType: string
  actionConfig?: { folderId?: number }
  folderIds?: number[]
  enabled?: boolean
}): Promise<{ rule: Rule }> {
  const response = await fetch('/api/rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) throw new Error('Failed to create rule')
  return response.json()
}

export async function updateRule(id: number, data: Partial<{
  name: string
  conditions: RuleConditionGroup
  actionType: string
  actionConfig: { folderId?: number }
  folderIds: number[]
  enabled: boolean
}>): Promise<{ rule: Rule }> {
  const response = await fetch(`/api/rules/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) throw new Error('Failed to update rule')
  return response.json()
}

export async function deleteRule(id: number): Promise<{ success: boolean }> {
  const response = await fetch(`/api/rules/${id}`, { method: 'DELETE' })
  if (!response.ok) throw new Error('Failed to delete rule')
  return response.json()
}

export async function reorderRules(positions: { id: number; position: number }[]): Promise<{ success: boolean }> {
  const response = await fetch('/api/rules/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ positions }),
  })
  if (!response.ok) throw new Error('Failed to reorder rules')
  return response.json()
}

export async function applyRule(id: number): Promise<{ application: { id: number; status: string; totalCount: number } }> {
  const response = await fetch(`/api/rules/${id}/apply`, { method: 'POST' })
  if (!response.ok) throw new Error('Failed to apply rule')
  return response.json()
}

export async function applyAllRules(folderIds?: number[]): Promise<{ application: { id: number; status: string; totalCount: number } }> {
  const response = await fetch('/api/rules/apply-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(folderIds ? { folderIds } : {}),
  })
  if (!response.ok) throw new Error('Failed to apply all rules')
  return response.json()
}

export async function getRuleApplication(id: number): Promise<{ application: RuleApplication }> {
  const response = await fetch(`/api/rules/applications/${id}`)
  if (!response.ok) throw new Error('Failed to fetch application status')
  return response.json()
}

export interface RuleApplicationWithName extends RuleApplication {
  ruleName: string | null
}

export async function getRuleApplications(): Promise<{ applications: RuleApplicationWithName[] }> {
  const response = await fetch('/api/rules/applications')
  if (!response.ok) throw new Error('Failed to fetch applications')
  return response.json()
}

export interface RulePreviewMatch {
  id: number
  threadId: number | null
  subject: string
  senderName: string | null
  senderEmail: string
  sentAt: string | null
}

export async function previewRule(conditions: RuleConditionGroup, folderIds: number[]): Promise<{
  matches: RulePreviewMatch[]
  scannedCount: number
  matchCount: number
}> {
  const response = await fetch('/api/rules/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conditions, folderIds }),
  })
  if (!response.ok) throw new Error('Failed to preview rule')
  return response.json()
}

export async function addSenderToRule(ruleId: number, email: string): Promise<{ success: boolean; emailCount: number; error?: string }> {
  const response = await fetch(`/api/rules/${ruleId}/add-sender`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  const data = await response.json()
  if (!response.ok) {
    return { success: false, emailCount: 0, error: data.error || 'Failed to add sender' }
  }
  return data
}

// ============== Folders API (extended) ==============
// Each change is followed by a sync so the local copy of the folders catches up

export async function createFolder(name: string): Promise<{ folder: Folder }> {
  const response = await fetch('/api/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!response.ok) throw new Error('Failed to create folder')
  syncNow()
  return response.json()
}

export async function updateFolder(id: number, updates: {
  name?: string
  notificationsEnabled?: boolean
  showUnreadCount?: boolean
  syncOffline?: boolean
}): Promise<{ folder: Folder }> {
  const response = await fetch(`/api/folders/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
  if (!response.ok) throw new Error('Failed to update folder')
  syncNow()
  return response.json()
}

export async function deleteFolder(id: number): Promise<{ success: boolean; deletedThreads: number }> {
  const response = await fetch(`/api/folders/${id}`, { method: 'DELETE' })
  if (!response.ok) throw new Error('Failed to delete folder')
  syncNow()
  return response.json()
}

export async function reorderFolders(positions: { id: number; position: number }[]): Promise<{ success: boolean }> {
  const response = await fetch('/api/folders/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ positions }),
  })
  if (!response.ok) throw new Error('Failed to reorder folders')
  syncNow()
  return response.json()
}
