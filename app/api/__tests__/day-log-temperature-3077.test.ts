// #3077 — the day screen's body temperature after the switch to the Oura API is Oura's own
// deviation for the night; a night before the switch day is still the ring's.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const TZ = 'Australia/Brisbane'
const st = vi.hoisted(() => ({ switchDay: null as string | null }))

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'u1', timezone: TZ } })) }))
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    getDayLog: async () => [],
    listBodyMetrics: async () => [],
    getBodyFatCalibration: async () => null,
    listSleepSessions: async () => [],
    getDerivedScoresForDay: async () => null,
    getHrForWindow: async () => [],
    listActivityLogs: async () => [],
    getOuraCloudSwitchDay: async () => st.switchDay,
    // A ring row for each requested day: mean only, as a partial leftover would carry.
    getOuraDailySummary: async (_u: string, _from: string, to: string) => [{ date: to, tempMeanC: 34.8, tempDevC: 0.1 }],
    getOuraDaily: async (_u: string, from: string) => [{ date: from, temperatureDeviation: -0.3 }],
  }),
}))

import { GET } from '@/app/api/day-log/route'

const temp = async (date: string) =>
  ((await (await GET(new NextRequest(`http://localhost/api/day-log?date=${date}`))).json()) as { bodyTemp: unknown }).bodyTemp

describe('day screen body temperature (#3077)', () => {
  beforeEach(() => { st.switchDay = null })

  it('is the ring\'s mean on a night before the switch day', async () => {
    st.switchDay = '2026-10-18'
    expect(await temp('2026-10-16')).toEqual({ meanC: 34.8, devC: null, source: 'ble' })
  })

  it('is Oura\'s deviation, labelled, from the switch day', async () => {
    st.switchDay = '2026-10-18'
    expect(await temp('2026-10-19')).toEqual({ meanC: null, devC: -0.3, source: 'oura_cloud' })
  })

  it('is the ring\'s with no switch at all', async () => {
    expect(await temp('2026-10-19')).toEqual({ meanC: 34.8, devC: null, source: 'ble' })
  })
})
