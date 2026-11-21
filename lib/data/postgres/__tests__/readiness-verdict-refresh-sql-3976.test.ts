// #3976: the adapter's refresh UPDATE carries `response_state = 'none'` in the statement itself, so
// an answer that lands between the caller's read and this write is never overwritten.
//
// The real-database proof is `lib/health/__tests__/readiness-verdict-refresh-db-3976.test.ts`, which
// skips without DATABASE_URL. This one runs in CI: drizzle over a client that records what it is
// sent and returns no rows, so it checks the SQL the adapter issues, not what Postgres does with it.
import { describe, it, expect, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from '../schema'

const sent: { text: string; values: unknown[] }[] = []
const recordingClient = {
  query: vi.fn(async (q: { text: string; values?: unknown[] } | string, values?: unknown[]) => {
    const text = typeof q === 'string' ? q : q.text
    sent.push({ text, values: (typeof q === 'string' ? values : q.values) ?? values ?? [] })
    return { rows: [], rowCount: 0, fields: [], command: 'UPDATE' }
  }),
}
const recordingDb = drizzle(recordingClient as never, { schema })

vi.mock('@/lib/data/postgres/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../client')>()
  return { ...actual, getDb: () => recordingDb }
})

describe('refreshUnansweredReadinessVerdict SQL (#3976)', () => {
  it('updates only the day’s row whose response_state is still none, and never writes response_state', async () => {
    const { PostgresWorkoutRepository } = await import('../adapter')
    const repo = new PostgresWorkoutRepository()
    const updated = await repo.refreshUnansweredReadinessVerdict('00000000-0000-4000-8000-000000003976', {
      date: '2026-11-21', verdict: 'normal', score: 60, band: { median: 62, low: 58, high: 66 },
      baselineDays: 28, baselineSameVersionDays: 28, contributors: {}, readinessModelVersion: 'v-test', modelVersion: 4,
    } as never)

    expect(updated).toBe(false)
    expect(sent).toHaveLength(1)
    const { text, values } = sent[0]
    expect(text).toMatch(/^update "readiness_verdicts" set /)
    const [setClause, whereClause] = text.split(/ where /)
    expect(whereClause).toMatch(/"readiness_verdicts"\."response_state" = \$\d+/)
    const param = Number(/"response_state" = \$(\d+)/.exec(whereClause)![1])
    expect(values[param - 1]).toBe('none')
    expect(whereClause).toMatch(/"readiness_verdicts"\."user_id" = \$\d+/)
    expect(whereClause).toMatch(/"readiness_verdicts"\."date" = \$\d+/)
    expect(setClause).not.toMatch(/response_state/)
  })
})
