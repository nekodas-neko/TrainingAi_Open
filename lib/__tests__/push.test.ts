import { describe, it, expect, vi, beforeEach } from 'vitest'

const { sendNotificationMock, setVapidDetailsMock } = vi.hoisted(() => ({
  sendNotificationMock: vi.fn(),
  setVapidDetailsMock: vi.fn(),
}))
vi.mock('web-push', () => ({
  default: { sendNotification: sendNotificationMock, setVapidDetails: setVapidDetailsMock },
}))

const { selectResult, deleteWhereMock } = vi.hoisted(() => ({
  selectResult: { rows: [] as { id: string; endpoint: string; p256dh: string; auth: string }[] },
  deleteWhereMock: vi.fn(),
}))
vi.mock('@/lib/data/postgres/client', () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => Promise.resolve(selectResult.rows) }) }),
    delete: () => ({ where: deleteWhereMock }),
  }),
}))
vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
  inArray: (col: unknown, vals: unknown) => ({ op: 'inArray', col, vals }),
}))

// VAPID_CONFIGURED is computed at module-load time in lib/push.ts, and ESM
// imports are hoisted above plain statements — these must run inside
// vi.hoisted so they land before the (hoisted) `import` below resolves.
vi.hoisted(() => {
  process.env.VAPID_PUBLIC_KEY = 'pub'
  process.env.VAPID_PRIVATE_KEY = 'priv'
  process.env.VAPID_EMAIL = 'test@example.com'
})

import { sendPushToUser } from '@/lib/push'

function subscription(id: string) {
  return { id, endpoint: `https://push.example/${id}`, p256dh: 'p', auth: 'a' }
}

describe('sendPushToUser', () => {
  beforeEach(() => {
    sendNotificationMock.mockReset()
    deleteWhereMock.mockReset()
    selectResult.rows = []
  })

  it('deletes every expired (410) subscription, not just the first', async () => {
    selectResult.rows = [subscription('a'), subscription('b'), subscription('c')]
    sendNotificationMock.mockImplementation((sub: { endpoint: string }) => {
      if (sub.endpoint.endsWith('/b') || sub.endpoint.endsWith('/c')) {
        return Promise.reject({ statusCode: 410 })
      }
      return Promise.resolve()
    })

    await sendPushToUser('user-1', { title: 't', body: 'b' })

    expect(deleteWhereMock).toHaveBeenCalledTimes(1)
    const condition = deleteWhereMock.mock.calls[0][0] as { op: string; vals: string[] }
    expect(condition.op).toBe('inArray')
    expect(condition.vals.sort()).toEqual(['b', 'c'])
  })

  it('does not delete anything when no subscription is expired', async () => {
    selectResult.rows = [subscription('a')]
    sendNotificationMock.mockResolvedValue(undefined)

    await sendPushToUser('user-1', { title: 't', body: 'b' })

    expect(deleteWhereMock).not.toHaveBeenCalled()
  })
})
