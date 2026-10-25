// #3044 — `/api/sync-health` keys a Health Connect session on its record id when the phone sends
// one, keeps the `date|HH:MM` rule when it does not, and tombstones what a fully read window no
// longer holds.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'

const repo = vi.hoisted(() => ({
  saveActivityLog: vi.fn(),
  upsertHealthConnectActivityLog: vi.fn(async () => 'inserted'),
  tombstoneHealthConnectActivityLogs: vi.fn(async () => 0),
  listActivityLogs: vi.fn(async () => [] as { date: string; startTime?: string }[]),
  listActivityTypes: vi.fn(async () => ['walk', 'strength', 'other'].map(id => ({ id }))),
}))

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'u1', timezone: 'Australia/Brisbane' } })),
}))
vi.mock('@/lib/data', () => ({ getRepositoryAsync: vi.fn(async () => repo) }))

import { POST } from '@/app/api/sync-health/route'
import { NextRequest } from 'next/server'

const post = async (body: unknown) => {
  const res = await POST(new NextRequest('http://x/api/sync-health', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))
  return { status: res.status, json: await res.json() }
}

// Rolling: anchored to today in the user's zone, never a fixed date that ages out of the window.
const today = todayInTz('Australia/Brisbane')
const day = shiftDateStr(today, -2)
const session = (over: Record<string, unknown> = {}) => ({
  date: day, title: 'Walk', activityType: 'walk', startTime: '12:00', endTime: '12:40', durationMin: 40, ...over,
})
const window = (over: Record<string, unknown> = {}) => ({ from: shiftDateStr(today, -6), to: today, complete: true, ...over })

beforeEach(() => vi.clearAllMocks())

describe('exercise sessions with a record id', () => {
  it('upserts on the record id, not on date and minute', async () => {
    const { status } = await post({ exerciseSessions: [session({ recordId: 'hc-1' })] })
    expect(status).toBe(200)
    expect(repo.upsertHealthConnectActivityLog).toHaveBeenCalledWith('u1', 'hc-1', expect.objectContaining({ date: day, startTime: '12:00', activityType: 'walk' }))
    expect(repo.saveActivityLog).not.toHaveBeenCalled()
    // No `date|HH:MM` lookup is needed when every session carries its id.
    expect(repo.listActivityLogs).not.toHaveBeenCalledWith('u1', day, day)
  })

  it('never passes the request body through: only the session fields reach the write', async () => {
    await post({ exerciseSessions: [session({ recordId: 'hc-1' })] })
    const [, , log] = repo.upsertHealthConnectActivityLog.mock.calls[0] as unknown as [string, string, Record<string, unknown>]
    expect(Object.keys(log).sort()).toEqual(
      ['activityType', 'avgHr', 'caloriesBurned', 'date', 'distanceKm', 'durationMin', 'endTime', 'maxHr', 'startTime', 'title'])
  })

  it('stores a watch strength session as strength', async () => {
    await post({ exerciseSessions: [session({ recordId: 'hc-2', activityType: 'strength', title: 'Gym' })] })
    expect(repo.upsertHealthConnectActivityLog).toHaveBeenCalledWith('u1', 'hc-2', expect.objectContaining({ activityType: 'strength' }))
  })
})

describe('an older bundle without record ids', () => {
  it('keeps the date|HH:MM rule: a stored minute is skipped, a new one saved', async () => {
    repo.listActivityLogs.mockResolvedValueOnce([{ date: day, startTime: '12:00' }])
    await post({ exerciseSessions: [session(), session({ startTime: '15:00', endTime: '15:30', durationMin: 30 })] })
    expect(repo.saveActivityLog).toHaveBeenCalledTimes(1)
    expect(repo.saveActivityLog).toHaveBeenCalledWith('u1', expect.objectContaining({ startTime: '15:00' }))
    expect(repo.upsertHealthConnectActivityLog).not.toHaveBeenCalled()
    expect(repo.tombstoneHealthConnectActivityLogs).not.toHaveBeenCalled()
  })
})

describe('deletions in a fully read window', () => {
  it('tombstones within the window, keeping every id the phone read, refused and left-out ones too', async () => {
    const { json } = await post({
      exerciseSessions: [session({ recordId: 'kept' }), session({ recordId: 'refused', durationMin: -5 })],
      exerciseWindow: window({ leftOut: ['oura-copy'] }),
    })
    expect(json.rejected).toEqual([expect.stringMatching(/^exercise .*durationMin/)])
    expect(repo.tombstoneHealthConnectActivityLogs).toHaveBeenCalledWith('u1', {
      from: shiftDateStr(today, -6), to: today, keep: ['kept', 'refused', 'oura-copy'],
    })
  })

  it('a read the phone reports as failed or part-way sweeps nothing, however short its list', async () => {
    const { status } = await post({ exerciseSessions: [session({ recordId: 'kept' })], exerciseWindow: window({ complete: false }) })
    expect(status).toBe(200)
    expect(repo.upsertHealthConnectActivityLog).toHaveBeenCalledTimes(1)
    expect(repo.tombstoneHealthConnectActivityLogs).not.toHaveBeenCalled()
    await post({ exerciseSessions: [], exerciseWindow: window({ complete: false }) })
    expect(repo.tombstoneHealthConnectActivityLogs).not.toHaveBeenCalled()
  })

  it('an empty read sweeps nothing and says so: a new phone or cleared Health Connect looks the same', async () => {
    const { json } = await post({ exerciseSessions: [], exerciseWindow: window() })
    expect(repo.tombstoneHealthConnectActivityLogs).not.toHaveBeenCalled()
    expect(json.rejected).toEqual([expect.stringMatching(/no sessions came back/)])
  })

  it('sweeps before it stores, so a record that replaced another at the same minute lands in one request', async () => {
    const order: string[] = []
    repo.tombstoneHealthConnectActivityLogs.mockImplementationOnce(async () => { order.push('sweep'); return 1 })
    repo.upsertHealthConnectActivityLog.mockImplementationOnce(async () => { order.push('store'); return 'inserted' })
    await post({ exerciseSessions: [session({ recordId: 'new' })], exerciseWindow: window() })
    expect(order).toEqual(['sweep', 'store'])
  })

  it('reports a session another row already holds the minute of', async () => {
    repo.upsertHealthConnectActivityLog.mockImplementationOnce(async () => 'taken')
    const { json } = await post({ exerciseSessions: [session({ recordId: 'hc-1' })] })
    expect(json.rejected).toEqual([expect.stringMatching(/already holds this start time/)])
  })

  it('takes either date separator', async () => {
    await post({ exerciseSessions: [session({ recordId: 'hc-1' })], exerciseWindow: window({ from: shiftDateStr(today, -6).replace(/-/g, '/') }) })
    expect(repo.tombstoneHealthConnectActivityLogs).toHaveBeenCalledWith('u1', expect.objectContaining({ from: shiftDateStr(today, -6) }))
  })

  it('without a window, nothing is swept', async () => {
    await post({ exerciseSessions: [session({ recordId: 'hc-1' })] })
    expect(repo.tombstoneHealthConnectActivityLogs).not.toHaveBeenCalled()
  })
})

describe('refusals', () => {
  it('a window wider than one read, reversed, in the future or not a day is refused and sweeps nothing', async () => {
    for (const bad of [
      window({ from: shiftDateStr(today, -90) }),
      window({ from: today, to: shiftDateStr(today, -6) }),
      window({ from: today, to: shiftDateStr(today, 30) }),
      window({ from: '2026-02-31' }),
    ]) {
      const { status, json } = await post({ exerciseWindow: bad })
      expect(status).toBe(200)
      expect(json.rejected).toEqual([expect.stringMatching(/^exerciseWindow /)])
    }
    expect(repo.tombstoneHealthConnectActivityLogs).not.toHaveBeenCalled()
  })

  it('a malformed window or left-out list is a 400, so nothing is half-applied', async () => {
    for (const bad of [
      { exerciseWindow: { from: 'last week', to: today, complete: true } },
      { exerciseWindow: { from: shiftDateStr(today, -6), to: today } },
      { exerciseWindow: { ...window(), extra: 1 } },
      { exerciseWindow: window({ leftOut: ['x'.repeat(201)] }) },
      { exerciseWindow: window({ leftOut: Array.from({ length: 401 }, (_, i) => `id-${i}`) }) },
    ]) expect((await post(bad)).status).toBe(400)
    expect(repo.tombstoneHealthConnectActivityLogs).not.toHaveBeenCalled()
  })

  it('the writing app is not taken: a session carrying `origin` has it dropped and reported', async () => {
    const { json } = await post({ exerciseSessions: [session({ recordId: 'hc-1', origin: 'com.sec.android.app.shealth' })] })
    expect(json.rejected).toEqual([`exercise ${day}: dropped origin`])
    expect(repo.upsertHealthConnectActivityLog).toHaveBeenCalledTimes(1)
  })

  it('a bad record id is dropped and the session falls back to the date|HH:MM rule', async () => {
    const { json } = await post({ exerciseSessions: [session({ recordId: 'x'.repeat(201) })] })
    expect(json.rejected).toEqual([`exercise ${day}: dropped recordId`])
    expect(repo.upsertHealthConnectActivityLog).not.toHaveBeenCalled()
    expect(repo.saveActivityLog).toHaveBeenCalledTimes(1)
  })

  it('an Apple Health caller cannot sweep Health Connect rows', async () => {
    const { json } = await post({ source: 'apple_health', exerciseWindow: window() })
    expect(json.rejected).toEqual([expect.stringMatching(/only Health Connect/)])
    expect(repo.tombstoneHealthConnectActivityLogs).not.toHaveBeenCalled()
  })
})
