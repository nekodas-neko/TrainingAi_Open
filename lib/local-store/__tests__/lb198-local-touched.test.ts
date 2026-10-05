// LB-198. The device side: the flag round-trips through the shipped store, UNKNOWN stays unknown,
// and a pull carries it. The sheet's source pin keeps it from being inferred from Save.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const db = { current: null as DatabaseSync | null }
vi.mock('@/lib/sqlite/sqlite-service', () => ({
  runSQL: vi.fn(async (sql: string, p: unknown[] = []) => { db.current!.prepare(sql).run(...(p as never[])) }),
  querySQL: vi.fn(async (sql: string, p: unknown[] = []) => db.current!.prepare(sql).all(...(p as never[]))),
  beginTransaction: vi.fn(), commitTransaction: vi.fn(), rollbackTransaction: vi.fn(),
  isSQLiteAvailable: () => true, isLocalStoreDead: () => false,
}))

import { SQLiteLocalStore } from '../sqlite-backend'
import { MIGRATIONS, RECONCILE_COLUMNS } from '@/lib/sqlite/migrations'
import type { LocalDayCheckin } from '../types'

beforeEach(() => {
  db.current = new DatabaseSync(':memory:')
  for (const m of MIGRATIONS) for (const s of m.statements) { try { db.current.exec(s) } catch { /* tolerated, as the service does */ } }
  for (const c of RECONCILE_COLUMNS) { try { db.current.exec(c.ddl) } catch { /* already present */ } }
})

const base = (over: Partial<LocalDayCheckin>): LocalDayCheckin => ({
  logDate: '2026-10-05', phase: 'morning',
  physicalTiredness: null, mentalDrain: null, barelyMoved: null, hydration: null, lateHeavyMeal: null,
  wakeMood: null, perceivedRecovery: null, motivation: null, sleepQualityFeel: null, restingSoreness: null,
  illnessContext: null, perceivedRecoveryTouched: false, sleepQualityFeelTouched: false,
  vsNormal: null, soreMuscles: [], journal: null, updatedAt: '2026-10-05T01:00:00Z', deletedAt: null, syncStatus: 'pending',
  ...over,
} as LocalDayCheckin)

describe('vs_normal_touched on the device (LB-198)', () => {
  it('round-trips true, false and unknown without collapsing unknown to false', async () => {
    const store = new SQLiteLocalStore()
    for (const [touched, expected] of [[true, true], [false, false], [null, null], [undefined, null]] as const) {
      await store.upsertDayCheckin(base({ vsNormal: 'same', vsQuestion: 2, vsNormalTouched: touched as boolean | null }))
      expect((await store.getDayCheckin('2026-10-05', 'morning'))?.vsNormalTouched, String(touched)).toBe(expected)
    }
  })

  it('has no flag without an answer', async () => {
    const store = new SQLiteLocalStore()
    await store.upsertDayCheckin(base({ vsNormal: null, vsNormalTouched: true }))
    expect((await store.getDayCheckin('2026-10-05', 'morning'))?.vsNormalTouched).toBeNull()
  })

  it('carries the flag through a pull', async () => {
    const store = new SQLiteLocalStore()
    await store.applyDelta({ dayCheckins: [{ ...base({ vsNormal: 'better', vsQuestion: 2, vsNormalTouched: true }), syncStatus: 'synced' }] } as never)
    expect((await store.getDayCheckin('2026-10-05', 'morning'))?.vsNormalTouched).toBe(true)
  })
})

describe('the morning sheet sets the flag from a tap, never from Save (LB-198)', () => {
  const src = readFileSync(join(process.cwd(), 'components/morning-checkin-sheet.tsx'), 'utf8')
  it('flips it in the picker onChange', () => {
    expect(src).toMatch(/onChange=\{v => \{[^}]*setVsTouched\(true\)[^}]*setVsNormal\(v\)/)
  })
  it('never sets it true anywhere else', () => {
    expect([...src.matchAll(/setVsTouched\(true\)/g)]).toHaveLength(1)
  })
  it('seeds a fresh sheet as untouched and sends the flag only beside an answer', () => {
    expect(src).toMatch(/useState<boolean \| null>\(false\)/)
    expect(src).toMatch(/vsNormal != null && vsTouched != null \? \{ vsNormalTouched: vsTouched \}/)
  })
})
