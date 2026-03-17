import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'

export function isNative(): boolean {
  return Capacitor.isNativePlatform()
}

export async function getServerUrl(): Promise<string | null> {
  if (!isNative()) return null
  const { value } = await Preferences.get({ key: 'serverUrl' })
  return value
}

export async function setServerUrl(url: string): Promise<void> {
  await Preferences.set({ key: 'serverUrl', value: url })
}
