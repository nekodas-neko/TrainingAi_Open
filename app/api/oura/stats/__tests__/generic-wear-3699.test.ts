// #3699: the Body tab's today-wear cards read Oura's `nonWearTimeSec` off this route's raw row. The
// route now also sends today's wear in the generic `DailyWear` shape, mapped through the Oura
// connector, so the clients read that and never a device field. `daily` stays for Preview builds
// that predate `wear`.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { todayInTz } from '@trainingai/shared/date-utils'

const TZ = 'Australia/Brisbane'
const repo = { hasOuraBleSamples: vi.fn(), getOuraDaily: vi.fn() }
vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'u1', timezone: TZ } })) }))
vi.mock('@/lib/data', () => ({ getRepositoryAsync: vi.fn(async () => repo) }))

describe('/api/oura/stats — generic wear (#3699)', () => {
  beforeEach(() => { repo.hasOuraBleSamples.mockReset(); repo.getOuraDaily.mockReset() })

  it("sends today's wear in the generic shape alongside the raw row", async () => {
    const today = todayInTz(TZ)
    repo.hasOuraBleSamples.mockResolvedValue(true)
    repo.getOuraDaily.mockResolvedValue([{ date: today, nonWearTimeSec: 1_800 }])
    const { GET } = await import('../route')
    const body = await (await GET()).json()
    expect(body.wear).toEqual({ date: today, nonWearSec: 1_800, source: expect.any(String) })
    expect(body.daily.nonWearTimeSec).toBe(1_800)
  })

  it('sends wear null when today has no wear stored, and when there is no ring', async () => {
    repo.hasOuraBleSamples.mockResolvedValue(true)
    repo.getOuraDaily.mockResolvedValue([{ date: todayInTz(TZ), nonWearTimeSec: null }])
    const { GET } = await import('../route')
    expect((await (await GET()).json()).wear).toBeNull()
    repo.hasOuraBleSamples.mockResolvedValue(false)
    expect((await (await GET()).json())).toEqual({ connected: false, wear: null, daily: null })
  })
})
