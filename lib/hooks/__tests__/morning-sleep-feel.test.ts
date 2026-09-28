import { describe, it, expect } from 'vitest'
import { sleepFeelFromStored } from '@/lib/hooks/morning-sleep-feel-scale'
import { MORNING_SCALES } from '@trainingai/shared/types/day-checkin'
import { answeredMorningScales } from '@trainingai/shared/health/self-report'

/**
 * LA-136 — the sleep line on Home reads the stored 1–5 the RIGHT WAY ROUND.
 *
 * `sleepQualityFeel` is stored **1 = slept great … 5 = terrible** and `MORNING_SCALES.labels` runs
 * worst → best in *screen* order, so the two disagree by construction. A source-matching guard
 * cannot tell one direction from the other — `6 - stored` and `stored` are both plausible-looking
 * code — so this asserts the mapping by calling it. Get it backwards and Home tells him he slept
 * terribly after his best night, which is worse than showing nothing.
 */
describe('sleepFeelFromStored', () => {
  it('maps the BEST stored value (1) to the best label and a full five dots', () => {
    const best = sleepFeelFromStored(1)
    expect(best).not.toBeNull()
    expect(best!.label).toBe('Great')
    expect(best!.position).toBe(5)
  })

  it('maps the WORST stored value (5) to the worst label and a single dot', () => {
    const worst = sleepFeelFromStored(5)
    expect(worst!.label).toBe('Terrible')
    expect(worst!.position).toBe(1)
  })

  it('agrees with the check-in sheet at every point on the scale', () => {
    // The sheet's own source of truth: labels in SCREEN order, position 1..5. Derived here rather
    // than restated, so a change to the scale fails this test instead of silently diverging from it.
    const screen = MORNING_SCALES.find(s => s.key === 'sleepQualityFeel')!.labels
    for (let stored = 1; stored <= 5; stored++) {
      const feel = sleepFeelFromStored(stored)!
      expect(feel.position, `stored ${stored}`).toBe(6 - stored)
      expect(feel.label, `stored ${stored}`).toBe(screen[feel.position - 1])
    }
  })

  it('renders nothing rather than a zero when he has not answered', () => {
    for (const absent of [null, undefined]) expect(sleepFeelFromStored(absent)).toBeNull()
  })

  it('rejects an out-of-range or fractional value instead of showing a sixth dot', () => {
    for (const bad of [0, 6, -1, 2.5, NaN]) expect(sleepFeelFromStored(bad)).toBeNull()
  })
})

/**
 * The gate that makes the caption *"Your rating, not a score"* true.
 *
 * The morning sheet writes a NEUTRAL 3 for a scale he never tapped (`NEUTRAL_SCALES`), flagged
 * `sleepQualityFeelTouched: false`. Reading the column directly would put *"OK · 3/5 · Your rating"*
 * on Home for a value nobody gave — which is the fabricated `Sleep: OK` this entry exists to undo,
 * down to the string. Four earlier readers made exactly that mistake against 78 such values.
 */
describe('the untouched neutral seed never reaches the line', () => {
  it('drops an untouched 3 — the sheet default — and keeps a touched one', () => {
    const untouched = answeredMorningScales({
      perceivedRecovery: 3, sleepQualityFeel: 3,
      perceivedRecoveryTouched: false, sleepQualityFeelTouched: false,
    })
    expect(sleepFeelFromStored(untouched.sleepQualityFeel)).toBeNull()

    const touched = answeredMorningScales({
      perceivedRecovery: 3, sleepQualityFeel: 3,
      perceivedRecoveryTouched: false, sleepQualityFeelTouched: true,
    })
    expect(sleepFeelFromStored(touched.sleepQualityFeel)!.label).toBe('OK')
  })
})
