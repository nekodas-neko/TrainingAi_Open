// Issue 2383 (item 5): wait for the ring-frame upload to finish, instead of a fixed 4 s.
//
// `drainHistory()` resolves as soon as the drain is kicked. The service then commits each batch
// locally and POSTs it to the server on a separate ingest executor, *after* `draining` has already
// gone false (OuraRingService.postFramesBestEffort). A full-history redecode started before those
// POSTs land misses their frames. The service exposes no "uploads pending" counter, so the signal
// is the one it does expose: `draining` is false AND `ingestPosted` (frames the server has
// acknowledged) has stopped moving for several polls in a row.
//
// Free of `window` and the plugin so it runs off-device: everything outside arrives as a parameter.

export interface UploadStatus {
  state?: string
  draining?: boolean
  ingestPosted?: number
}

export interface WaitForUploadOptions {
  getStatus: () => Promise<UploadStatus>
  sleep: (ms: number) => Promise<void>
  pollMs?: number
  /** Consecutive polls with no drain running and no new acknowledged frames before we call it done. */
  quietPolls?: number
  /** Ceiling on the total wait. A drain of a very large backlog can outlast it; the caller says so. */
  maxMs?: number
  /** Used on an APK without `ingestPosted`, where there is nothing to watch: the old fixed wait. */
  fallbackMs?: number
}

/** `settled` the upload went quiet. `timeout` it was still moving at the ceiling.
 *  `unsupported` the APK reports no upload counter, so the fixed fallback wait was used. */
export type UploadSettleOutcome = 'settled' | 'timeout' | 'unsupported'

export async function waitForUploadToSettle(opts: WaitForUploadOptions): Promise<UploadSettleOutcome> {
  const pollMs = opts.pollMs ?? 1_000
  const quietPolls = opts.quietPolls ?? 4
  const maxMs = opts.maxMs ?? 90_000
  const fallbackMs = opts.fallbackMs ?? 4_000

  let first: UploadStatus
  try {
    first = await opts.getStatus()
  } catch {
    await opts.sleep(fallbackMs)
    return 'unsupported'
  }
  if (first.ingestPosted == null) {
    await opts.sleep(fallbackMs)
    return 'unsupported'
  }

  let last = first.ingestPosted
  let quiet = 0
  let waited = 0
  while (waited < maxMs) {
    await opts.sleep(pollMs)
    waited += pollMs
    let status: UploadStatus | null = null
    try { status = await opts.getStatus() } catch { /* a failed read is no news; keep waiting */ }
    if (!status) { quiet = 0; continue }
    const posted = status.ingestPosted ?? last
    if (status.draining || posted !== last) {
      quiet = 0
      last = posted
      continue
    }
    quiet++
    if (quiet >= quietPolls) return 'settled'
  }
  return 'timeout'
}
