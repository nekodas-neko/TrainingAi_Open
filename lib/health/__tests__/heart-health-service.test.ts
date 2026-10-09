// Issue 2093 — the heart-health re-score over a SYNTHETIC history (no database, no production data).
//
// The fixture has the shape the issue describes for production — 26 prescription days, 22 pending
// and 4 skipped, 17 of the pending days with something logged — but every heart rate in it is
// invented. It proves the mechanics and pins how a history of that shape moves; the owner's own
// numbers are what the admin route's dry run reports.
//
// Issue 2746 moved the floor from zone 2 (60% of reserve) to moderate effort (40%). The fixture is
// unchanged from issue 2093's, so the counts below are the before/after the PR states.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shiftDateStr } from '@trainingai/shared/date-utils'
import { computeHrZones } from '@trainingai/shared/health/hr-zones'
import { activityLogWindow, heartHealthMinutes, heartHealthVerdict } from '@trainingai/shared/running/heart-health'

vi.mock('@trainingai/shared/health/hr-profile', () => ({
  // Moderate effort (the floor since issue 2746) starts at 60 + 0.4 × 130 = 112 bpm; zone 2, the
  // floor before it, at 60 + 0.6 × 130 = 138.
  resolveHrProfile: vi.fn(async () => ({ maxHr: 190, restingHr: 60 })),
}))

const { heartHealthDays, rescoreHeartHealth } = await import('../heart-health-service')

const TZ = 'Australia/Brisbane'
const FIRST = '2026-09-01'
type Kind = 'brisk' | 'stroll' | 'no-hr' | 'run-short' | 'none'
const BPM: Record<Exclude<Kind, 'none' | 'no-hr'>, number> = { brisk: 142, stroll: 112, 'run-short': 150 }

// 22 pending: 9 brisk walks, 4 strolls, 1 short run, 3 logs with no heart rate, 5 with nothing logged.
// 4 skipped: 3 with a brisk walk, 1 with nothing.
const PENDING: Kind[] = [
  'brisk', 'stroll', 'brisk', 'none', 'brisk', 'no-hr', 'stroll', 'brisk', 'none', 'brisk', 'run-short',
  'stroll', 'brisk', 'no-hr', 'none', 'brisk', 'stroll', 'brisk', 'none', 'no-hr', 'brisk', 'none',
]
const SKIPPED: Kind[] = ['brisk', 'brisk', 'none', 'brisk']

function fixture() {
  const runs: { id: string; date: string; status: 'pending' | 'skipped' | 'completed'; durationMin: number }[] = []
  const logs: { id: string; date: string; title: string; activityType: string; startTime?: string; endTime?: string; durationMin: number }[] = []
  const kinds = new Map<string, Kind>()
  ;[...PENDING.map((k) => ['pending', k] as const), ...SKIPPED.map((k) => ['skipped', k] as const)].forEach(([status, kind], i) => {
    const date = shiftDateStr(FIRST, i)
    runs.push({ id: `run-${i}`, date, status, durationMin: 25 })
    if (kind === 'none') return
    const id = `log-${i}`
    kinds.set(id, kind)
    logs.push({
      id, date,
      title: kind === 'run-short' ? 'Run' : kind === 'stroll' ? 'Evening stroll' : 'Treadmill walk',
      activityType: kind === 'run-short' ? 'run' : kind === 'stroll' ? 'walk' : 'treadmill',
      // A no-HR log here is the realistic one: a manual entry with no clock times to place it.
      ...(kind === 'no-hr' ? {} : { startTime: '07:00:00', endTime: kind === 'run-short' ? '07:20:00' : '07:34:00' }),
      durationMin: kind === 'run-short' ? 20 : 34,
    })
  })
  const repo = {
    getPrescribedRuns: vi.fn(async (_u: string, from: string, to: string) => runs.filter((r) => r.date >= from && r.date <= to)),
    listActivityLogs: vi.fn(async (_u: string, from: string, to: string) => logs.filter((l) => l.date >= from && l.date <= to)),
    getHrForWindow: vi.fn(async (_u: string, from: Date, to: Date) => {
      // One reading a minute across the window, at the log's own effort.
      const log = logs.find((l) => {
        const w = activityLogWindow(l, TZ)
        return w != null && w.from.getTime() === from.getTime()
      })
      const kind = log ? kinds.get(log.id) : undefined
      if (!kind || kind === 'none' || kind === 'no-hr') return []
      const out: { timestamp: Date; bpm: number; source: string | null }[] = []
      for (let t = from.getTime(); t <= to.getTime(); t += 60_000) out.push({ timestamp: new Date(t), bpm: BPM[kind], source: 'ring' })
      return out
    }),
    updatePrescribedRun: vi.fn(async (_u: string, id: string) => runs.find((r) => r.id === id) ?? null),
  }
  return { repo, runs }
}

const LAST = shiftDateStr(FIRST, PENDING.length + SKIPPED.length - 1)

describe('issue 2093 — re-scoring a synthetic history', () => {
  let f: ReturnType<typeof fixture>
  beforeEach(() => { f = fixture() })

  it('measures each activity in its own window', async () => {
    const days = await heartHealthDays(f.repo as never, 'u1', TZ, FIRST, LAST)
    const day0 = days.find((d) => d.date === FIRST)!
    expect(day0.activities[0]).toMatchObject({ title: 'Treadmill walk', durationMin: 34, effortMin: 34 })
    expect(day0).toMatchObject({ met: true, countedMin: 34, creditedId: 'log-0', outcome: 'counted' })
    // The stroll sits at 112 bpm, exactly the moderate floor: every minute of it counts now.
    const stroll = days.find((d) => d.date === shiftDateStr(FIRST, 1))!
    expect(stroll).toMatchObject({ met: true, countedMin: 34, outcome: 'counted' })
    // The short run is all above the floor, but 20 minutes is short of the prescribed 25.
    const run = days.find((d) => d.date === shiftDateStr(FIRST, 10))!
    expect(run).toMatchObject({ met: false, countedMin: 20, outcome: 'not-counted' })
    const noHr = days.find((d) => d.date === shiftDateStr(FIRST, 5))!
    expect(noHr.activities[0].effortMin).toBeNull()
  })

  it('days moved: 9 of 26 under the zone 2 floor, 13 of 26 under moderate effort (issue 2746)', async () => {
    // Before: the same readings scored against the old floor, zone 2 (138 bpm). Test-only — the
    // rule itself has no second floor.
    const zone2Floor = computeHrZones({ maxHr: 190, restingHr: 60 })[1].minBpm
    expect(zone2Floor).toBe(138)
    const days = await heartHealthDays(f.repo as never, 'u1', TZ, FIRST, LAST)
    let before = 0
    for (const d of days) {
      if (d.status !== 'pending') continue
      const acts = await Promise.all(d.activities.map(async (a) => {
        const log = { date: d.date, ...(a.effortMin == null ? {} : { startTime: '07:00:00', durationMin: a.durationMin }) }
        const w = activityLogWindow(log, TZ)
        const rows = w ? await f.repo.getHrForWindow('u1', w.from, w.to) : []
        const readings = rows.map((r) => ({ timestamp: r.timestamp.getTime(), bpm: r.bpm }))
        return { ...a, effortMin: rows.length < 2 ? null : heartHealthMinutes(readings, zone2Floor) }
      }))
      if (heartHealthVerdict(d.targetMin, acts).met) before++
    }
    expect(before).toBe(9)

    const r = await rescoreHeartHealth(f.repo as never, 'u1', TZ, FIRST, LAST, { write: false })
    expect(r.days).toHaveLength(26)
    // After: the 9 brisk walks and the 4 strolls (at 112 bpm, between the two floors). Not the logs
    // with no heart rate (the owner kept that), and not the 20-minute run: 20 is short of 25.
    expect(r.changes).toHaveLength(13)
    expect(r.changes.length - before).toBe(4)
    expect(r.changes.every((c) => c.completedAs === 'walk' && c.countedMin >= 25)).toBe(true)
    expect(r.written).toBe(0)
    expect(f.repo.updatePrescribedRun).not.toHaveBeenCalled()
    // The three skipped days with a brisk walk met the rule and stay skipped.
    expect(r.days.filter((d) => d.status === 'skipped' && d.met)).toHaveLength(3)
  })

  it('writes only derived values, for exactly the days the dry run named', async () => {
    const dry = await rescoreHeartHealth(f.repo as never, 'u1', TZ, FIRST, LAST, { write: false })
    const wet = await rescoreHeartHealth(f.repo as never, 'u1', TZ, FIRST, LAST, { write: true })
    expect(wet.written).toBe(dry.changes.length)
    for (const [userId, id, patch] of f.repo.updatePrescribedRun.mock.calls as unknown as [string, string, object][]) {
      expect(userId).toBe('u1')
      const c = wet.changes.find((x) => x.runId === id)!
      expect(patch).toEqual({ status: 'completed', activityLogId: c.activityLogId, completedAs: 'walk' })
    }
  })
})
