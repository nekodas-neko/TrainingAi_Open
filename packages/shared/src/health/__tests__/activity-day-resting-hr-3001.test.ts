// #3001 — the Activity score's resting-HR baseline is the device in use's own, in the one function
// both the live read and the stored day-end score call, and the zone lane keeps reading after a switch.
import { describe, it, expect } from 'vitest'
import { restingHrBaseline, carriedOverRestingHr, scoreActivityForDay, type ActivityDayInput } from '../activity-day'

const day = (i: number) => `2026-10-${String(i).padStart(2, '0')}`
const nights = (from: number, n: number, bpm: number, source: string) =>
  Array.from({ length: n }, (_, i) => ({ date: day(from + i), restingHeartRate: bpm, restingHeartRateSource: source }))
const noWearGaps = new Map<string, { nonWearTimeSec?: number | null }>()

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

describe('carriedOverRestingHr (#3001)', () => {
  it('is the previous device’s mature mean after a switch', () => {
    expect(carriedOverRestingHr([...nights(1, 14, 52, 'oura_ble'), ...nights(15, 3, 60, 'oura_cloud')])).toBe(52)
  })

  it('is null with one device, so a new user’s zone lane is not switched on early', () => {
    expect(carriedOverRestingHr(nights(1, 3, 60, 'oura_cloud'))).toBeNull()
  })

  it('is null when the previous device never matured', () => {
    expect(carriedOverRestingHr([...nights(1, 5, 52, 'oura_ble'), ...nights(6, 3, 60, 'oura_cloud')])).toBeNull()
  })
})

describe('the zone lane after a device switch (#3001)', () => {
  const hrRows = Array.from({ length: 24 * 12 }, (_, i) => ({
    timestamp: new Date(Date.UTC(2026, 9, 18, 0, 0, 0) + i * 5 * 60_000), bpm: 120,
  }))
  const input = (over: Partial<ActivityDayInput>): ActivityDayInput => ({
    date: '2026-10-19', tz: 'Australia/Brisbane', bodyMetrics: [], restingHrBaseline: null, hrRows, maxHr: 185,
    sessions: [], program: null, user: { heightCm: 180, sex: 'male', activityLevel: 'moderate', dateOfBirth: '1990-01-01' },
    stepsGoal: null, ...over,
  })

  it('drops with no baseline and no carried-over value', () => {
    expect(scoreActivityForDay(input({})).signals.zoneMinutes).toBeNull()
  })

  it('reads the carried-over resting HR while the device in use has no baseline of its own', () => {
    const s = scoreActivityForDay(input({ restingHrCarriedOver: 52 })).signals
    expect(s.zoneMinutes).not.toBeNull()
    expect(s.moveHours).not.toBeNull()
  })

  it('prefers the device’s own baseline once it has one', () => {
    const own = scoreActivityForDay(input({ restingHrBaseline: 60, restingHrCarriedOver: 52 })).signals
    const ownOnly = scoreActivityForDay(input({ restingHrBaseline: 60 })).signals
    expect(own).toEqual(ownOnly)
  })
})
