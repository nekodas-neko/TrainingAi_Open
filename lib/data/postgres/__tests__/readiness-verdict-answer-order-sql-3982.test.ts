// #3982: `setReadinessVerdictResponse` carries the "an answer is never taken back" rule in the UPDATE
// itself: rated may replace none or dismissed, dismissed may replace only none. Runs in CI without a
// database: drizzle over a client that records what it is sent, so it checks the SQL the adapter
// issues. The real-database proof for each order is `readiness-verdict-answer-order-3982.test.ts`.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from '../schema'

const sent: { text: string; values: unknown[] }[] = []
let updateRows: unknown[] = []
let selectRows: unknown[] = []
const recordingClient = {
  query: vi.fn(async (q: { text: string; values?: unknown[]; rowMode?: string } | string, values?: unknown[]) => {
    const text = typeof q === 'string' ? q : q.text
    sent.push({ text, values: (typeof q === 'string' ? values : q.values) ?? values ?? [] })
    const rows = /^update/i.test(text) ? updateRows : selectRows
    return { rows: rows.map(r => [r]), rowCount: rows.length, fields: [{ name: 'id' }], command: 'X' }
  }),
}
const recordingDb = drizzle(recordingClient as never, { schema })

vi.mock('@/lib/data/postgres/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../client')>()
  return { ...actual, getDb: () => recordingDb }
})

const USER = '00000000-0000-4000-8000-000000003982'

async function answer(state: 'rated' | 'dismissed') {
  const { PostgresWorkoutRepository } = await import('../adapter')
  return new PostgresWorkoutRepository().setReadinessVerdictResponse(USER, '2026-11-21', state)
}

/** The states the UPDATE's WHERE lets through, read from the SQL it was sent. */
function allowedStates(): string[] {
  const { text, values } = sent[0]
  const where = text.split(/ where /)[1]
  const m = /"response_state" in \(([^)]*)\)/.exec(where)
  if (!m) return []
  return [...m[1].matchAll(/\$(\d+)/g)].map(x => String(values[Number(x[1]) - 1]))
}

describe('setReadinessVerdictResponse SQL (#3982)', () => {
  beforeEach(() => { sent.length = 0; updateRows = []; selectRows = [] })

  it('"rated" replaces only none or dismissed, in the UPDATE itself', async () => {
    updateRows = [{ id: 1 }]
    expect(await answer('rated')).toBe(true)
    expect(sent).toHaveLength(1)                      // changed a row: no follow-up read
    expect(sent[0].text).toMatch(/^update "readiness_verdicts" set /)
    expect(allowedStates().sort()).toEqual(['dismissed', 'none'])
    expect(sent[0].text).toMatch(/"user_id" = \$\d+/)
    expect(sent[0].text).toMatch(/"date" = \$\d+/)
  })

  it('"dismissed" replaces only none', async () => {
    updateRows = [{ id: 1 }]
    expect(await answer('dismissed')).toBe(true)
    expect(allowedStates()).toEqual(['none'])
  })

  it('a change that is refused still answers true when the day has a verdict', async () => {
    selectRows = [{ id: 1 }]
    expect(await answer('dismissed')).toBe(true)
    expect(sent).toHaveLength(2)
    expect(sent[1].text).toMatch(/^select /)
    expect(sent[1].text).toMatch(/"user_id" = \$\d+/)
  })

  it('answers false when the day has no verdict', async () => {
    expect(await answer('rated')).toBe(false)
  })
})
