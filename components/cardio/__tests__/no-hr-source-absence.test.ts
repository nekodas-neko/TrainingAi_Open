import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { computeZoneQuota, quotaHasNoHrSource } from '@trainingai/shared/health/zone-quota'
import { zoneStacksUnmeasured } from '@trainingai/shared/health/cardio-trends'
import { measuredBattery, type EndOfDayBattery } from '@/components/nutrition/end-of-day/measured-battery'
import { buildTodayInsight } from '@trainingai/shared/nutrition/day-insight'

// #2337 — three surfaces showed "no data" for a user with no ring or HR source as a real value.
// This suite runs without a JSX transform, so the cards' decisions are tested through the shared
// predicates they call, and the cards are held to calling them.

const targets = [
  { zoneId: 1 as const, minutes: 30 },
  { zoneId: 2 as const, minutes: 108 },
  { zoneId: 3 as const, minutes: 8 },
]
const src = (rel: string) => readFileSync(join(__dirname, '..', '..', '..', rel), 'utf8')

describe('ZoneQuotaCard', () => {
  it('reads a quota from a user nothing can record as absence, not "0 / 108 min"', () => {
    expect(quotaHasNoHrSource(computeZoneQuota(targets, [], { hasHrSource: false }))).toBe(true)
  })

  // An older cached payload has no flag; a failed read is null. Neither may hide a real week.
  it('keeps the numbers for a user with a source, an older payload, and an unknown source', () => {
    expect(quotaHasNoHrSource(computeZoneQuota(targets, [], { hasHrSource: true }))).toBe(false)
    expect(quotaHasNoHrSource(computeZoneQuota(targets, []))).toBe(false)
    expect(quotaHasNoHrSource(computeZoneQuota(targets, [], { hasHrSource: null }))).toBe(false)
  })

  it('renders the Time in Zone card\'s empty state through that predicate', () => {
    const quotaCard = src('components/cardio/zone-quota-card.tsx')
    const timeInZone = src('components/health/time-in-zone-card.tsx')
    // #2338 — the sentence comes from the one copy function (it names whatever the user can
    // connect, not a ring they may not own). Time in Zone passes its 'window' wording; the quota
    // has no window picker, so it uses the plain one.
    expect(timeInZone).toContain('noHrDataCopy(data?.hasHrSource, "window")')
    expect(quotaCard).toContain("noHrDataCopy(false, 'workout')")
    expect(quotaCard).toMatch(/quotaHasNoHrSource\(weekQuota\)/)
  })

  it('every reader of a cardio-week quota goes through a recommender that knows the flag', () => {
    // TimePickerSheet → recommendSession; running plan → recommendRunType; guided walk →
    // recommendWalkPattern. Each one's no-source branch is tested beside it in packages/shared.
    for (const [file, fn] of [
      ['packages/shared/src/health/session-picker.ts', 'recommendSession'],
      ['packages/shared/src/running/recommend-run-type.ts', 'recommendRunType'],
      ['packages/shared/src/walking/recommend-walk-pattern.ts', 'recommendWalkPattern'],
    ] as const) {
      const body = src(file)
      expect(body, `${fn} in ${file}`).toContain('quotaHasNoHrSource(quota)')
    }
  })
})

describe('cardio trends — zone stacks', () => {
  const zero = { weekStart: '2026-09-28', seconds: [0, 0, 0, 0, 0] as [number, number, number, number, number] }
  const real = { weekStart: '2026-09-21', seconds: [600, 0, 0, 0, 0] as [number, number, number, number, number] }

  it('is unmeasured only when no source is KNOWN and every stack is empty', () => {
    expect(zoneStacksUnmeasured([zero, zero], false)).toBe(true)
    expect(zoneStacksUnmeasured([zero, real], false)).toBe(false) // history from a source since removed
    expect(zoneStacksUnmeasured([zero, zero], true)).toBe(false)
    expect(zoneStacksUnmeasured([zero, zero], null)).toBe(false)
    expect(zoneStacksUnmeasured([zero, zero], undefined)).toBe(false)
  })
})

describe('end-of-day review — Body Battery', () => {
  const noRing: EndOfDayBattery = { current: 50, label: 'Good', trend: 'steady', charged: 0, drained: 0, hasData: false }
  const measured: EndOfDayBattery = { ...noRing, current: 38, label: 'Low', drained: 22, hasData: true }
  const scales = { physicalTiredness: 3, mentalDrain: 3, barelyMoved: 3, hydration: 3, lateHeavyMeal: 3 }
  const insightFor = (bb: EndOfDayBattery | null) => {
    const m = measuredBattery(bb)
    return buildTodayInsight({ batteryCurrent: m?.current ?? null, batteryDrained: m?.drained ?? null, scales, soreMuscles: [] })
  }

  it('never prints the default 50 as a reading', () => {
    expect(measuredBattery(noRing)).toBeNull()
    expect(insightFor(noRing)).not.toContain('Body Battery')
    expect(insightFor(noRing)).not.toContain('50')
  })

  it('still reports a measured battery exactly as before', () => {
    expect(measuredBattery(measured)).toBe(measured)
    expect(insightFor(measured)).toContain('Body Battery 38 (down 22)')
  })

  it('treats a payload cached without the flag as measured, as it was', () => {
    const { hasData: _h, ...old } = measured
    expect(measuredBattery(old)).toBe(old)
    expect(measuredBattery(null)).toBeNull()
  })
})
