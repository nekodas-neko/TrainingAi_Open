// #3001 / #3388 — the readiness resting-HR baseline is the device in use's own; the Activity zone lane
// reads the one resting-HR rule the HR zones share, and the move lane does not wait for any resting HR.
import { describe, it, expect } from 'vitest'
import { restingHrBaseline, scoreActivityForDay, type ActivityDayInput } from '../activity-day'
import { restingHrOnDay, meanRestingHr, restingHrWindow } from '../resting-hr-mean'
import { MET_ACTIVE_THRESHOLD } from '../daily-medians'

const day = (i: number) => `2026-10-${String(i).padStart(2, '0')}`
const nights = (from: number, n: number, bpm: number, source: string) =>
  Array.from({ length: n }, (_, i) => ({ date: day(from + i), restingHeartRate: bpm, restingHeartRateSource: source }))
const noWearGaps = new Map<string, { nonWearSec: number }>()

describe('restingHrBaseline per device (#3001)', () => {
  it('is the ring’s mean while it is the device in use', () => {
    expect(restingHrBaseline(nights(1, 10, 52, 'oura_ble'), noWearGaps)).toBe(52)
  })

  it('never pools the ring’s nights into an Oura baseline', () => {
    const rows = [...nights(1, 14, 52, 'oura_ble'), ...nights(15, 6, 60, 'oura_cloud')]
    expect(restingHrBaseline(rows, noWearGaps)).toBe(60)    // pooled would be 54
  })

  it('is null until the new device has 5 days, rather than the other device’s mean', () => {
    const rows = [...nights(1, 14, 52, 'oura_ble'), ...nights(15, 4, 60, 'oura_cloud')]
    expect(restingHrBaseline(rows, noWearGaps)).toBeNull()
  })

  it('is order-independent: the repository returns newest first', () => {
    const rows = [...nights(1, 14, 52, 'oura_ble'), ...nights(15, 6, 60, 'oura_cloud')].reverse()
    expect(restingHrBaseline(rows, noWearGaps)).toBe(60)
  })
})

describe('restingHrOnDay: the one rule the zone lane, HR zones and Body Battery share (#3388)', () => {
  it('equals the HR profile mean over the same window, so the zones tile and the lane cannot differ', () => {
    const rows = [...nights(1, 14, 52, 'oura_ble'), ...nights(15, 6, 60, 'oura_cloud')]
    const { from, to } = restingHrWindow(day(20))
    expect(restingHrOnDay(rows, day(20))).toBe(meanRestingHr(rows.filter(r => r.date >= from && r.date <= to)))
  })

  it('holds the previous device’s mean until the new one has 14 nights, not 5', () => {
    expect(restingHrOnDay([...nights(1, 14, 52, 'oura_ble'), ...nights(15, 6, 60, 'oura_cloud')], day(20))).toBe(52)
    expect(restingHrOnDay([...nights(1, 3, 52, 'oura_ble'), ...nights(4, 14, 60, 'oura_cloud')], day(17))).toBe(60)
  })

  it('leaves out nights after the scored day, so a finished day never reads a later one', () => {
    const rows = [...nights(1, 10, 52, 'oura_ble'), ...nights(11, 10, 70, 'oura_ble')]
    expect(restingHrOnDay(rows, day(10))).toBe(52)
  })

  it('is null with no reading', () => {
    expect(restingHrOnDay([], day(10))).toBeNull()
  })
})

describe('the Activity lanes without and with a resting HR (#3388)', () => {
  const dayMidMs = Date.UTC(2026, 9, 18, 14, 0, 0)    // 2026-10-19 00:00 in Brisbane (UTC+10)
  const hrRows = Array.from({ length: 24 * 12 }, (_, i) => ({
    timestamp: new Date(dayMidMs + i * 5 * 60_000), bpm: 120,
  }))
  // Worn all day at rest, active (>= threshold) in local hours 8 to 11 (4 moved hours).
  const metGrid = {
    startTimestampMs: dayMidMs,
    metsPerMinute: Array.from({ length: 24 * 60 }, (_, m) => (Math.floor(m / 60) >= 8 && Math.floor(m / 60) < 12 ? MET_ACTIVE_THRESHOLD + 1 : 1)),
  }
  const input = (over: Partial<ActivityDayInput>): ActivityDayInput => ({
    date: '2026-10-19', tz: 'Australia/Brisbane', bodyMetrics: [], restingHr: null, hrRows, maxHr: 185,
    sessions: [], program: null, user: { heightCm: 180, sex: 'male', activityLevel: 'moderate', dateOfBirth: '1990-01-01' },
    stepsGoal: null, ...over,
  })

  it('with no resting HR and no movement series, both lanes wait', () => {
    const s = scoreActivityForDay(input({})).signals
    expect([s.zoneMinutes, s.moveHours, s.moveHoursGoal]).toEqual([null, null, null])
  })

  it('with no resting HR, the movement series still runs the move lane; only zone minutes wait', () => {
    const s = scoreActivityForDay(input({ metGrid })).signals
    expect(s.zoneMinutes).toBeNull()
    expect(s.moveHours).toBe(4)
    expect(s.moveHoursGoal).not.toBeNull()
  })

  it('does not let heart rate decide a moved hour while there is no resting HR', () => {
    const noMet = scoreActivityForDay(input({ metGrid: null })).signals
    expect(noMet.moveHours).toBeNull()
  })

  it('with a resting HR the zone lane runs as well, and heart rate may add moved hours to the movement series', () => {
    const without = scoreActivityForDay(input({ metGrid })).signals
    const withHr = scoreActivityForDay(input({ metGrid, restingHr: 52 })).signals
    expect(withHr.zoneMinutes).not.toBeNull()
    expect(withHr.moveHours).toBeGreaterThanOrEqual(without.moveHours!)
  })

  it('the move lane adds to the score for a user with no resting HR yet', () => {
    const none = scoreActivityForDay(input({})).result
    const moved = scoreActivityForDay(input({ metGrid })).result
    expect(moved?.components.moveHours).toBeGreaterThan(0)
    expect(none?.components.moveHours ?? null).toBeNull()
  })
})
