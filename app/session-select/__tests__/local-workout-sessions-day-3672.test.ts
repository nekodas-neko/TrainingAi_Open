// #3672 item 3: Home's local workout seed compared `started_at` (a UTC instant) to the local day by
// its first ten characters, and cut the SQL at the local date read as UTC. A session started before
// 10:00 Brisbane carries yesterday's UTC date, so it was missing from first paint and offline.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dateStrMidnightInTz } from '@trainingai/shared/date-utils'

type Row = { id: string; sessionName: string; startedAt: string; completedAt: string | null; deletedAt: string | null }
let rows: Row[] = []
// The SQLite backend's query is `started_at >= ?`, a text comparison. The fake does the same.
const store = { getWorkoutSessions: vi.fn(async (cutoff: string) => rows.filter(r => r.startedAt >= cutoff)) }
vi.mock('@/lib/local-store', () => ({ getLocalStore: () => store }))

import { readLocalWorkoutSessionsDay } from '../local-workout-sessions-day'

const TZ = 'Australia/Brisbane'
const DAY = '2026-11-08'
/** An instant at `hh:mm` local time on `day`, as the ISO string the store holds. */
const at = (day: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(dateStrMidnightInTz(day, TZ).getTime() + (h * 60 + m) * 60_000).toISOString()
}
const row = (id: string, startedAt: string, deletedAt: string | null = null): Row =>
  ({ id, sessionName: `S-${id}`, startedAt, completedAt: null, deletedAt })

describe('readLocalWorkoutSessionsDay (#3672)', () => {
  beforeEach(() => { rows = []; store.getWorkoutSessions.mockClear() })

  it('keeps a session started before 10:00 local, whose UTC date is the day before', async () => {
    rows = [row('early', at(DAY, '07:00')), row('midday', at(DAY, '12:00'))]
    expect(rows[0].startedAt.slice(0, 10)).toBe('2026-11-07') // the premise: UTC says yesterday
    const out = await readLocalWorkoutSessionsDay('u', DAY, TZ)
    expect(out.map(s => s.sessionName)).toEqual(['S-early', 'S-midday'])
  })

  it('leaves out yesterday evening and tomorrow morning in local time, and deleted rows', async () => {
    rows = [
      row('yesterday-late', at('2026-11-07', '23:00')),
      row('midday', at(DAY, '12:00')),
      row('deleted', at(DAY, '12:30'), at(DAY, '13:00')),
      row('tomorrow-early', at('2026-11-09', '00:30')),
    ]
    const out = await readLocalWorkoutSessionsDay('u', DAY, TZ)
    expect(out.map(s => s.sessionName)).toEqual(['S-midday'])
  })

  it('judges the day in the timezone it is given', async () => {
    // 12:00 Brisbane on the 8th is 21:00 on the 7th in Los Angeles.
    rows = [row('midday', at(DAY, '12:00'))]
    expect(await readLocalWorkoutSessionsDay('u', DAY, 'America/Los_Angeles')).toEqual([])
    expect((await readLocalWorkoutSessionsDay('u', '2026-11-07', 'America/Los_Angeles')).map(s => s.sessionName)).toEqual(['S-midday'])
  })
})
