// #2338 — a night the user enters by hand: its parse and bounds, and the ranked merge that makes any
// device night win over it.
import { describe, it, expect } from 'vitest'
import { parseManualNight, manualNightFromWindow } from '@trainingai/shared/health/manual-sleep'
import { preferDeviceNights, nightSessions, canonicalLatestNight, type RankableSleepRow } from '@trainingai/shared/health/sleep-night'
import {
  manualSleepImplausibleReason, MANUAL_SLEEP_MAX_HOURS, MANUAL_SLEEP_MIN_HOURS,
} from '@trainingai/shared/validation/plausibility'

const BNE = 'Australia/Brisbane'
const NOW = new Date('2026-10-07T02:00:00.000Z') // 12:00 Brisbane
// 22:30 → 06:30 Brisbane, waking on 2026-10-07.
const BED = '2026-10-06T12:30:00.000Z'
const WAKE = '2026-10-06T20:30:00.000Z'

describe('manualSleepImplausibleReason', () => {
  const at = (s: string, e: string) => manualSleepImplausibleReason({ sleepStart: new Date(s), sleepEnd: new Date(e) }, NOW)

  it('accepts an ordinary night', () => {
    expect(at(BED, WAKE)).toBeNull()
  })

  it('rejects a wake time at or before the bed time', () => {
    expect(at(WAKE, BED)).toMatch(/not after/)
    expect(at(BED, BED)).toMatch(/not after/)
  })

  it(`rejects a night shorter than ${MANUAL_SLEEP_MIN_HOURS} h or longer than ${MANUAL_SLEEP_MAX_HOURS} h`, () => {
    expect(at(BED, '2026-10-06T13:15:00.000Z')).toMatch(/shorter/)
    // a.m./p.m. swapped: 22:30 → 18:30 the next day is a 20-hour night.
    expect(at(BED, '2026-10-07T08:30:00.000Z')).toMatch(/longer/)
    expect(at('2026-10-06T08:00:00.000Z', '2026-10-07T00:00:00.000Z')).toBeNull() // exactly 16 h is allowed
  })

  it('rejects a wake time in the future, with a few minutes for clock skew', () => {
    expect(at('2026-10-06T20:00:00.000Z', '2026-10-07T03:00:00.000Z')).toMatch(/future/)
    expect(at('2026-10-06T19:00:00.000Z', '2026-10-07T02:04:00.000Z')).toBeNull()
  })

  it('rejects a night more than thirty days ago', () => {
    expect(at('2026-09-05T12:30:00.000Z', '2026-09-05T20:30:00.000Z')).toMatch(/30 days/)
  })

  it('rejects an instant that is not a time', () => {
    expect(manualSleepImplausibleReason({ sleepStart: new Date('nope'), sleepEnd: new Date(WAKE) }, NOW)).toMatch(/not a time/)
  })
})

describe('parseManualNight', () => {
  it('derives the wake date in the user timezone, never from UTC', () => {
    // 20:30Z on the 6th is 06:30 on the 7th in Brisbane.
    const p = parseManualNight({ sleepStart: BED, sleepEnd: WAKE }, BNE, NOW)
    expect(p.ok && p.night.date).toBe('2026-10-07')
    // The same instants for a user in London wake on the 6th (21:30 BST).
    const london = parseManualNight({ sleepStart: BED, sleepEnd: WAKE }, 'Europe/London', NOW)
    expect(london.ok && london.night.date).toBe('2026-10-06')
  })

  it('sets duration and time in bed to the window and nothing measured', () => {
    const p = parseManualNight({ sleepStart: BED, sleepEnd: WAKE, id: '6f1c2a4e-0b7d-4c1e-9a55-2338aa000001' }, BNE, NOW)
    expect(p).toEqual({ ok: true, night: {
      id: '6f1c2a4e-0b7d-4c1e-9a55-2338aa000001', date: '2026-10-07',
      sleepStart: new Date(BED), sleepEnd: new Date(WAKE), durationHours: 8, timeInBedHours: 8,
    } })
  })

  it('accepts an offset other than Z', () => {
    const p = parseManualNight({ sleepStart: '2026-10-06T22:30:00+10:00', sleepEnd: '2026-10-07T06:30:00+10:00' }, BNE, NOW)
    expect(p.ok && p.night.sleepEnd.toISOString()).toBe(WAKE)
  })

  it('refuses a malformed body with the zod issues, and an extra field (strict)', () => {
    for (const body of [
      {}, { sleepStart: BED }, { sleepStart: 'last night', sleepEnd: WAKE },
      { sleepStart: BED, sleepEnd: WAKE, id: 'not-a-uuid' },
      { sleepStart: BED, sleepEnd: WAKE, userId: '00000000-0000-4000-8000-000000000001' },
      { sleepStart: BED, sleepEnd: WAKE, date: '2026-10-07' },
    ]) {
      const p = parseManualNight(body, BNE, NOW)
      expect(p.ok, JSON.stringify(body)).toBe(false)
      expect(!p.ok && p.issues, JSON.stringify(body)).toBeTruthy()
    }
  })

  it('refuses an implausible night with a reason and no zod issues', () => {
    const p = parseManualNight({ sleepStart: WAKE, sleepEnd: BED }, BNE, NOW)
    expect(p.ok).toBe(false)
    expect(!p.ok && p.issues).toBeUndefined()
  })

  it('manualNightFromWindow rounds to two decimals', () => {
    const n = manualNightFromWindow(new Date(BED), new Date('2026-10-06T19:50:00.000Z'), BNE)
    expect(n.durationHours).toBe(7.33)
  })
})

describe('preferDeviceNights — a typed night loses to any device night for the same sleep', () => {
  const manual = (o: Partial<RankableSleepRow> = {}): RankableSleepRow & { id: string } => ({
    id: 'manual', date: '2026-10-07', sleepStart: BED, sleepEnd: WAKE, durationHours: 8, manualEntry: true, ...o,
  })
  const device = (o: Partial<RankableSleepRow> & { id?: string } = {}): RankableSleepRow & { id: string } => ({
    id: 'ring', date: '2026-10-07', sleepStart: '2026-10-06T13:10:00.000Z', sleepEnd: '2026-10-06T20:05:00.000Z',
    durationHours: 6.4, manualEntry: false, ...o,
  })
  const ids = (rows: { id: string }[]) => rows.map(r => r.id)

  it('keeps a manual night no device saw', () => {
    expect(ids(preferDeviceNights([manual()]))).toEqual(['manual'])
  })

  it('drops it when a device window overlaps it, even on a different stored date', () => {
    expect(ids(preferDeviceNights([manual(), device()]))).toEqual(['ring'])
    expect(ids(preferDeviceNights([manual(), device({ date: '2026-10-06' })]))).toEqual(['ring'])
  })

  it('drops it for a device night of four hours or more on the same date that does not overlap', () => {
    const shifted = device({ sleepStart: '2026-10-06T21:00:00.000Z', sleepEnd: '2026-10-07T01:30:00.000Z', durationHours: 4.5 })
    expect(ids(preferDeviceNights([manual(), shifted]))).toEqual(['ring'])
  })

  it('keeps it beside a short daytime nap on the same date', () => {
    const nap = device({ id: 'nap', sleepStart: '2026-10-07T04:00:00.000Z', sleepEnd: '2026-10-07T05:00:00.000Z', durationHours: 1 })
    expect(ids(preferDeviceNights([manual(), nap]))).toEqual(['manual', 'nap'])
  })

  it('drops it for a same-date device row with no window (pulled before SQLite v50)', () => {
    expect(ids(preferDeviceNights([manual(), device({ sleepStart: null, sleepEnd: null })]))).toEqual(['ring'])
  })

  it('ignores a device row that records no sleep', () => {
    expect(ids(preferDeviceNights([manual(), device({ durationHours: 0 })]))).toEqual(['manual', 'ring'])
  })

  it('a device night on another date does not touch it', () => {
    const yesterday = device({ date: '2026-10-06', sleepStart: '2026-10-05T12:00:00.000Z', sleepEnd: '2026-10-05T20:00:00.000Z', durationHours: 8 })
    expect(ids(preferDeviceNights([manual(), yesterday]))).toEqual(['manual', 'ring'])
  })

  it('keeps only the newest of two manual rows for one date', () => {
    const older = manual({ id: 'old', updatedAt: '2026-10-07T00:00:00.000Z' } as never)
    const newer = manual({ id: 'new', updatedAt: '2026-10-07T01:00:00.000Z' } as never)
    expect(ids(preferDeviceNights([newer, older]))).toEqual(['new'])
    expect(ids(preferDeviceNights([older, newer]))).toEqual(['new'])
  })

  it('works on Date windows (the server rows) as well as strings (the device rows)', () => {
    const asDates = (r: RankableSleepRow & { id: string }) => ({ ...r, sleepStart: new Date(r.sleepStart as string), sleepEnd: new Date(r.sleepEnd as string) })
    expect(ids(preferDeviceNights([asDates(manual()), asDates(device())]))).toEqual(['ring'])
  })

  // The reason it runs before the night pickers rather than inside them: left in, the typed night
  // and the measured one overlap, and the grouping treats them as one fragmented night.
  it('without it the night pickers would sum the two into one impossible night', () => {
    const rows = [manual(), device()].map(r => ({ ...r, sleepStart: new Date(r.sleepStart as string), sleepEnd: new Date(r.sleepEnd as string) }))
    const raw = canonicalLatestNight(nightSessions(rows, BNE), BNE)
    expect(raw!.durationHours).toBeCloseTo(14.4, 1)
    const ranked = canonicalLatestNight(nightSessions(preferDeviceNights(rows), BNE), BNE)
    expect(ranked!.durationHours).toBe(6.4)
  })
})
