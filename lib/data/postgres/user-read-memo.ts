// Small per-user memos for database reads that repeat with the same answer (#3793).
//
// Each memo holds at most one entry per user, filed under that user's id, so a read for one user
// can never be answered from another's entry. An entry also carries a `key`: the facts the answer
// depends on that the caller can name cheaply (the newest anchor row, the local day). A different
// key is a miss. Writers that change the answer call `drop(userId)` after their write, and every
// entry ages out at `maxAgeMs` as a backstop for a write this process never hears about (a script,
// a hand-run statement, a second instance).
//
// **One process.** Like `observed-hr-day-cache.ts` (#3774), this is a Map in the server's memory,
// on `globalThis` so every route bundle shares it. The app runs as one long-lived process; with two
// instances a write on one would leave the other's entry stale until `maxAgeMs`.
//
// Off under test unless a test turns it on, so suites sharing a user id never see each other's rows.

interface Entry<V> { key: string; filledAt: number; value: Promise<V> }

export interface UserReadMemo<V> {
  /** The entry for `userId` under `key`, or `fill()` when there is none. Concurrent callers share
   *  one fill; a failed fill is not kept. With the memos off, always `fill()`. */
  get(userId: string, key: string, fill: () => Promise<V>, now?: number): Promise<V>
  /** Forget the user's entry, including one still being filled (it may have read before the write).
   *  Call after the write is committed. `when` narrows it: the entry goes only if `when(key)`. */
  drop(userId: string, when?: (key: string) => boolean): void
  size(): number
  clear(): void
}

interface State { memos: Map<string, Map<string, Entry<unknown>>>; enabled: boolean | null }
const holder = globalThis as unknown as { __userReadMemos?: State }
const state: State = holder.__userReadMemos ??= { memos: new Map(), enabled: null }

export function userReadMemosEnabled(): boolean {
  return state.enabled ?? (process.env.NODE_ENV !== 'test' && !process.env.VITEST)
}

/** `null` restores the default. Clears every memo either way. */
export function setUserReadMemosEnabled(enabled: boolean | null): void {
  state.enabled = enabled
  for (const m of state.memos.values()) m.clear()
}

export function createUserReadMemo<V>(name: string, opts: { maxEntries: number; maxAgeMs: number }): UserReadMemo<V> {
  let entries = state.memos.get(name) as Map<string, Entry<V>> | undefined
  if (!entries) {
    entries = new Map()
    state.memos.set(name, entries as Map<string, Entry<unknown>>)
  }
  const map = entries
  return {
    get(userId, key, fill, now = Date.now()) {
      if (!userReadMemosEnabled()) return fill()
      const hit = map.get(userId)
      if (hit && hit.key === key && now - hit.filledAt <= opts.maxAgeMs) {
        // Re-insert so the Map's order is least recently used first, which is what eviction reads.
        map.delete(userId); map.set(userId, hit)
        return hit.value
      }
      map.delete(userId)
      const value = fill()
      const entry: Entry<V> = { key, filledAt: now, value }
      map.set(userId, entry)
      value.catch(() => { if (map.get(userId) === entry) map.delete(userId) })
      for (const oldest of map.keys()) {
        if (map.size <= opts.maxEntries) break
        map.delete(oldest)
      }
      return value
    },
    drop(userId, when) {
      const e = map.get(userId)
      if (e && (!when || when(e.key))) map.delete(userId)
    },
    size: () => map.size,
    clear: () => map.clear(),
  }
}
