// BF-203a Task 6′. Before anything writes an estimate, the device must read one correctly: it is not
// a decline, its macros survive a pull, and a decline made over it replaces it rather than sitting
// beside it. Runs the shipped SQLiteLocalStore against a table built from the real MIGRATIONS.
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

const DAY = '2026-09-30'
const live = () => db.current!.prepare(
  `SELECT id, answer, est_calories, sync_status FROM plan_meal_answers WHERE log_date = ? AND deleted_at IS NULL`,
).all(DAY) as Record<string, unknown>[]

beforeEach(() => {
  db.current = new DatabaseSync(':memory:')
  for (const m of MIGRATIONS) for (const s of m.statements) { try { db.current.exec(s) } catch { /* tolerated, as the service does */ } }
  for (const c of RECONCILE_COLUMNS) { try { db.current.exec(c.ddl) } catch { /* already present */ } }
})

const estimate = {
  id: 'est-1', planMealId: 'meal-1', logDate: DAY, answer: 'estimated',
  answeredAt: '2026-09-30T03:00:00Z', updatedAt: '2026-09-30T03:00:00Z', deletedAt: null,
  estCalories: 480, estProteinG: 30, estCarbsG: 40, estFatG: 10, estBiasKcal: 0, estBasis: 'planA',
}

describe('estimated answers on the device (BF-203a)', () => {
  it('reads back an estimate with its macros', async () => {
    const store = new SQLiteLocalStore()
    await store.upsertPlanMealAnswer(estimate)
    const [row] = await store.getPlanMealAnswers(DAY)
    expect(row).toMatchObject({ answer: 'estimated', estCalories: 480, estProteinG: 30, estBasis: 'planA' })
  })

  it('replaces a live estimate when the user declines the meal, instead of adding a second row', async () => {
    const store = new SQLiteLocalStore()
    await store.upsertPlanMealAnswer(estimate)
    await store.upsertPlanMealAnswer({
      id: 'decline-1', planMealId: 'meal-1', logDate: DAY, answer: 'no',
      answeredAt: '2026-09-30T04:00:00Z', updatedAt: '2026-09-30T04:00:00Z', deletedAt: null,
    })
    expect(live()).toEqual([{ id: 'est-1', answer: 'no', est_calories: null, sync_status: 'pending' }])
  })

  it('carries estimate macros through a pull', async () => {
    const store = new SQLiteLocalStore()
    await store.applyDelta({ planMealAnswers: [{ ...estimate, id: 'srv-1' }] } as never)
    const [row] = await store.getPlanMealAnswers(DAY)
    expect(row).toMatchObject({ id: 'srv-1', answer: 'estimated', estCalories: 480, estBiasKcal: 0 })
  })

  // The Nutrition hook turns answers into the DECLINED set. An estimate in that set would hide the
  // very prompt it stands in for.
  it('lets only a "no" answer reach the declined set, on both read branches', () => {
    const hook = readFileSync(join(process.cwd(), 'app/nutrition/use-plan-meal-logging.ts'), 'utf8')
    const calls = hook.match(/applyAnswers\(date, [^\n]+/g) ?? []
    expect(calls).toHaveLength(2)
    for (const c of calls) expect(c).toMatch(/=== 'no'/)
  })
})
