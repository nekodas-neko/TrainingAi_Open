import type { OuraBlePlugin, OuraRawRow } from '@/lib/oura-ble/plugin'

/**
 * #2579 — mark the device's raw rows `rolled_up` from the SERVER's rollup watermark, so the
 * device raw store (`oura_raw.db`) can finally be pruned.
 *
 * **What `rolled_up` means here: "folded on the server".** The plan was for the device's own rollup
 * to set it (device-primary plan, Task 3), and that rollup is not built — it needs the WebView model
 * runtime (D2 Task 6), the single-writer switch (Task 7), a local migration and an APK. Meanwhile
 * the server folds every frame it receives and keeps all of them in an archive that is never pruned
 * (`docs/rules/oura-ble.md`), so "the server has folded past this and holds it" is a safe reason to
 * let the device forget a frame. This interim is retired at #2302 step 2, when the device becomes
 * the writer; see §7 of `docs/superpowers/plans/2026-08-18-device-primary-compute.md`.
 *
 * **Two halves, gated differently.**
 * 1. *Marking* always runs. It writes only the `rolled_up` flag, never deletes, and only on rows
 *    whose `measured_at` is older than the watermark by `ROLLED_UP_MARGIN_MS`.
 * 2. *Pruning* runs only when the owner has turned on `ta_ring_raw_prune` (`raw-prune-flag.ts`,
 *    off by default). With it off, this module COUNTS what a prune would remove and logs it — so the
 *    owner can judge the number before anything on the phone is deleted.
 *
 * **What it can and cannot see.** The bridge (`lib/oura-ble/plugin.ts`, unchanged — no APK) returns
 * a row's `ringTs`, `tag`, `eventName`, `bodyHex` and `measuredAt`, but **not its `synced` flag**, and
 * `markRolledUp` filters only on `rolled_up = 0`. So a row whose backup POST failed (`synced = 0`)
 * and that is old enough WILL be marked. What keeps that safe is the native prune's own predicate,
 * `rolled_up = 1 AND synced = 1 AND measured_at < ?` (`OuraRawDb.pruneRaw`): such a row is never
 * deleted while the server lacks it. The flag on it is the one dishonest bit, and the device-writer
 * switch must reset `rolled_up` where `synced = 0` before it trusts the column (plan §7).
 * Enforcing `synced = 1` at marking time needs a native change and an APK — #2583.
 *
 * Nothing here touches the ring key, the BLE link, the history cursor, the server, or any row the
 * server holds: the only writes are `markRolledUp` (device flag) and, when the flag is on,
 * `pruneRaw` (device rows).
 */

/**
 * How far behind the server's watermark a row's `measured_at` must be before it counts as folded.
 *
 * Six hours. The two clocks being compared are not the same clock: the device stamps `measured_at`
 * at insert time from its single newest anchor, while the server resolves the watermark's `ds`
 * through a robust per-epoch offset (`dsToMs`). They disagree by the anchor's observation lag and the
 * ring's drift between drains — seconds to minutes in practice. The worst case the clock code admits
 * is a ring-clock regression smaller than `EPOCH_REGRESSION_TOLERANCE_DS` (one hour), which both
 * sides read as reordering rather than a new epoch, so a stamp can be off by up to that hour. The
 * watermark is also only as fresh as the last COMPLETED run, which trails the drain by the rollup's
 * debounce. Six hours clears every one of those several times over, and costs nothing that matters:
 * the prune keeps 14 days anyway (`DEVICE_RAW_RETENTION_MS`), so the margin delays only the FLAG,
 * never the space. Data safety does not rest on this number at all — a mis-stamped row the margin
 * failed to hold back is still deleted only once the server holds it (`synced = 1`).
 */
export const ROLLED_UP_MARGIN_MS = 6 * 60 * 60 * 1000

/**
 * The device's raw copy is a 14-day rolling window — the owner's 2026-08-02 retention decision
 * (`docs/rules/oura-ble.md`). The prune never removes a row younger than this, however far the
 * server has folded.
 */
export const DEVICE_RAW_RETENTION_MS = 14 * 24 * 60 * 60 * 1000

/** Rows asked of the bridge per page. Each row crosses the bridge with its `bodyHex`, so this is a
 *  memory and latency bound, not a correctness one. */
export const MARK_PAGE_SIZE = 2000
/** Pages per run. A store of ~200k rows catches up in one run; a larger one finishes over the next
 *  few, which is fine — marking is idempotent and resumes where it stopped. */
export const MARK_MAX_PAGES = 150

/**
 * The newest `measured_at` that may be marked: the watermark less the margin, and never later than
 * the phone's own clock less the margin (a watermark resolved through a bad anchor can land in the
 * future, and must not drag fresh rows over the line). Null — mark nothing — when there is no
 * watermark or it is not a finite number.
 */
export function markCutoffMs(rolledThroughMs: number | null, nowMs: number): number | null {
  if (rolledThroughMs == null || !Number.isFinite(rolledThroughMs) || !Number.isFinite(nowMs)) return null
  return Math.min(rolledThroughMs, nowMs) - ROLLED_UP_MARGIN_MS
}

/** The prune's `olderThanMs`: whichever is earlier of the mark cutoff and the retention window. */
export function pruneCutoffMs(markCutoff: number, nowMs: number): number {
  return Math.min(markCutoff, nowMs - DEVICE_RAW_RETENTION_MS)
}

/**
 * The `ringTs` values in one page whose EVERY row is safely before the cutoff.
 *
 * Grouped by `ringTs` because that is what `markRolledUp` marks: one ringTs can carry several rows
 * (different tags, and — after a ring re-key restarts the counter — rows from two epochs at the same
 * value). `getUnrolledRaw` never splits a ringTs across pages, so the page holds every unrolled row
 * at each ringTs it returns, and requiring all of them to qualify means a mark can never reach a row
 * that is too new. A null `measured_at` cannot be proven old and disqualifies its ringTs.
 */
export function markableRingTs(rows: readonly OuraRawRow[], cutoffMs: number): number[] {
  const ok = new Map<number, boolean>()
  for (const r of rows) {
    const qualifies = r.measuredAt != null && Number.isFinite(r.measuredAt) && r.measuredAt < cutoffMs
    ok.set(r.ringTs, (ok.get(r.ringTs) ?? true) && qualifies)
  }
  return [...ok.entries()].filter(([, v]) => v).map(([ts]) => ts)
}

/** UTC day start, for the marked-rows histogram. A bucket key, not a calendar day anyone reads. */
const DAY_MS = 24 * 60 * 60 * 1000
const dayBucket = (ms: number) => Math.floor(ms / DAY_MS) * DAY_MS

export type RawMaintenanceOutcome =
  | 'no-plugin'           // web, or an APK without the raw-store bridge
  | 'no-watermark'        // no completed server rollup in this clock epoch: nothing is folded
  | 'watermark-error'     // the read failed — fail closed, touch nothing
  | 'done'

export interface RawMaintenanceResult {
  at: number
  outcome: RawMaintenanceOutcome
  rolledThroughMs: number | null
  markCutoffMs: number | null
  pruneCutoffMs: number | null
  /** Rows the bridge reported as newly marked this run (`markRolledUp`'s `updated`). */
  marked: number
  pages: number
  /** True when the run stopped on the page cap rather than running out of markable rows. */
  hitPageCap: boolean
  /** Rows marked across runs that are older than this run's prune cutoff — what a prune would
   *  remove, BEFORE the native `synced = 1` check (rows whose backup never reached the server are
   *  excluded there and cannot be seen here). Null when there is no cutoff. */
  wouldPrune: number | null
  pruneEnabled: boolean
  /** Rows the native prune deleted. Always 0 with the flag off — it is never called. */
  pruned: number
  statsBefore: RawStats | null
  statsAfter: RawStats | null
  error: string | null
}

export interface RawStats { totalRows: number; unrolledRows: number; bytes: number; lowDisk: boolean }

/** Marked-row counts by UTC day of `measured_at`, persisted between runs so a prune estimate covers
 *  rows marked by earlier runs too. Advisory only: it undercounts after site data is cleared. */
export type MarkedHistogram = Record<string, number>

export type RawStorePlugin = Pick<OuraBlePlugin, 'getUnrolledRaw' | 'markRolledUp' | 'pruneRaw' | 'rawStats'>

export interface RawMaintenanceDeps {
  plugin: RawStorePlugin | null
  /** `GET /api/oura-ble/rollup-watermark`. Returns `{ rolledThroughMs }`, or throws on any failure. */
  readWatermark(): Promise<{ rolledThroughMs: number | null }>
  /** The owner's prune flag. Anything but an explicit yes is no — and a throw is no. */
  isPruneEnabled(): boolean
  now(): number
  loadHistogram(): MarkedHistogram
  saveHistogram(h: MarkedHistogram): void
  log(line: string): void
}

function sumBefore(h: MarkedHistogram, cutoffMs: number): number {
  let n = 0
  // A bucket counts only when the whole UTC day is before the cutoff — an estimate that errs low
  // rather than promising rows the prune will not take.
  for (const [k, v] of Object.entries(h)) if (Number(k) + DAY_MS <= cutoffMs) n += v
  return n
}

async function safeStats(plugin: RawStorePlugin): Promise<RawStats | null> {
  try { return await plugin.rawStats() } catch { return null }
}

/**
 * One maintenance pass: read the watermark, mark what it covers, then count (flag off) or prune
 * (flag on). Never throws; every failure is recorded on the result and stops the pass before any
 * write that depended on it.
 *
 * Safe if the process dies part-way: each `markRolledUp` call is one native transaction, nothing
 * here holds state that a restart needs, and the next pass picks up at the oldest unmarked row.
 * Idempotent: marking only ever sets `rolled_up = 1` where it is 0, and a watermark that moves
 * BACKWARDS only narrows what the next pass marks — nothing is ever un-marked.
 */
export async function runRawRolledUpMaintenance(deps: RawMaintenanceDeps): Promise<RawMaintenanceResult> {
  const at = deps.now()
  const result: RawMaintenanceResult = {
    at, outcome: 'done', rolledThroughMs: null, markCutoffMs: null, pruneCutoffMs: null,
    marked: 0, pages: 0, hitPageCap: false, wouldPrune: null, pruneEnabled: false, pruned: 0,
    statsBefore: null, statsAfter: null, error: null,
  }
  const plugin = deps.plugin
  if (!plugin) {
    result.outcome = 'no-plugin'
    return result
  }

  let rolledThroughMs: number | null
  try {
    const w = await deps.readWatermark()
    rolledThroughMs = typeof w?.rolledThroughMs === 'number' && Number.isFinite(w.rolledThroughMs) ? w.rolledThroughMs : null
    if (w?.rolledThroughMs != null && rolledThroughMs == null) throw new Error('malformed watermark')
  } catch (err) {
    result.outcome = 'watermark-error'
    result.error = err instanceof Error ? err.message : String(err)
    deps.log(`watermark read failed (${result.error}) — nothing marked, nothing pruned`)
    return result
  }
  result.rolledThroughMs = rolledThroughMs

  const cutoff = markCutoffMs(rolledThroughMs, at)
  if (cutoff == null) {
    result.outcome = 'no-watermark'
    deps.log('no completed server rollup in the current clock epoch — nothing marked, nothing pruned')
    return result
  }
  result.markCutoffMs = cutoff
  result.statsBefore = await safeStats(plugin)

  let histogram: MarkedHistogram
  try { histogram = { ...deps.loadHistogram() } } catch { histogram = {} }

  // ── mark ──
  try {
    for (let page = 0; page < MARK_MAX_PAGES; page++) {
      const { rows } = await plugin.getUnrolledRaw({ limit: MARK_PAGE_SIZE })
      result.pages++
      if (!rows.length) break
      const ringTsList = markableRingTs(rows, cutoff)
      // No progress possible: the oldest unmarked rows are all too new (or undated). They will
      // age past the cutoff on a later pass; reading the same page again now would only spin.
      if (!ringTsList.length) break
      const { updated } = await plugin.markRolledUp({ ringTsList })
      result.marked += updated
      const marked = new Set(ringTsList)
      for (const r of rows) {
        if (!marked.has(r.ringTs) || r.measuredAt == null) continue
        const k = String(dayBucket(r.measuredAt))
        histogram[k] = (histogram[k] ?? 0) + 1
      }
      if (rows.length < MARK_PAGE_SIZE) break
      if (page === MARK_MAX_PAGES - 1) result.hitPageCap = true
    }
  } catch (err) {
    // A failed page leaves every earlier page's marks in place (each was its own transaction) and
    // no partial mark of this one. The prune below still runs only over rows that ARE marked.
    result.error = `mark: ${err instanceof Error ? err.message : String(err)}`
  }

  // ── count, or prune ──
  const olderThan = pruneCutoffMs(cutoff, at)
  result.pruneCutoffMs = olderThan
  result.wouldPrune = sumBefore(histogram, olderThan)
  let enabled = false
  try { enabled = deps.isPruneEnabled() === true } catch { enabled = false }
  result.pruneEnabled = enabled

  if (enabled) {
    try {
      const { deleted } = await plugin.pruneRaw({ olderThanMs: olderThan, reserveBytes: 0 })
      result.pruned = deleted
      // Buckets wholly before the cutoff have been pruned (or are held back only because the
      // server never got them, which this side cannot see). Drop them so the estimate stays honest.
      for (const k of Object.keys(histogram)) if (Number(k) + DAY_MS <= olderThan) delete histogram[k]
    } catch (err) {
      result.error = [result.error, `prune: ${err instanceof Error ? err.message : String(err)}`].filter(Boolean).join('; ')
    }
  }

  try { deps.saveHistogram(histogram) } catch { /* advisory only */ }
  result.statsAfter = await safeStats(plugin)

  deps.log(
    `marked ${result.marked} row(s) rolled up (folded on the server) over ${result.pages} page(s)` +
    `${result.hitPageCap ? ' — page cap reached, the next pass continues' : ''}; ` +
    (enabled
      ? `prune ON: deleted ${result.pruned} row(s) measured before ${new Date(olderThan).toISOString()}`
      : `prune OFF: would delete about ${result.wouldPrune} row(s) measured before ${new Date(olderThan).toISOString()} ` +
        '(fewer if any were never backed up — the native prune skips those)') +
    (result.statsAfter ? `; store ${result.statsAfter.totalRows} rows, ${result.statsAfter.unrolledRows} unrolled, ${result.statsAfter.bytes} bytes` : '') +
    (result.error ? `; error: ${result.error}` : ''),
  )
  return result
}
