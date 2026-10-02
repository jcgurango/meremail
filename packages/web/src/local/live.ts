import { ref, watch, onScopeDispose, type Ref, type WatchSource } from 'vue'
import { liveQuery } from 'dexie'

/**
 * Run a query against the local database and keep the result up to date:
 * it re-runs whenever the data it read changes (in this tab or another), and
 * whenever one of `deps` changes.
 */
export function useLiveQuery<T>(
  query: () => Promise<T>,
  initial: T,
  deps: WatchSource[] = []
): { data: Ref<T>; loaded: Ref<boolean>; error: Ref<Error | null> } {
  const data = ref(initial) as Ref<T>
  const loaded = ref(false)
  const error = ref<Error | null>(null)
  let subscription: { unsubscribe(): void } | null = null

  function subscribe() {
    subscription?.unsubscribe()
    subscription = liveQuery(query).subscribe({
      next: (value) => {
        data.value = value
        loaded.value = true
        error.value = null
      },
      error: (e) => {
        console.error('[LiveQuery] Query failed:', e)
        error.value = e instanceof Error ? e : new Error(String(e))
        loaded.value = true
      },
    })
  }

  subscribe()
  if (deps.length > 0) {
    watch(deps, () => {
      loaded.value = false
      subscribe()
    })
  }
  onScopeDispose(() => subscription?.unsubscribe())

  return { data, loaded, error }
}
