/**
 * The "already notified today" map that the local-notification reconcilers (health alerts, meal
 * and supplement reminders) keep in localStorage, so a reconcile pass does not fire the same
 * notification twice. One store per storage key; a storage failure reads as an empty map and a
 * failed write is dropped.
 */
export function notifiedTodayStore(key: string): {
  read: () => Record<string, string>
  write: (map: Record<string, string>) => void
} {
  return {
    read() {
      try {
        const raw = localStorage.getItem(key)
        return raw ? JSON.parse(raw) : {}
      } catch {
        return {}
      }
    },
    write(map) {
      try {
        localStorage.setItem(key, JSON.stringify(map))
      } catch {}
    },
  }
}
