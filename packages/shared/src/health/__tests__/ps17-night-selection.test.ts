// PS-17 — a phantom afternoon "sleep" replaced a real night in the daily summary.
//
// These are the actual 2026-08-27 rows from production, in UTC (Brisbane is UTC+10):
//   real night  2026-08-26 23:02 → 08-27 06:37 local, 7.42 h, efficiency 98, HRV 61.5
//   phantom     2026-08-27 11:35 → 08-27 16:52 local, 4.75 h, efficiency 89, HRV 26.5
//
// The summary took the phantom, so that day scored on HRV 26.5 and RHR 74 — awake daytime values,
// roughly half the HRV and 13 bpm above the surrounding days.
//
// **The rule was never missing; the rollup just did not use it.** `nightForDate` already documents
// "the longer wins — total sleep, not recency", and the rollup's own resolution loop did a bare
// `.set()` per period, which is last-wins. This pins the three facts that combine to produce the
// fault, so a change to any one of them is visible.
import { describe, it, expect } from 'vitest'
import {
  groupSleepPeriods, isNightWindow, nightForDate, nightPeriodsByDate, totalSleepHours,
  ALWAYS_NIGHT_MIN_HOURS,
} from '../sleep-night'

const realNight = {
  sleepStart: new Date('2026-08-26T13:02:00Z'),
  sleepEnd: new Date('2026-08-26T20:37:00Z'),
  durationHours: 7.42,
}
const phantom = {
  sleepStart: new Date('2026-08-27T01:35:00Z'),
  sleepEnd: new Date('2026-08-27T06:52:00Z'),
  durationHours: 4.75,
}

describe('PS-17: the 2026-08-27 phantom', () => {
  // Fact 1 — why it is a "night" at all. Its midpoint is 14:13 local, far outside the 21:00–10:00
  // band, but ALWAYS_NIGHT_MIN_HOURS short-circuits the circadian check for anything >= 4 h.
  // That escape hatch protects shift workers and is NOT changed here; this records that it is what
  // lets a 4.75 h daytime artefact through.
  it('passes the circadian check only via the ALWAYS_NIGHT_MIN_HOURS escape hatch', () => {
    expect(phantom.durationHours).toBeGreaterThanOrEqual(ALWAYS_NIGHT_MIN_HOURS)
    expect(isNightWindow(phantom)).toBe(true)
  })

  // Fact 2 — both land on the same wake day, as two separate periods: the gap from 06:37 to 11:35
  // is ~5 h, well past MAX_INTRA_NIGHT_GAP_HOURS, so they never merge.
  it('produces two night periods on the same wake date', () => {
    const { nights } = groupSleepPeriods([realNight, phantom])
    expect(nights.map(n => n.date)).toEqual(['2026-08-27', '2026-08-27'])
  })

  // Fact 3 — the bug, stated as the thing the rollup used to do.
  it('is what a last-wins `.set()` per period selects', () => {
    const { nights } = groupSleepPeriods([realNight, phantom])
    const lastWins = new Map<string, number>()
    for (const n of nights) {
      lastWins.set(n.date, n.windows.reduce((s, w) => s + (w.durationHours ?? 0), 0))
    }
    expect(lastWins.get('2026-08-27')).toBe(4.75)
  })

  // The fix. `nightPeriodsByDate` is the function the BLE rollup now calls, so this pins the real
  // code path rather than a re-implementation of it — the previous version of this test inlined the
  // loop, which would have passed even with the rollup still on last-wins.
  it('loses to the real night under nightPeriodsByDate, in either arrival order', () => {
    for (const order of [[realNight, phantom], [phantom, realNight]]) {
      const picked = nightPeriodsByDate(groupSleepPeriods(order).nights).get('2026-08-27')
      expect(totalSleepHours(picked!)).toBe(7.42)
    }
  })

  // One period per date, so the phantom cannot also survive as a second entry.
  it('collapses the date to exactly one night', () => {
    const byDate = nightPeriodsByDate(groupSleepPeriods([realNight, phantom]).nights)
    expect(byDate.size).toBe(1)
  })

  // The rule already lived here. If this ever disagrees with the loop above, the rollup has drifted
  // from the module again — which is the whole shape of this bug.
  it('agrees with nightForDate, which had the rule all along', () => {
    const picked = nightForDate([realNight, phantom], '2026-08-27')
    expect(picked?.windows[0].durationHours).toBe(7.42)
  })
})
