import { describe, it, expect, vi } from 'vitest'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'u1', isAdmin: true, timezone: 'Australia/Brisbane' } })),
}))
vi.mock('@/lib/admin', () => ({ requireAdmin: vi.fn(async () => {}) }))
const insertOuraBatteryPoll = vi.fn(async () => {})
vi.mock('@/lib/data', () => ({
  getRepositoryAsync: vi.fn(async () => ({ insertOuraBatteryPoll })),
}))

import { POST } from '@/app/api/oura-ble/battery-poll/route'

const post = (body: unknown) => POST(new Request('http://x/api/oura-ble/battery-poll', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}))

describe('POST /api/oura-ble/battery-poll', () => {
  it('accepts a valid poll and persists it', async () => {
    const res = await post({ percent: 82, charging: false })
    expect(res.status).toBe(200)
    expect(insertOuraBatteryPoll).toHaveBeenCalledWith('u1', 82, false)
  })

  it('accepts a poll with charging omitted (→ null)', async () => {
    insertOuraBatteryPoll.mockClear()
    const res = await post({ percent: 100 })
    expect(res.status).toBe(200)
    expect(insertOuraBatteryPoll).toHaveBeenCalledWith('u1', 100, null)
  })

  it('400s on out-of-range percent', async () => {
    const res = await post({ percent: 150 })
    expect(res.status).toBe(400)
  })

  it('400s on a non-integer / non-numeric percent', async () => {
    const res = await post({ percent: 'full' })
    expect(res.status).toBe(400)
  })

  it('400s on an unknown extra field (strict)', async () => {
    const res = await post({ percent: 80, voltage: 3900 })
    expect(res.status).toBe(400)
  })
})
