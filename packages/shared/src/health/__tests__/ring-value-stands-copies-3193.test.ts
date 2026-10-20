// #3193: three readers each carried their own copy of the switch-day rule before going through
// `ringValueStands`. Each copy is kept here exactly as it read before the repoint, and the table
// proves the repointed reader picks the same value on every row, so no past day's Body Battery or
// shadow readiness moves. If `ringValueStands` ever changes, this fails before a score does.
import { describe, it, expect } from 'vitest'
import { ringValueStands } from '../source-rank'

type Pick = 'ring' | 'oura' | 'none'

interface Row { day: string; switchDay: string | null | undefined; ring: boolean; oura: boolean }

/** `lib/health/body-battery-day.ts`: Oura's `stress_high` drives the drain only with no dHRV series. */
const bodyBattery = {
  before: ({ day, switchDay, ring, oura }: Row): Pick => {
    const ouraCloudFrom = switchDay
    const date = day
    const ouraStress = !ring && ouraCloudFrom != null && date >= ouraCloudFrom && oura
    return ouraStress ? 'oura' : ring ? 'ring' : 'none'
  },
  after: ({ day, switchDay, ring, oura }: Row): Pick => {
    const ouraStress = !ring && !ringValueStands(day, switchDay) && oura
    return ouraStress ? 'oura' : ring ? 'ring' : 'none'
  },
}

/** `packages/shared/src/health/shadow-readiness/assemble.ts` `daytimeStressSeries`: Oura's day overwrites ours. */
const shadowReadiness = {
  before: ({ day, switchDay, ring, oura }: Row): Pick => {
    const from = switchDay ?? null
    let v: Pick = ring ? 'ring' : 'none'
    if (from != null) {
      if (!(day < from) && oura) v = 'oura'
    }
    return v
  },
  after: ({ day, switchDay, ring, oura }: Row): Pick => {
    const from = switchDay ?? null
    let v: Pick = ring ? 'ring' : 'none'
    if (!ringValueStands(day, from) && oura) v = 'oura'
    return v
  },
}

/** `lib/data/postgres/slices/oura.ts` `dropBleNightsOuraCloudHolds`: `oura` is a live Oura night overlapping it. */
const ouraNightKept = {
  before: ({ day, switchDay, ring, oura }: Row): Pick => {
    if (!ring) return 'none'
    if (!switchDay) return 'ring'
    if (day < switchDay) return 'ring'
    return oura ? 'oura' : 'ring'
  },
  after: ({ day, switchDay, ring, oura }: Row): Pick => {
    if (!ring) return 'none'
    if (!switchDay) return 'ring'
    if (ringValueStands(day, switchDay)) return 'ring'
    return oura ? 'oura' : 'ring'
  },
}

const COPIES = { bodyBattery, shadowReadiness, ouraNightKept }

// Days before, on and after the switch, in both separators, against every switch-day shape.
const DAYS = ['2026-10-17', '2026-10-18', '2026-10-19', '2026/10/17', '2026/10/18', '2026/10/19']
const SWITCH_DAYS: Array<string | null | undefined> = [null, undefined, '2026-10-18', '2026/10/18']
const ROWS: Row[] = DAYS.flatMap(day => SWITCH_DAYS.flatMap(switchDay =>
  [true, false].flatMap(ring => [true, false].map(oura => ({ day, switchDay, ring, oura })))))

describe('every inline switch-day copy agrees with ringValueStands (#3193)', () => {
  it('covers the full table', () => {
    expect(ROWS).toHaveLength(DAYS.length * SWITCH_DAYS.length * 4)
  })

  for (const [name, copy] of Object.entries(COPIES)) {
    it(`${name}: same pick on every row`, () => {
      const disagree = ROWS.filter(r => copy.before(r) !== copy.after(r))
      expect(disagree).toEqual([])
    })
  }

  it('the ring stands before the switch and with no switch; Oura from the switch day on', () => {
    expect(ringValueStands('2026-10-17', '2026-10-18')).toBe(true)
    expect(ringValueStands('2026-10-18', '2026-10-18')).toBe(false)
    expect(ringValueStands('2026-10-19', '2026-10-18')).toBe(false)
    expect(ringValueStands('2026-10-19', null)).toBe(true)
    expect(ringValueStands('2026-10-19', undefined)).toBe(true)
    expect(ringValueStands('2026/10/17', '2026/10/18')).toBe(true)
    expect(ringValueStands('2026/10/18', '2026/10/18')).toBe(false)
  })
})
