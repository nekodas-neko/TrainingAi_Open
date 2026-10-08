// #2579 — marking device raw rows "folded on the server" from the server rollup's watermark, and the
// prune that stays OFF until the owner turns it on.
//
// The device store is native (`OuraRawDb.kt`) and cannot run here, so this harness reproduces the
// bridge methods the pass calls over node:sqlite, using the SAME table, the SAME statements and the
// SAME page rule as the Kotlin (`getUnrolledRaw` never splits a ring_ts; `markRolledUp` sets
// rolled_up where it is 0; `pruneRaw` deletes only `rolled_up = 1 AND synced = 1 AND measured_at <
// ?`). A drift between this and the Kotlin is exactly what the device check is for — the PR says so.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type { OuraRawRow } from '@/lib/oura-ble/plugin'
import {
  runRawRolledUpMaintenance, markCutoffMs, pruneCutoffMs, markableRingTs,
  ROLLED_UP_MARGIN_MS, DEVICE_RAW_RETENTION_MS, MARK_PAGE_SIZE,
  type RawMaintenanceDeps, type RawStorePlugin, type MarkedHistogram,
} from '../raw-rolled-up-from-server'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
// Local midday anchor (docs/rules/dates-and-timezones.md): every fixture is an offset from it.
const NOW = Date.UTC(2026, 9, 7, 2, 0, 0) // 12:00 AEST on 2026-10-07

let db: DatabaseSync

function createStore() {
  db = new DatabaseSync(':memory:')
  // Verbatim from OuraRawDb.get().
  db.exec(`CREATE TABLE raw (
    ring_ts INTEGER NOT NULL, tag INTEGER NOT NULL, event_name TEXT NOT NULL,
    body_hex TEXT NOT NULL, measured_at INTEGER,
    rolled_up INTEGER NOT NULL DEFAULT 0, synced INTEGER NOT NULL DEFAULT 0,
    UNIQUE(ring_ts, tag, body_hex))`)
  db.exec('CREATE INDEX raw_unrolled ON raw(rolled_up, ring_ts)')
  db.exec('CREATE INDEX raw_prunable ON raw(rolled_up, synced, measured_at)')
}

let seq = 0
function insert(o: { ringTs: number; measuredAt: number | null; synced?: 0 | 1; rolledUp?: 0 | 1; tag?: number }) {
  db.prepare('INSERT INTO raw (ring_ts, tag, event_name, body_hex, measured_at, rolled_up, synced) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(o.ringTs, o.tag ?? 0x60, 'ibi', `b${++seq}`, o.measuredAt, o.rolledUp ?? 0, o.synced ?? 1)
}

const readRow = (r: Record<string, unknown>): OuraRawRow => ({
  ringTs: Number(r.ring_ts), tag: Number(r.tag), eventName: String(r.event_name),
  bodyHex: String(r.body_hex), measuredAt: r.measured_at == null ? null : Number(r.measured_at),
})

/** The bridge, over the Kotlin's own SQL. `failMarkAfter` simulates the process dying mid-pass. */
function nativePlugin(opts: { failMarkAfter?: number; legacy?: boolean; unimplementedIfSynced?: boolean } = {}) {
  let markCalls = 0
  const plugin: RawStorePlugin = {
    getUnrolledRaw: vi.fn(async ({ limit = 500 } = {}) => {
      const first = db.prepare(
        'SELECT rowid, ring_ts, tag, event_name, body_hex, measured_at FROM raw WHERE rolled_up = 0 ORDER BY ring_ts, rowid LIMIT ?',
      ).all(limit) as Record<string, unknown>[]
      const rows = first.map(readRow)
      if (first.length < limit) return { rows }
      const last = first[first.length - 1]
      const rest = db.prepare(
        'SELECT rowid, ring_ts, tag, event_name, body_hex, measured_at FROM raw WHERE rolled_up = 0 AND ring_ts = ? AND rowid > ? ORDER BY rowid',
      ).all(last.ring_ts as number, last.rowid as number) as Record<string, unknown>[]
      return { rows: [...rows, ...rest.map(readRow)] }
    }),
    markRolledUp: vi.fn(async ({ ringTsList }) => {
      if (opts.failMarkAfter != null && markCalls >= opts.failMarkAfter) throw new Error('process died')
      markCalls++
      // One transaction per call, as updateByRingTs does.
      db.exec('BEGIN')
      let updated = 0
      for (const ts of ringTsList) {
        updated += Number(db.prepare('UPDATE raw SET rolled_up = 1 WHERE rolled_up = 0 AND ring_ts = ?').run(ts).changes)
      }
      db.exec('COMMIT')
      return { updated }
    }),
    // issue 2583: the Kotlin's `updateByRingTs(..., requireSynced = true)` SQL.
    markRolledUpIfSynced: vi.fn(async ({ ringTsList }) => {
      if (opts.unimplementedIfSynced) throw Object.assign(new Error('"markRolledUpIfSynced" is not implemented on android'), { code: 'UNIMPLEMENTED' })
      if (opts.failMarkAfter != null && markCalls >= opts.failMarkAfter) throw new Error('process died')
      markCalls++
      db.exec('BEGIN')
      let updated = 0
      for (const ts of ringTsList) {
        updated += Number(db.prepare('UPDATE raw SET rolled_up = 1 WHERE rolled_up = 0 AND synced = 1 AND ring_ts = ?').run(ts).changes)
      }
      db.exec('COMMIT')
      return { updated }
    }),
    pruneRaw: vi.fn(async ({ olderThanMs }) => {
      const n = db.prepare(
        'DELETE FROM raw WHERE rowid IN (SELECT rowid FROM raw WHERE rolled_up = 1 AND synced = 1 AND measured_at IS NOT NULL AND measured_at < ? ORDER BY measured_at)',
      ).run(olderThanMs).changes
      return { deleted: Number(n) }
    }),
    rawStats: vi.fn(async () => ({
      totalRows: Number((db.prepare('SELECT count(*) AS n FROM raw').get() as { n: number }).n),
      unrolledRows: Number((db.prepare('SELECT count(*) AS n FROM raw WHERE rolled_up = 0').get() as { n: number }).n),
      bytes: 0,
      lowDisk: false,
    })),
  }
  if (opts.legacy) delete plugin.markRolledUpIfSynced
  return plugin
}

let histogram: MarkedHistogram
function deps(over: Partial<RawMaintenanceDeps> & { watermark?: number | null } = {}): RawMaintenanceDeps {
  const { watermark = NOW - HOUR, ...rest } = over
  return {
    plugin: nativePlugin(),
    readWatermark: async () => ({ rolledThroughMs: watermark }),
    isPruneEnabled: () => false,
    now: () => NOW,
    loadHistogram: () => histogram,
    saveHistogram: h => { histogram = h },
    log: () => {},
    ...rest,
  }
}

const flags = () => Object.fromEntries(
  (db.prepare('SELECT ring_ts, rolled_up FROM raw ORDER BY ring_ts').all() as { ring_ts: number; rolled_up: number }[])
    .map(r => [r.ring_ts, r.rolled_up]),
)
const count = () => Number((db.prepare('SELECT count(*) AS n FROM raw').get() as { n: number }).n)

beforeEach(() => {
  createStore()
  histogram = {}
  seq = 0
})

describe('the cutoffs', () => {
  it('holds the mark line a margin behind the watermark', () => {
    expect(markCutoffMs(NOW - HOUR, NOW)).toBe(NOW - HOUR - ROLLED_UP_MARGIN_MS)
  })

  it('marks nothing without a watermark', () => {
    expect(markCutoffMs(null, NOW)).toBeNull()
    expect(markCutoffMs(Number.NaN, NOW)).toBeNull()
  })

  // A watermark resolved through a bad anchor can land in the future. It must not drag rows that
  // are fresh by the phone's own clock over the line.
  it('never lets a future watermark past the phone clock', () => {
    expect(markCutoffMs(NOW + 10 * DAY, NOW)).toBe(NOW - ROLLED_UP_MARGIN_MS)
  })

  it('prunes no row younger than the 14-day window, however far the server has folded', () => {
    expect(pruneCutoffMs(NOW - HOUR, NOW)).toBe(NOW - DEVICE_RAW_RETENTION_MS)
    expect(pruneCutoffMs(NOW - 20 * DAY, NOW)).toBe(NOW - 20 * DAY)
  })

  it('refuses a ring_ts if any one of its rows is too new or undated', () => {
    const cut = NOW - DAY
    const rows: OuraRawRow[] = [
      { ringTs: 1, tag: 1, eventName: 'a', bodyHex: 'x', measuredAt: cut - 1 },
      { ringTs: 1, tag: 2, eventName: 'a', bodyHex: 'y', measuredAt: cut + 1 }, // same ts, other epoch
      { ringTs: 2, tag: 1, eventName: 'a', bodyHex: 'z', measuredAt: cut - 1 },
      { ringTs: 2, tag: 2, eventName: 'a', bodyHex: 'w', measuredAt: null },
      { ringTs: 3, tag: 1, eventName: 'a', bodyHex: 'v', measuredAt: cut - 1 },
    ]
    expect(markableRingTs(rows, cut)).toEqual([3])
  })
})

describe('marking from the server watermark', () => {
  const W = NOW - HOUR                          // server folded through an hour ago
  const cut = W - ROLLED_UP_MARGIN_MS

  it('marks rows before the margin, and none inside it or after the watermark', async () => {
    insert({ ringTs: 10, measuredAt: cut - 3 * HOUR })   // well before
    insert({ ringTs: 11, measuredAt: cut - 1 })          // just before
    insert({ ringTs: 12, measuredAt: cut })              // on the line: not strictly before
    insert({ ringTs: 13, measuredAt: W - HOUR })         // inside the margin
    insert({ ringTs: 14, measuredAt: W + 10 * 60_000 })  // after the watermark

    const r = await runRawRolledUpMaintenance(deps({ watermark: W }))
    expect(r.outcome).toBe('done')
    expect(r.marked).toBe(2)
    expect(flags()).toEqual({ 10: 1, 11: 1, 12: 0, 13: 0, 14: 0 })
  })

  it('never marks an undated row', async () => {
    insert({ ringTs: 1, measuredAt: null })
    insert({ ringTs: 2, measuredAt: cut - DAY })
    await runRawRolledUpMaintenance(deps({ watermark: W }))
    expect(flags()).toEqual({ 1: 0, 2: 1 })
  })

  it('marks nothing and prunes nothing when no server rollup has completed', async () => {
    insert({ ringTs: 1, measuredAt: NOW - 30 * DAY })
    const d = deps({ watermark: null, isPruneEnabled: () => true })
    const r = await runRawRolledUpMaintenance(d)
    expect(r.outcome).toBe('no-watermark')
    expect(flags()).toEqual({ 1: 0 })
    expect(d.plugin!.markRolledUp).not.toHaveBeenCalled()
    expect(d.plugin!.pruneRaw).not.toHaveBeenCalled()
  })

  it('fails closed when the watermark read fails or is malformed', async () => {
    insert({ ringTs: 1, measuredAt: NOW - 30 * DAY })
    for (const readWatermark of [
      async () => { throw new Error('HTTP 500') },
      async () => ({ rolledThroughMs: 'soon' as unknown as number }),
    ]) {
      const d = deps({ readWatermark, isPruneEnabled: () => true })
      const r = await runRawRolledUpMaintenance(d)
      expect(r.outcome).toBe('watermark-error')
      expect(d.plugin!.getUnrolledRaw).not.toHaveBeenCalled()
      expect(d.plugin!.pruneRaw).not.toHaveBeenCalled()
    }
    expect(flags()).toEqual({ 1: 0 })
  })

  it('does nothing off-device', async () => {
    const r = await runRawRolledUpMaintenance(deps({ plugin: null }))
    expect(r.outcome).toBe('no-plugin')
  })

  it('leaves already-marked rows alone and counts only new marks', async () => {
    insert({ ringTs: 1, measuredAt: cut - DAY, rolledUp: 1 })
    insert({ ringTs: 2, measuredAt: cut - DAY })
    const r = await runRawRolledUpMaintenance(deps({ watermark: W }))
    expect(r.marked).toBe(1)
    expect(flags()).toEqual({ 1: 1, 2: 1 })
  })

  it('is idempotent: a second pass over the same watermark marks nothing more', async () => {
    for (let i = 0; i < 50; i++) insert({ ringTs: i, measuredAt: cut - DAY + i * 1000 })
    insert({ ringTs: 999, measuredAt: W })
    const a = await runRawRolledUpMaintenance(deps({ watermark: W }))
    const before = flags()
    const b = await runRawRolledUpMaintenance(deps({ watermark: W }))
    expect(a.marked).toBe(50)
    expect(b.marked).toBe(0)
    expect(flags()).toEqual(before)
  })

  // Runs can land out of order and a re-key resets the server's epoch. A watermark that goes
  // backwards narrows what the next pass marks; it never un-marks.
  it('never un-marks when the watermark goes backwards', async () => {
    insert({ ringTs: 1, measuredAt: W - 3 * DAY })
    insert({ ringTs: 2, measuredAt: W - 12 * HOUR })
    insert({ ringTs: 3, measuredAt: W - 10 * HOUR })
    await runRawRolledUpMaintenance(deps({ watermark: W }))
    expect(flags()).toEqual({ 1: 1, 2: 1, 3: 1 })

    insert({ ringTs: 4, measuredAt: W - 2 * DAY })        // arrives later, older than the new line
    const r = await runRawRolledUpMaintenance(deps({ watermark: W - 2.5 * DAY }))
    expect(r.marked).toBe(0)
    expect(flags()).toEqual({ 1: 1, 2: 1, 3: 1, 4: 0 })
  })

  // issue 2583: the bridge cannot show the synced flag, so the native mark filters on it.
  it('does not mark a row the server has not acknowledged, and marks the acknowledged one', async () => {
    insert({ ringTs: 1, measuredAt: NOW - 20 * DAY, synced: 0 })
    insert({ ringTs: 2, measuredAt: NOW - 20 * DAY, synced: 1 })
    const d = deps({ watermark: W })
    const r = await runRawRolledUpMaintenance(d)
    expect(r.marked).toBe(1)
    expect(flags()).toEqual({ 1: 0, 2: 1 })
    expect(d.plugin!.markRolledUp).not.toHaveBeenCalled()
  })

  it('marks the unsynced row once it is acknowledged, and is idempotent', async () => {
    insert({ ringTs: 1, measuredAt: NOW - 20 * DAY, synced: 0 })
    insert({ ringTs: 2, measuredAt: NOW - 20 * DAY, synced: 1 })
    await runRawRolledUpMaintenance(deps({ watermark: W }))
    db.exec('UPDATE raw SET synced = 1')
    const again = await runRawRolledUpMaintenance(deps({ watermark: W }))
    expect(again.marked).toBe(1)
    expect(flags()).toEqual({ 1: 1, 2: 1 })
    const third = await runRawRolledUpMaintenance(deps({ watermark: W }))
    expect(third.marked).toBe(0)
  })

  it('stops (no spin) when every candidate row is unacknowledged, and prunes none of them', async () => {
    insert({ ringTs: 1, measuredAt: NOW - 20 * DAY, synced: 0 })
    const d = deps({ watermark: W, isPruneEnabled: () => true })
    const r = await runRawRolledUpMaintenance(d)
    expect(r.marked).toBe(0)
    expect(d.plugin!.getUnrolledRaw).toHaveBeenCalledTimes(1)
    expect(flags()).toEqual({ 1: 0 })
    expect(count()).toBe(1)
  })

  it('never deletes or changes a row: the raw archive keeps every body', async () => {
    insert({ ringTs: 1, measuredAt: NOW - 20 * DAY, synced: 0 })
    insert({ ringTs: 2, measuredAt: NOW - 20 * DAY, synced: 1 })
    const q = 'SELECT ring_ts, tag, body_hex, measured_at, synced FROM raw ORDER BY ring_ts'
    const before = db.prepare(q).all()
    await runRawRolledUpMaintenance(deps({ watermark: W }))
    expect(db.prepare(q).all()).toEqual(before)
  })

  it('on an APK without the synced-only method, falls back to the unfiltered mark; the prune still spares the unsynced row', async () => {
    insert({ ringTs: 1, measuredAt: NOW - 20 * DAY, synced: 0 })
    insert({ ringTs: 2, measuredAt: NOW - 20 * DAY, synced: 1 })
    const r = await runRawRolledUpMaintenance(deps({ watermark: W, isPruneEnabled: () => true, plugin: nativePlugin({ legacy: true }) }))
    expect(r.pruned).toBe(1)
    const left = db.prepare('SELECT ring_ts, synced FROM raw').all() as { ring_ts: number; synced: number }[]
    expect(left).toEqual([{ ring_ts: 1, synced: 0 }])
  })

  it('falls back when the bridge rejects the synced-only method as unimplemented', async () => {
    insert({ ringTs: 1, measuredAt: NOW - 20 * DAY, synced: 1 })
    const d = deps({ watermark: W, plugin: nativePlugin({ unimplementedIfSynced: true }) })
    const r = await runRawRolledUpMaintenance(d)
    expect(r.error).toBeNull()
    expect(r.marked).toBe(1)
    expect(d.plugin!.markRolledUp).toHaveBeenCalledTimes(1)
  })

  it('reports any other synced-only failure instead of falling back', async () => {
    insert({ ringTs: 1, measuredAt: NOW - 20 * DAY, synced: 1 })
    const d = deps({ watermark: W, plugin: nativePlugin({ failMarkAfter: 0 }) })
    const r = await runRawRolledUpMaintenance(d)
    expect(r.error).toMatch(/process died/)
    expect(d.plugin!.markRolledUp).not.toHaveBeenCalled()
    expect(flags()).toEqual({ 1: 0 })
  })

  it('pages through a store larger than one page', async () => {
    const n = MARK_PAGE_SIZE * 2 + 37
    db.exec('BEGIN')
    for (let i = 0; i < n; i++) insert({ ringTs: i, measuredAt: cut - DAY + i })
    db.exec('COMMIT')
    const r = await runRawRolledUpMaintenance(deps({ watermark: W }))
    expect(r.marked).toBe(n)
    expect(r.pages).toBe(3)
  })

  // A re-key restarts the ring counter, so fresh rows can sort BEFORE old ones. The pass stops at a
  // page with nothing markable rather than spinning, and catches up once they age past the line.
  it('stops instead of spinning when the oldest ring_ts rows are all too new', async () => {
    insert({ ringTs: 1, measuredAt: W })                 // new epoch, low counter, fresh
    insert({ ringTs: 500, measuredAt: cut - DAY })       // old epoch, high counter, old
    const d = deps({ watermark: W })
    // Shrink the page to one row so the fresh row fills it.
    const getUnrolledRaw = d.plugin!.getUnrolledRaw
    d.plugin!.getUnrolledRaw = vi.fn(async () => getUnrolledRaw({ limit: 1 }))
    const r = await runRawRolledUpMaintenance(d)
    expect(r.marked).toBe(0)
    expect(r.pages).toBe(1)
    expect(flags()).toEqual({ 1: 0, 500: 0 })
  })

  // Each markRolledUp is one native transaction. A pass killed part-way leaves whole pages marked
  // and nothing half-marked; the next pass resumes and ends where an uninterrupted one would.
  it('survives dying half-way and the next pass finishes the job', async () => {
    const n = MARK_PAGE_SIZE * 3
    db.exec('BEGIN')
    for (let i = 0; i < n; i++) insert({ ringTs: i, measuredAt: cut - DAY + i })
    insert({ ringTs: n + 1, measuredAt: W })
    db.exec('COMMIT')

    const dying = await runRawRolledUpMaintenance(deps({ watermark: W, plugin: nativePlugin({ failMarkAfter: 1 }) }))
    expect(dying.error).toMatch(/process died/)
    expect(dying.marked).toBe(MARK_PAGE_SIZE)
    const marked = Number((db.prepare('SELECT count(*) AS n FROM raw WHERE rolled_up = 1').get() as { n: number }).n)
    expect(marked).toBe(MARK_PAGE_SIZE)

    const resumed = await runRawRolledUpMaintenance(deps({ watermark: W }))
    expect(resumed.marked).toBe(n - MARK_PAGE_SIZE)
    expect(flags()[n + 1]).toBe(0)
  })
})

describe('the prune flag', () => {
  const W = NOW - HOUR

  function seedOldAndNew() {
    insert({ ringTs: 1, measuredAt: NOW - 20 * DAY })
    insert({ ringTs: 2, measuredAt: NOW - 16 * DAY })
    insert({ ringTs: 3, measuredAt: NOW - 3 * DAY })   // marked, but inside the 14-day window
    insert({ ringTs: 4, measuredAt: NOW - HOUR })      // not marked: inside the margin
  }

  it('with the flag OFF, never calls pruneRaw and deletes nothing — it only counts', async () => {
    seedOldAndNew()
    const d = deps({ watermark: W, isPruneEnabled: () => false })
    const r = await runRawRolledUpMaintenance(d)
    expect(d.plugin!.pruneRaw).not.toHaveBeenCalled()
    expect(r.pruneEnabled).toBe(false)
    expect(r.pruned).toBe(0)
    expect(count()).toBe(4)
    expect(r.wouldPrune).toBe(2)
  })

  it('treats a throwing or non-boolean flag read as OFF', async () => {
    seedOldAndNew()
    for (const isPruneEnabled of [() => { throw new Error('storage') }, () => 'yes' as unknown as boolean]) {
      const d = deps({ watermark: W, isPruneEnabled })
      await runRawRolledUpMaintenance(d)
      expect(d.plugin!.pruneRaw).not.toHaveBeenCalled()
    }
    expect(count()).toBe(4)
  })

  // The estimate the owner reads must cover rows marked by EARLIER passes too — on the device the
  // first pass marks almost everything and later ones only a few hours' worth.
  it('carries the would-prune count across passes', async () => {
    seedOldAndNew()
    await runRawRolledUpMaintenance(deps({ watermark: W }))
    const second = await runRawRolledUpMaintenance(deps({ watermark: W }))
    expect(second.marked).toBe(0)
    expect(second.wouldPrune).toBe(2)
  })

  it('with the flag ON, deletes marked, backed-up rows past the 14-day window and nothing else', async () => {
    seedOldAndNew()
    const d = deps({ watermark: W, isPruneEnabled: () => true })
    const r = await runRawRolledUpMaintenance(d)
    expect(d.plugin!.pruneRaw).toHaveBeenCalledWith({ olderThanMs: NOW - DEVICE_RAW_RETENTION_MS, reserveBytes: 0 })
    expect(r.pruned).toBe(2)
    expect((db.prepare('SELECT ring_ts FROM raw ORDER BY ring_ts').all() as { ring_ts: number }[]).map(x => x.ring_ts)).toEqual([3, 4])
    // The pruned days leave the estimate, so the next OFF reading is not inflated by them.
    expect(Object.values(histogram).reduce((a, b) => a + b, 0)).toBe(1)
  })

  it('logs counts only, never a frame', async () => {
    seedOldAndNew()
    const lines: string[] = []
    await runRawRolledUpMaintenance(deps({ watermark: W, log: l => lines.push(l) }))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/prune OFF: would delete about 2 row/)
    expect(lines[0]).not.toMatch(/\bb\d+\b/)      // no body_hex
  })
})
