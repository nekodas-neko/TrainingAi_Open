// Q-475: with the database unreachable, `pushMutations` must mark its per-item errors `retryable`.
//
// The wire shape is the whole problem. Because the per-mutation catch is what makes the poison-pill
// rule work, an outage arrives at the client as `HTTP 200 {errors:[…]}` — identical to a validation
// rejection — so the client reset its 5xx backoff and counted every mutation towards
// MAX_MUTATION_ATTEMPTS. At 30 s → 2 m → 8 m → 32 m that dead-letters the entire outbox after
// ~42.5 minutes of downtime.
//
// This points the repository at a port with nothing listening rather than stopping the shared local
// Postgres: a `pg_ctl stop` mid-run would fail every other DB-touching test file in the same
// parallel run. The resulting error is the same ECONNREFUSED-under-DrizzleQueryError shape measured
// against a genuinely stopped server, and it needs no DATABASE_URL, so this runs in CI too.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from '../schema'

// Port 1 is privileged and never bound — a connection attempt is refused immediately.
const deadPool = new Pool({
  host: '127.0.0.1', port: 1, database: 'nope', user: 'nope',
  connectionTimeoutMillis: 2000, max: 1,
})
const deadDb = drizzle(deadPool, { schema })

vi.mock('@/lib/data/postgres/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../client')>()
  return { ...actual, getDb: () => deadDb, getPool: () => deadPool }
})

const USER = '00000000-0000-4000-8000-000000000475'

describe('pushMutations against an unreachable database (Q-475)', () => {
  let repo: import('../adapter').PostgresWorkoutRepository

  beforeAll(async () => {
    const { PostgresWorkoutRepository } = await import('../adapter')
    repo = new PostgresWorkoutRepository()
    deadPool.on('error', () => {})
  })

  afterAll(async () => { await deadPool.end().catch(() => {}) })

  it('marks every per-item error retryable, so the client does not dead-letter a working queue', async () => {
    const result = await repo.pushMutations(USER, [
      { id: 'ob-1', domain: 'body_metrics', date: '2026-08-09', payload: { weightKg: 81 } },
      { id: 'ob-2', domain: 'body_metrics', date: '2026-08-10', payload: { weightKg: 82 } },
    ])

    expect(result.processed).toBe(0)
    expect(result.errors).toHaveLength(2)
    // Still keyed by outbox id — the confirm path depends on it, outage or not.
    expect(result.errors.map(e => e.id).sort()).toEqual(['ob-1', 'ob-2'])
    expect(result.errors.every(e => e.retryable === true)).toBe(true)
  }, 30_000)

  it('still reports a genuinely bad payload as NOT retryable, even while the database is down', async () => {
    // The validation branch rejects before any query, so this error is about the mutation and must
    // keep dead-lettering. An outage must not turn every failure into an infinite retry.
    const result = await repo.pushMutations(USER, [
      { id: 'ob-3', domain: 'plan_meal_answers', date: '2026-08-09', payload: {} },
    ])

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].error).toContain('missing planMealId')
    expect(result.errors[0].retryable).toBeUndefined()
  }, 30_000)
})
