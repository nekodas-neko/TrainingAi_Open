// #3646: a walk recorded in the app and held again by Health Connect (another app's copy, starting a
// minute later) is one walk. The heart-health activity measured each copy over its own window and
// summed them. Synthetic heart rates, no database.
import { describe, it, expect, vi } from 'vitest'
import { localClockTimeToDate } from '@trainingai/shared/date-utils'

vi.mock('@trainingai/shared/health/hr-profile', () => ({
  // Moderate effort starts at 60 + 0.4 × 130 = 112 bpm.
  resolveHrProfile: vi.fn(async () => ({ maxHr: 190, restingHr: 60 })),
}))

const { heartHealthDays } = await import('../heart-health-service')

const TZ = 'Australia/Brisbane'
const DAY = '2026-09-03'
const at = (hhmm: string) => localClockTimeToDate(DAY, hhmm, TZ)!.getTime()

// One reading a second from 07:00 to 07:30, above the floor for 18 minutes (07:05 to 07:23).
const series: { timestamp: Date; bpm: number; source: string | null }[] = []
for (let t = at('07:00'); t <= at('07:30'); t += 1000)
  series.push({ timestamp: new Date(t), bpm: t >= at('07:05') && t < at('07:23') ? 135 : 95, source: 'ring' })

type Log = { id: string; date: string; title: string; activityType: string; startTime: string; endTime: string; durationMin: number; externalSource?: string }
const inApp: Log = { id: 'in-app', date: DAY, title: 'Walk', activityType: 'walk', startTime: '07:00:00', endTime: '07:30:00', durationMin: 30 }
const copy: Log = { id: 'hc-copy', date: DAY, title: 'Walking', activityType: 'walk', startTime: '07:01:00', endTime: '07:29:00', durationMin: 28, externalSource: 'health_connect' }

function repoWith(logs: Log[]) {
  return {
    getPrescribedRuns: vi.fn(async () => [{ id: 'run-1', date: DAY, status: 'pending' as const, durationMin: 30 }]),
    listActivityLogs: vi.fn(async (_u: string, from: string, to: string) => logs.filter((l) => l.date >= from && l.date <= to)),
    getHrForWindow: vi.fn(async (_u: string, from: Date, to: Date) =>
      series.filter((r) => r.timestamp >= from && r.timestamp <= to)),
  }
}

describe('heart-health activity with a Health Connect copy (#3646)', () => {
  it('reads an 18-minute walk held twice as 18 minutes, not met against 30', async () => {
    const [day] = await heartHealthDays(repoWith([inApp, copy]) as never, 'u1', TZ, DAY, DAY)
    expect(day.activities.map((a) => a.id)).toEqual(['in-app'])
    expect(day.countedMin).toBe(18)
    expect(day.met).toBe(false)
  })

  it('still counts a Health Connect walk that has no in-app twin', async () => {
    const [day] = await heartHealthDays(repoWith([copy]) as never, 'u1', TZ, DAY, DAY)
    expect(day.activities.map((a) => a.id)).toEqual(['hc-copy'])
    expect(day.countedMin).toBe(18)
  })
})
