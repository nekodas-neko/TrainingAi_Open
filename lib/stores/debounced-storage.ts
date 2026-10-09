// Coalesces zustand `persist` writes (e.g. GPS appendPoint firing every few seconds)
// to at most one localStorage.setItem per `delayMs`, always flushing the latest state
// when the timer fires.
export function debouncedLocalStorage(delayMs: number) {
  let timeout: ReturnType<typeof setTimeout> | null = null
  let pending: { name: string; value: string } | null = null

  return {
    getItem: (name: string) => localStorage.getItem(name),
    setItem: (name: string, value: string) => {
      pending = { name, value }
      if (timeout) return
      timeout = setTimeout(() => {
        if (pending) localStorage.setItem(pending.name, pending.value)
        pending = null
        timeout = null
      }, delayMs)
    },
    // A removal supersedes a write still waiting on the timer. Without this, sign-out's clear
    // (#2453, lib/sign-out-storage.ts) was undone up to `delayMs` later by the write it came after.
    removeItem: (name: string) => {
      if (pending?.name === name) pending = null
      localStorage.removeItem(name)
    },
  }
}
