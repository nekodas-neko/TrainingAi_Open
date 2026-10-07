// The one TypeScript runner for the sync parity vectors (#2490).
//
// Executes a vector from `packages/shared/src/sync/vectors/` against the shipped code: the real
// `lib/sqlite/migrations.ts` schema on `node:sqlite` (see `./node-sqlite-service.ts`), the real
// `SQLiteLocalStore`, and the real `pullDelta` / `pushMutations`. Three things are stood in for —
// the SQLite connection, the network (which answers only what the vector scripted) and
// `getLocalStore`'s choice of store — and none of them is sync behaviour.
//
// The calling test must mock the SQLite service and `getLocalStore` before anything imports the
// store; `../parity-vectors.test.ts` shows both.
import { expect, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  SyncVectorFileSchema, VECTOR_USER_ID,
  type SyncVector,
} from '@trainingai/shared/sync/vectors/schema'
import { openVectorDb, vectorDb } from './node-sqlite-service'
import { getLocalStore } from '../../index'
import { pullDelta, pushMutations, _resetSyncBackoff } from '../../sync-engine'

export const VECTOR_DIR = join(process.cwd(), 'packages/shared/src/sync/vectors')

/** Every vector in every `*.json` file of the vector directory, schema-validated. */
export function loadVectors(): SyncVector[] {
  const files = readdirSync(VECTOR_DIR).filter(f => f.endsWith('.json')).sort()
  const all: SyncVector[] = []
  for (const f of files) {
    const parsed = SyncVectorFileSchema.safeParse(JSON.parse(readFileSync(join(VECTOR_DIR, f), 'utf8')))
    if (!parsed.success) throw new Error(`${f}: ${parsed.error.message}`)
    all.push(...parsed.data.vectors)
  }
  return all
}

/**
 * Every delta array the pull mapper reads. A vector's page names only the arrays it needs; several
 * mapper lines call `.map` with no `?? []`, so an absent array would fail the vector for a reason
 * that has nothing to do with what it is testing. The rosters are deliberately NOT filled: an absent
 * roster means "prune nothing" and an empty one means "the user has none", and a vector must say
 * which it means.
 */
const DELTA_ARRAYS = [
  'programs', 'programSessions', 'sessionExercises', 'schedules', 'scheduleDays', 'progressionStyles',
  'styleSets', 'bodyMetrics', 'sleepSessions', 'moodLogs', 'activityLogs', 'fitnessTests',
  'prescribedRuns', 'workoutSessions', 'exerciseLogs', 'setLogs', 'personalRecords', 'ouraDaily',
  'ouraDailySummary', 'ouraDailyDerived', 'foodItems', 'foodLogs', 'supplements', 'supplementLogs',
  'injuries', 'dayCheckins', 'mealPlans', 'mealPlanVariants', 'mealPlanMeals', 'planMealAnswers',
] as const

/** A seed value as SQLite stores it: booleans as 0/1, objects and arrays as JSON text. */
function storable(v: unknown): unknown {
  if (v === undefined) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v !== null && typeof v === 'object') return JSON.stringify(v)
  return v
}

function seed(tables: Record<string, Record<string, unknown>[]>): void {
  const db = vectorDb()
  for (const [table, rows] of Object.entries(tables)) {
    rows.forEach((raw, i) => {
      const row = table === 'mutations_outbox'
        ? {
            user_id: VECTOR_USER_ID, status: 'pending', attempts: 0,
            // Seeded entries drain in the order they are listed unless a vector says otherwise.
            created_at: `2000-01-01T00:00:00.${String(i).padStart(3, '0')}Z`,
            ...raw,
          }
        : raw
      const cols = Object.keys(row)
      db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
        .run(...(cols.map(c => storable(row[c])) as never[]))
    })
  }
}

type Scripted = { pull: unknown[]; push: unknown[]; pushed: Record<string, unknown>[] }

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

/** The network, answering only from the script. An unscripted request is a vector error. */
function network(script: Scripted) {
  return vi.fn(async (url: string, init?: { body?: string }) => {
    if (url.startsWith('/api/sync/pull')) {
      const page = script.pull.shift() as { status: number; body?: Record<string, unknown> } | undefined
      if (!page) throw new Error(`parity runner: unscripted pull request ${url}`)
      if (page.status !== 200) return json(page.status, { error: 'scripted failure' })
      const body: Record<string, unknown> = { ...page.body }
      for (const k of DELTA_ARRAYS) body[k] ??= []
      return json(200, body)
    }
    if (url === '/api/sync/push') {
      const answer = script.push.shift() as { status: number; errors: { id: string; error: string; retryable?: boolean }[] } | undefined
      if (!answer) throw new Error('parity runner: unscripted push request')
      const sent = (JSON.parse(String(init?.body)) as { mutations: Record<string, unknown>[] }).mutations
      script.pushed.push(...sent)
      if (answer.status !== 200) return json(answer.status, { error: 'scripted failure' })
      const byId = new Map(sent.map(m => [String(m.id), m]))
      return json(200, {
        processed: sent.length - answer.errors.length,
        errors: answer.errors.map(e => {
          const m = byId.get(e.id)
          if (!m) throw new Error(`parity runner: scripted error for ${e.id}, which this request did not carry`)
          return { id: e.id, domain: m.domain, date: m.date, error: e.error, ...(e.retryable !== undefined ? { retryable: e.retryable } : {}) }
        }),
      })
    }
    throw new Error(`parity runner: unexpected request ${url}`)
  })
}

const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) as Record<string, unknown> : v as Record<string, unknown>)

function expectMutations(label: string, actual: Record<string, unknown>[], expected: NonNullable<SyncVector['expect']['outbox']>) {
  expect(actual.map(m => m.domain), `${label}: domains, in order`).toEqual(expected.map(m => m.domain))
  expected.forEach((e, i) => {
    const a = actual[i]
    if (e.date !== undefined) expect(a.date, `${label}[${i}].date`).toBe(e.date)
    if (e.status !== undefined) expect(a.status, `${label}[${i}].status`).toBe(e.status)
    if (e.attempts !== undefined) expect(Number(a.attempts), `${label}[${i}].attempts`).toBe(e.attempts)
    if (e.payload !== undefined) expect(parse(a.payload), `${label}[${i}].payload`).toMatchObject(e.payload)
  })
}

/** Run one vector to completion and assert its expectations. Throws on the first mismatch. */
export async function runVector(v: SyncVector): Promise<void> {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(v.now))
  const script: Scripted = { pull: [], push: [], pushed: [] }
  const fetchMock = network(script)
  vi.stubGlobal('fetch', fetchMock)
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    _resetSyncBackoff()
    openVectorDb()
    seed(v.seed)
    const store = getLocalStore(VECTOR_USER_ID)
    if (!store) throw new Error('parity runner: getLocalStore returned null')

    let lastPull: Awaited<ReturnType<typeof pullDelta>> | undefined
    for (const step of v.steps) {
      if (step.op === 'local') {
        const fn = (store as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[step.action]
        if (typeof fn !== 'function') throw new Error(`parity runner: the store has no ${step.action}`)
        // `queueMutation` is user-scoped; a vector cannot know the runner's user id by any other route.
        const args = step.action === 'queueMutation'
          ? [{ userId: VECTOR_USER_ID, ...(step.args[0] as object) }]
          : step.args
        await fn.apply(store, args)
      } else if (step.op === 'pull') {
        script.pull.push(...step.pages)
        lastPull = await pullDelta(VECTOR_USER_ID, true, step.fullResync ?? false, step.restore ?? false)
        expect(script.pull, 'pull: scripted pages left unread').toEqual([])
      } else {
        script.push.push(...step.responses)
        await pushMutations(VECTOR_USER_ID)
        expect(script.push, 'push: scripted responses left unused').toEqual([])
      }
    }

    const db = vectorDb()
    for (const t of v.expect.tables) {
      const where = Object.entries(t.where ?? {})
      const clause = where.length
        ? ` WHERE ${where.map(([c, val]) => (val === null ? `${c} IS NULL` : `${c} = ?`)).join(' AND ')}`
        : ''
      const params = where.filter(([, val]) => val !== null).map(([, val]) => storable(val))
      const rows = db.prepare(
        `SELECT ${t.columns.join(', ')} FROM ${t.table}${clause} ORDER BY ${t.orderBy ?? t.columns[0]}`,
      ).all(...(params as never[]))
      expect(rows.map(r => ({ ...r })), `table ${t.table}`).toEqual(t.rows.map(r => {
        const out: Record<string, unknown> = {}
        for (const c of t.columns) out[c] = storable(r[c])
        return out
      }))
    }
    if (v.expect.outbox) {
      const outbox = db.prepare(`SELECT * FROM mutations_outbox ORDER BY created_at, rowid`).all() as Record<string, unknown>[]
      expectMutations('outbox', outbox, v.expect.outbox)
    }
    if (v.expect.pushed) expectMutations('pushed', script.pushed, v.expect.pushed)
    if (v.expect.pull) {
      const p = v.expect.pull
      if (p.result === 'failed') expect(lastPull, 'pull result').toBeNull()
      else {
        expect(lastPull, 'pull result').not.toBeNull()
        if (p.flags) expect(lastPull!.domains, 'pull flags').toMatchObject(p.flags)
        if (p.synced !== undefined) expect(lastPull!.synced, 'pull synced count').toBe(p.synced)
        if (p.hasMore !== undefined) expect(lastPull!.hasMore, 'pull hasMore').toBe(p.hasMore)
      }
    }
    if (v.expect.cursor) expect((await store.getLastSyncAt()).toISOString(), 'cursor').toBe(v.expect.cursor)
  } finally {
    errors.mockRestore()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  }
}
