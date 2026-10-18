// #3000 (scoring doc rule 5): the subjective-recovery correlation pairs a morning check-in with OUR
// readiness for that day. A day with only Oura's readiness drops out; it never pairs on Oura's.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: '00000000-0000-4000-8000-000000003001', timezone: 'Australia/Brisbane' } })),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

const days = ['2026-10-14', '2026-10-15', '2026-10-16']
let derived: unknown[] = []
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    listDayCheckins: async () => days.map(logDate => ({ logDate, perceivedRecovery: 4, perceivedRecoveryTouched: true })),
    getOuraDaily: async () => days.map(date => ({ date, readinessScore: 90 })),
    getOuraDailyDerived: async () => derived,
  }),
}))

const get = async () => {
  const { GET } = await import('../route')
  const res = await GET(new Request('http://localhost/api/health-trends?view=subjective-recovery') as never)
  return (await res.json()) as { buckets: { label: string; count: number }[] }
}
const paired = (b: { count: number }[]) => b.reduce((s, x) => s + x.count, 0)

describe("subjective-recovery pairs on our readiness, never Oura's (#3000)", () => {
  beforeEach(() => { derived = [] })

  it("Oura's readiness exists and ours doesn't → nothing pairs", async () => {
    expect(paired((await get()).buckets)).toBe(0)
  })

  it('pairs on ours where it exists', async () => {
    derived = [{ day: days[0], readinessScore: 55 }, { day: days[1], readinessScore: 60 }]
    const { buckets } = await get()
    expect(paired(buckets)).toBe(2)
  })
})
