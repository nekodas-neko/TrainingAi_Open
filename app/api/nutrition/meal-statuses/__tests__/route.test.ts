import { beforeEach, describe, it, expect, vi } from 'vitest'
import { UserFacingError } from '@trainingai/shared/errors'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn(), set: vi.fn() }))
vi.mock('@/auth', () => ({ auth: mocks.auth }))
vi.mock('@/lib/data', () => ({
  getRepository: () => ({
    listMealLoggingStatuses: mocks.list,
    setMealLoggingStatus: mocks.set,
    ensureMealLoggingDay: async () => {},
  }),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
import { GET, POST } from '../route'
const user = '00000000-0000-4000-8000-000000000001'
const body = {
  date: '2026-10-12',
  mealTypeId: '00000000-0000-4000-8000-000000000002',
  skipped: true,
  decisionId: '00000000-0000-4000-8000-000000000003',
}
const post = (value: unknown) =>
  POST(
    new Request('https://example.com/api/nutrition/meal-statuses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    }),
  )
describe('meal status API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue({ user: { id: user, timezone: 'Australia/Brisbane' } })
    mocks.list.mockResolvedValue([])
    mocks.set.mockResolvedValue(undefined)
  })
  it('requires sign-in and validates calendar dates and booleans', async () => {
    mocks.auth.mockResolvedValue(null)
    expect((await post(body)).status).toBe(401)
    mocks.auth.mockResolvedValue({ user: { id: user } })
    expect((await post({ ...body, date: '2026-02-31' })).status).toBe(400)
    expect((await post({ ...body, skipped: 'true' })).status).toBe(400)
    expect(mocks.set).not.toHaveBeenCalled()
  })
  it('uses the authenticated account and accepts both date separators', async () => {
    expect((await post({ ...body, date: '2026/10/12' })).status).toBe(200)
    expect(mocks.set).toHaveBeenCalledWith(
      user,
      body.date,
      body.mealTypeId,
      true,
      body.decisionId,
    )
    expect((await post({ ...body, userId: 'another-account' })).status).toBe(400)
  })
  it('reads only that account and returns a private response', async () => {
    const response = await GET(
      new Request('https://example.com/api/nutrition/meal-statuses?date=2026-10-12'),
    )
    expect(mocks.list).toHaveBeenCalledWith(user, body.date)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ date: body.date, statuses: [] })
  })
  it('keeps the conflict visible when food has already been recorded', async () => {
    mocks.set.mockRejectedValue(new UserFacingError('Food is already recorded.', 409))
    expect((await post(body)).status).toBe(409)
  })
})
