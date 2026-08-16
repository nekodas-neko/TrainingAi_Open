// Trailing-edge debounce with a max-wait, keyed per user (Q-213 Stage 3).
//
// The BLE plugin drains ring history one POST per ~255-event batch, in order
// (docs/oura-ble-operations.md §2), and each rollup already re-derives the whole touched span — so
// re-rolling on every batch is waste. Run once the batches stop arriving, and at least every
// `maxWaitMs` during a long continuous drain so a stream that never pauses still lands periodically.
//
// It replaces `frames.length < 255 || elapsed >= 8s`, which was written to mean "the drain's LAST
// batch" and did not: §2 says a routine drain is 1–2 batches and almost always under 255 frames, so
// that predicate read as "any batch" and bypassed its own window nearly every time.
//
// Lives here rather than in the route because a Next route module may only export its HTTP verbs,
// and timing logic that cannot be tested at its boundaries is how an off-by-one in a debounce ships.

export type Debouncer = {
  /** Record activity for `key`, scheduling (or bringing forward) its run. */
  schedule: (key: string) => void
  /** Cancel a pending run. Tests only — a live server never wants this. */
  cancel: (key: string) => void
}

export type DebounceOptions = {
  debounceMs: number
  maxWaitMs: number
  run: (key: string) => void
  /** Injected in tests. Production passes neither. */
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => { clear: () => void }
}

function defaultSetTimer(fn: () => void, ms: number) {
  const t = setTimeout(fn, ms)
  // A pending rollup must never be a reason for the process to stay alive at shutdown. Skipping the
  // run is safe: `oura_rollup_state` persists the watermark, so the next run starts from it.
  t.unref?.()
  return { clear: () => clearTimeout(t) }
}

export function createRollupDebouncer(opts: DebounceOptions): Debouncer {
  const now = opts.now ?? Date.now
  const setTimer = opts.setTimer ?? defaultSetTimer

  const timers = new Map<string, { clear: () => void }>()
  const burstStartedAt = new Map<string, number>()

  function fire(key: string): void {
    timers.delete(key)
    burstStartedAt.delete(key)
    opts.run(key)
  }

  return {
    schedule(key: string) {
      const t = now()
      const burstStart = burstStartedAt.get(key) ?? t
      burstStartedAt.set(key, burstStart)

      timers.get(key)?.clear()

      // The max-wait is checked against the START of the burst, not the last run: a continuous
      // stream keeps pushing the trailing edge out forever, and this is the only thing that stops it.
      if (t - burstStart >= opts.maxWaitMs) {
        fire(key)
        return
      }
      timers.set(key, setTimer(() => fire(key), opts.debounceMs))
    },
    cancel(key: string) {
      timers.get(key)?.clear()
      timers.delete(key)
      burstStartedAt.delete(key)
    },
  }
}
