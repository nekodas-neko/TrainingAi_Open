// The raw-store console printed correct numbers that nobody could read (Q-538).
//
// The owner took the first-ever device measurement on 2026-08-18 — 209,326 rows, 0 rolled up,
// 31.2 MB — and establishing that `0 rolled up` was the FAULT took a source trace: `pruneRaw`'s
// predicate is `rolled_up = 1 AND synced = 1 AND measured_at < ?`, so with nothing marked rolled up
// the documented 14-day window can delete no row at all. These are the findings the numbers already
// supported, said out loud.
import { describe, it, expect } from 'vitest'
import { rawStoreFindings, AUTO_BACKUP_QUOTA_BYTES } from '../raw-store-health'

const MB = 1024 * 1024

describe('raw store findings', () => {
  // The real reading, verbatim. Both warnings are true of it, which is the point: neither was
  // visible on the console that produced those numbers.
  it('reads the 2026-08-18 device measurement as two faults', () => {
    const f = rawStoreFindings({ totalRows: 209_326, unrolledRows: 209_326, bytes: 31.2 * MB, lowDisk: false })
    expect(f.map(x => x.level)).toEqual(['warn', 'warn'])
    expect(f[0].text).toMatch(/cannot delete any/)
    expect(f[1].text).toMatch(/Auto Backup/)
  })

  it('says nothing about an empty store', () => {
    expect(rawStoreFindings({ totalRows: 0, unrolledRows: 0, bytes: 0, lowDisk: false })).toEqual([])
  })

  // "Some rolled up" is the state that looks healthy and can still be falling behind — the
  // retention decision's own warning about a silent lag.
  it('reports a partial rollup as a note, not a fault', () => {
    const f = rawStoreFindings({ totalRows: 1000, unrolledRows: 250, bytes: 1 * MB, lowDisk: false })
    expect(f).toHaveLength(1)
    expect(f[0].level).toBe('note')
    expect(f[0].text).toMatch(/25% of rows are still unrolled/)
  })

  it('is silent when everything is rolled up and small', () => {
    expect(rawStoreFindings({ totalRows: 1000, unrolledRows: 0, bytes: 1 * MB, lowDisk: false })).toEqual([])
  })

  it('flags the backup quota at the boundary, not below it', () => {
    const at = { totalRows: 10, unrolledRows: 0, bytes: AUTO_BACKUP_QUOTA_BYTES, lowDisk: false }
    expect(rawStoreFindings(at)).toEqual([])
    expect(rawStoreFindings({ ...at, bytes: AUTO_BACKUP_QUOTA_BYTES + 1 })).toHaveLength(1)
  })

  it('flags a shedding service, which loses frames outright', () => {
    const f = rawStoreFindings({ totalRows: 100, unrolledRows: 0, bytes: 1 * MB, lowDisk: true })
    expect(f).toHaveLength(1)
    expect(f[0].text).toMatch(/frames are being lost/)
  })

  // A store that is unbounded AND unbacked AND shedding should say all three, not the first.
  it('reports every fault that holds at once', () => {
    const f = rawStoreFindings({ totalRows: 500_000, unrolledRows: 500_000, bytes: 80 * MB, lowDisk: true })
    expect(f).toHaveLength(3)
    expect(f.every(x => x.level === 'warn')).toBe(true)
  })
})
