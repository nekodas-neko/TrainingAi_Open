/**
 * RV-217 — the Sleep contributors list rendered three raw keys: "hrv", "hr", "schedule",
 * lowercase and without a chevron, beside seven properly labelled rows (seen on the device,
 * sweep 64 `t2-sleep-01`).
 *
 * The cause is a fall-through that is correct in itself. `sleepComponentsToContributors` maps
 * the model's component keys into Oura's vocabulary with `CONTRIBUTOR_KEYS[k] ?? k`, and Oura's
 * `daily_sleep` set is EXACTLY the seven that are mapped — `hrv`, `hr` and `schedule` are the
 * app's own additions and have no Oura counterpart, so passing them through unchanged is right.
 * What was missing is a label and a guide entry for the keys that come out the other side.
 *
 * This is the third time this class has shipped: RV-201 found `hrvBalance` reading as a raw key
 * in the readiness insight, and the same entry found `checkin`/`temperature`/`prevDayActivity`.
 * So the test DERIVES the keys by running the model rather than listing them — a list is what
 * lets the next component arrive unlabelled.
 */
import { describe, it, expect } from 'vitest'
import { computeSleepScore, sleepComponentsToContributors } from '@trainingai/shared/health/sleep-score'
import { guideFor } from '@trainingai/shared/health/contributor-guide'
import { labelFor } from '@/lib/oura/contributors'
import { READINESS_WEIGHTS } from '@trainingai/shared/health/readiness-composite'
import type { SleepSession } from '@trainingai/shared/types/body'

const TZ = 'Australia/Brisbane'

/** A night that fires EVERY optional branch, so the component set is the full ten. */
const fullNight: SleepSession = {
  id: 's1', userId: 'u1', date: '2026-07-09',
  sleepStart: new Date('2026-07-08T13:00:00Z'),
  sleepEnd: new Date('2026-07-08T21:00:00Z'),
  createdAt: new Date('2026-07-09T00:00:00Z'),
  durationHours: 8,
  efficiency: 92,
  remSleepHours: 1.5,
  deepSleepHours: 1.2,
  onsetLatencySec: 12 * 60,
  awakHours: 0.4,
  averageHrvMs: 55,
  avgHeartRate: 58,
}

const contributors = () => {
  const r = computeSleepScore(fullNight, TZ, {
    hrvBaselineMs: 50,
    hrBaselineBpm: 60,
    habitualBedHour: 23,
    habitualWakeHour: 7,
  })!
  return Object.keys(sleepComponentsToContributors(r.components))
}

describe('every sleep contributor the model emits is presentable', () => {
  // Guards the vacuous case: if a refactor stopped the optional branches firing, the checks
  // below would pass over a handful of keys and prove nothing.
  it('emits all ten components for a night that has everything', () => {
    const keys = contributors()
    expect(keys).toHaveLength(10)
    // The three this entry is about, in the form they actually reach the UI.
    expect(keys).toEqual(expect.arrayContaining(['hrv', 'hr', 'schedule']))
  })

  it('has a human label for every one — never the raw key', () => {
    for (const key of contributors()) {
      const label = labelFor(key)
      expect(label, `${key} has no label and renders as itself`).not.toBe(key)
      // `labelFor`'s fallback is `key.replace(/_/g, ' ')`, so an underscored key with no entry
      // comes back merely de-underscored. That is still the raw key, and it is what "total sleep"
      // would have looked like had its label been missing too.
      expect(label, `${key} fell through to the de-underscored fallback`).not.toBe(key.replace(/_/g, ' '))
      expect(label[0], `${key}'s label is not capitalised`).toBe(label[0].toUpperCase())
    }
  })

  it('has an explanation for every one, so every row can carry a chevron', () => {
    for (const key of contributors()) {
      expect(guideFor(key), `${key} has no contributor-guide entry`).not.toBeNull()
    }
  })
})

/**
 * The sibling sweep RV-217 asks for. Readiness's labels were fixed by RV-201 and its GUIDE was
 * not: `checkin` had a label and no explanation, so it was the one row on "What goes into this
 * score" that read correctly and then did nothing when tapped. Keyed off `READINESS_WEIGHTS`
 * directly, so a tenth contributor cannot arrive without an entry here.
 */
describe('every readiness contributor is presentable too', () => {
  const keys = Object.keys(READINESS_WEIGHTS)

  it('covers all eight', () => {
    expect(keys).toHaveLength(8)
  })

  it('has a label and an explanation for every one', () => {
    for (const key of keys) {
      expect(labelFor(key), `${key} renders as its raw key`).not.toBe(key)
      expect(guideFor(key), `${key} has no contributor-guide entry`).not.toBeNull()
    }
  })

  // #2224 took `checkin` out of the model, and every derived row written before that still stores
  // it. Those rows are rendered too, so the retired key keeps both its label and its guide.
  it('still presents the retired check-in term on rows written before #2224', () => {
    expect(keys).not.toContain('checkin')
    expect(labelFor('checkin')).not.toBe('checkin')
    expect(guideFor('checkin')).not.toBeNull()
  })
})
