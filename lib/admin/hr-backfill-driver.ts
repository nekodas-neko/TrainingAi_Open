// Issue 2383 (item 6): the pass loop behind the HR-snapshot backfill buttons, paced under the
// routes' rate limit (6 calls a minute) instead of running into it.
//
// Both routes answer `{ processed, withData, remaining }` for a bounded pass, oldest first, and are
// additive and idempotent. The old loop fired passes back to back and stopped at the first HTTP 429,
// so a backlog needed another press. This one keeps under the limit on its own, and if a 429 still
// arrives (another tab, a restart that lost the count) it waits and resumes the same pass.
//
// Free of `fetch` and timers: both arrive as parameters, so it runs under test without a clock.

export interface BackfillPass {
  processed: number
  withData: number
  remaining: boolean
}

export type BackfillPassResult =
  | { kind: 'ok'; pass: BackfillPass }
  | { kind: 'rate-limited' }
  | { kind: 'failed'; message: string }

export interface BackfillDriverOptions {
  /** One POST to the route. Never throws for an HTTP status; a thrown error is a network failure. */
  runPass: () => Promise<BackfillPassResult>
  sleep: (ms: number) => Promise<void>
  now: () => number
  onProgress?: (p: { processed: number; withData: number; waitingMs: number | null }) => void
  /** Calls allowed per window. The routes allow 6 a minute; staying at 5 leaves one for another tab. */
  callsPerWindow?: number
  windowMs?: number
  /** How long to wait after an unexpected 429 before resuming. */
  backoffMs?: number
  /** Consecutive 429s tolerated before giving up. */
  maxConsecutive429?: number
  /** Runaway backstop on passes. */
  maxPasses?: number
}

export type BackfillOutcome =
  | { kind: 'done'; processed: number; withData: number }
  | { kind: 'stopped'; processed: number; withData: number; message: string }

export async function driveHrBackfill(opts: BackfillDriverOptions): Promise<BackfillOutcome> {
  const callsPerWindow = opts.callsPerWindow ?? 5
  const windowMs = opts.windowMs ?? 60_000
  const backoffMs = opts.backoffMs ?? 30_000
  const maxConsecutive429 = opts.maxConsecutive429 ?? 6
  const maxPasses = opts.maxPasses ?? 100

  const calls: number[] = [] // timestamps of recent calls, oldest first
  let processed = 0
  let withData = 0
  let rateLimitedInARow = 0

  for (let passes = 0; passes < maxPasses;) {
    // Pace: if the window already holds our share of calls, wait until the oldest one ages out.
    const t = opts.now()
    while (calls.length > 0 && t - calls[0] >= windowMs) calls.shift()
    if (calls.length >= callsPerWindow) {
      const waitMs = windowMs - (t - calls[0])
      opts.onProgress?.({ processed, withData, waitingMs: waitMs })
      await opts.sleep(waitMs)
      continue
    }

    calls.push(opts.now())
    const result = await opts.runPass()

    if (result.kind === 'failed') return { kind: 'stopped', processed, withData, message: result.message }
    if (result.kind === 'rate-limited') {
      if (++rateLimitedInARow > maxConsecutive429) {
        return { kind: 'stopped', processed, withData, message: 'Backfill stopped: the server kept answering HTTP 429. Press Run backfill again in a minute.' }
      }
      opts.onProgress?.({ processed, withData, waitingMs: backoffMs })
      await opts.sleep(backoffMs)
      continue // the same pass again; nothing was processed
    }

    rateLimitedInARow = 0
    passes++
    processed += result.pass.processed
    withData += result.pass.withData
    opts.onProgress?.({ processed, withData, waitingMs: null })
    if (!result.pass.remaining) return { kind: 'done', processed, withData }
  }
  return { kind: 'stopped', processed, withData, message: `Backfill stopped after ${maxPasses} passes; press Run backfill to continue.` }
}
