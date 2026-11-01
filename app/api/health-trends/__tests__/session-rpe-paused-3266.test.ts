import { describe, it, expect, vi } from 'vitest'
import { todayInTz, shiftDateStr, dateStrMidnightInTz } from '@trainingai/shared/date-utils'

// #3266: a paused session's effort load counts its active minutes, as every other duration
// surface does since #3349, not the span from start to finish.

const TZ = 'Australia/Brisbane'
vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u1', timezone: TZ } }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

// Anchored to local midday, three days back, so no rolling window can drop it.
const day = shiftDateStr(todayInTz(TZ), -3)
const startedAt = new Date(dateStrMidnightInTz(day, TZ).getTime() + 12 * 3_600_000)
const session = (pausedSec: number | null) => ({
  id: `s-${pausedSec}`,
  startedAt,
  completedAt: new Date(startedAt.getTime() + 60 * 60_000),
  pausedSec,
  sessionRpe: 7,
  exercises: [],
})

let sessions: ReturnType<typeof session>[] = []
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({ getWorkoutSessionsFrom: async () => sessions }),
}))

async function load() {
  const { GET } = await import('../route')
  const res = await GET(new Request('http://x/api/health-trends?view=session-rpe'))
  expect(res.status).toBe(200)
  return (await res.json()) as { series: { sessionLoad: number }[] }
}

describe('session effort load and a paused workout (#3266)', () => {
  it('takes the pause off the duration: 60 minutes with 20 paused loads 7 × 40', async () => {
    sessions = [session(1200)]
    const body = await load()
    expect(body.series.map(p => p.sessionLoad)).toEqual([280])
  })

  it('a session saved before pause existed loads its whole span', async () => {
    sessions = [session(null)]
    const body = await load()
    expect(body.series.map(p => p.sessionLoad)).toEqual([420])
  })
})
