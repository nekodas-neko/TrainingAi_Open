// The backfill must fetch HR far enough past a session's last set to re-derive every stored drop, and
// must not treat a missing series as a measurement that clears them.
import { describe, it, expect } from 'vitest'
import { backfillSetHrr1 } from '../backfill-set-hrr1'

const END = 1_700_000_000_000
const row = {
  setLogId: 's1', workoutSessionId: 'w1', loggedAt: new Date(END), setEndMs: END,
  hrr1Bpm: 60, restAdequate: true, drop30s: 30, drop60s: 60, drop90s: 90, drop120s: 120,
}
/** 1 Hz strap from the set end to 130 s after, falling 1 bpm a second from 150. */
const series = Array.from({ length: 131 }, (_, s) => ({ timestamp: new Date(END + s * 1000), bpm: 150 - s, source: 'chest_strap' }))

const run = (readings: typeof series) => {
  const writes: unknown[] = []
  const repo = {
    listSetHrStatsForHrr1Backfill: async () => [row],
    // Like the real read: only what falls inside the requested window.
    getHrForWindow: async (_u: string, from: Date, to: Date) =>
      readings.filter(r => r.timestamp >= from && r.timestamp <= to),
    writeSetHrr1: async (_u: string, updates: readonly unknown[]) => { writes.push(...updates); return updates.length },
  }
  return backfillSetHrr1({ repo, userId: 'u', tz: 'Australia/Brisbane', dryRun: false }).then(r => ({ r, writes }))
}

describe('backfillSetHrr1 window', () => {
  it("the last set of a session keeps its 90 s and 120 s drops", async () => {
    const { r, writes } = await run(series)
    expect(writes).toEqual([])
    expect(r.summary.rowsChanged).toBe(0)
  })

  it('a session with no readings changes nothing, however much is stored', async () => {
    const { r, writes } = await run([])
    expect(writes).toEqual([])
    expect(r.summary.rowsChanged).toBe(0)
    expect(r.summary.rowsWithNoSeries).toBe(1)
  })
})
