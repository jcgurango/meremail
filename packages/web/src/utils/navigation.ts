import type { Router, RouteLocationRaw } from 'vue-router'

/**
 * Go back to where the user came from - or, if they arrived here directly
 * (a notification, a bookmark, a pasted link) and there is nothing to go
 * back to, to `fallback` instead.
 */
export function goBackOr(router: Router, fallback: RouteLocationRaw): void {
  // vue-router records the previous in-app location in the history state
  if (window.history.state?.back) {
    router.back()
  } else {
    router.replace(fallback)
  }
}
