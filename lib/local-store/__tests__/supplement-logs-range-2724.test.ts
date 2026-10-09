// issue 2724 — `getSupplementLogsRange`, run as real SQL on node:sqlite against the shipped schema
// and the shipped `SQLiteLocalStore` (the same harness the sync parity vectors use). Native SQLite
// on the device runs the same statement; only the driver differs.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/sqlite/sqlite-service', () => import('./parity/node-sqlite-service'))

import { SQLiteLocalStore } from '../sqlite-backend'
import { openVectorDb, vectorDb } from './parity/node-sqlite-service'

const SUB = 'sub-a'
const OTHER = 'sub-b'

function insert(id: string, supplementId: string, logDate: string, extra: Record<string, unknown> = {}) {
  const row = {
    id, supplement_id: supplementId, log_date: logDate, source: 'manual', updated_at: '2026-10-01T00:00:00.000Z',
    sync_status: 'synced', deleted_at: null, taken_at: null, amount: 1, unit: 'mg', ...extra,
  }
  const cols = Object.keys(row)
  vectorDb().prepare(`INSERT INTO supplement_logs (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...(Object.values(row) as never[]))
}

describe('getSupplementLogsRange (issue 2724)', () => {
  let store: SQLiteLocalStore
  beforeEach(() => { openVectorDb(); store = new SQLiteLocalStore() })

  it('is empty when nothing is in range', async () => {
    insert('a', SUB, '2026-09-01')
    expect(await store.getSupplementLogsRange('2026-10-01', '2026-10-31')).toEqual([])
  })

  it('includes both ends of the range and nothing outside it', async () => {
    for (const [id, d] of [['a', '2026-09-30'], ['b', '2026-10-01'], ['c', '2026-10-15'], ['d', '2026-10-31'], ['e', '2026-11-01']]) {
      insert(id, SUB, d)
    }
    const rows = await store.getSupplementLogsRange('2026-10-01', '2026-10-31')
    expect(rows.map(r => r.id)).toEqual(['b', 'c', 'd'])
  })

  it('returns oldest first, then by taken_at, whatever the insert order', async () => {
    insert('late', SUB, '2026-10-05')
    insert('pm', SUB, '2026-10-02', { taken_at: '2026-10-02T09:00:00.000Z' })
    insert('am', SUB, '2026-10-02', { taken_at: '2026-10-02T01:00:00.000Z', source: 'meal', source_ref: 'f1' })
    const rows = await store.getSupplementLogsRange('2026-10-01', '2026-10-31')
    expect(rows.map(r => r.id)).toEqual(['am', 'pm', 'late'])
  })

  it('leaves out tombstoned rows', async () => {
    insert('live', SUB, '2026-10-02')
    insert('gone', SUB, '2026-10-03', { deleted_at: '2026-10-04T00:00:00.000Z', sync_status: 'pending' })
    expect((await store.getSupplementLogsRange('2026-10-01', '2026-10-31')).map(r => r.id)).toEqual(['live'])
  })

  it('narrows to one supplement when asked, and reads all when not', async () => {
    insert('a', SUB, '2026-10-02')
    insert('b', OTHER, '2026-10-02')
    expect((await store.getSupplementLogsRange('2026-10-01', '2026-10-31', SUB)).map(r => r.id)).toEqual(['a'])
    expect((await store.getSupplementLogsRange('2026-10-01', '2026-10-31')).map(r => r.id).sort()).toEqual(['a', 'b'])
  })

  it('carries a dose logged here that has not synced yet, with its time and amount', async () => {
    insert('offline', SUB, '2026-10-06', { sync_status: 'pending', taken_at: '2026-10-06T07:30:00.000Z', amount: 2.5, unit: 'mg' })
    const [row] = await store.getSupplementLogsRange('2026-10-01', '2026-10-31', SUB)
    expect(row).toMatchObject({ id: 'offline', syncStatus: 'pending', takenAt: '2026-10-06T07:30:00.000Z', amount: 2.5, unit: 'mg', logDate: '2026-10-06' })
  })

  it('agrees with the single-day read on the same day', async () => {
    insert('a', SUB, '2026-10-02', { taken_at: '2026-10-02T01:00:00.000Z', vial_strength_mg: 10 })
    expect(await store.getSupplementLogsRange('2026-10-02', '2026-10-02')).toEqual(await store.getSupplementLogs('2026-10-02'))
  })
})
