import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { injuredMusclesFor, injuryChipLabel, injuryLabel } from '../injury-muscles'
import type { Injury } from '@trainingai/shared/types/injury'

const injury = (muscleName: string, resolvedDate?: string): Injury => ({
  id: `i-${muscleName}-${resolvedDate ?? 'open'}`,
  userId: 'u1',
  muscleName,
  severity: 'moderate',
  startedDate: '2026-08-01',
  resolvedDate: resolvedDate ?? null,
} as Injury)

/** The owner's real case: Barbell Hip Thrust, `lower back` injured, on his Legs session. */
const HIP_THRUST = { mainMuscles: ['glutes'], secondaryMuscles: ['hamstrings', 'lower back'] }

describe('injuredMusclesFor', () => {
  it('finds the exercise muscle an active injury covers', () => {
    expect(injuredMusclesFor(HIP_THRUST, [injury('lower back')])).toEqual(['lower back'])
  })

  it('matches regardless of case on either side', () => {
    expect(injuredMusclesFor({ mainMuscles: ['Lower Back'] }, [injury('LOWER BACK')])).toEqual(['Lower Back'])
  })

  it('keeps the exercise\'s own spelling, which is what the user reads', () => {
    // The shared list is lowercased; the label must not inherit that.
    expect(injuryLabel(injuredMusclesFor({ mainMuscles: ['Lower Back'] }, [injury('lower back')])))
      .toBe('Lower Back')
  })

  it('does not print a muscle twice when it is both main and secondary', () => {
    // The pre-BF-135 filter did: it concatenated the two lists and never de-duplicated, so an
    // exercise listing the injured muscle in both read "Lower back, Lower back — train with caution".
    const both = { mainMuscles: ['lower back'], secondaryMuscles: ['lower back'] }
    expect(injuredMusclesFor(both, [injury('lower back')])).toEqual(['lower back'])
  })

  it('ignores a resolved injury', () => {
    expect(injuredMusclesFor(HIP_THRUST, [injury('lower back', '2026-08-20')])).toEqual([])
  })

  it('is empty for an exercise the injury does not touch, and for no exercise at all', () => {
    expect(injuredMusclesFor({ mainMuscles: ['chest'] }, [injury('lower back')])).toEqual([])
    expect(injuredMusclesFor(undefined, [injury('lower back')])).toEqual([])
    expect(injuredMusclesFor(HIP_THRUST, [])).toEqual([])
  })

  it('reports every injured muscle of the exercise, main before secondary', () => {
    expect(injuredMusclesFor(HIP_THRUST, [injury('hamstrings'), injury('glutes')]))
      .toEqual(['glutes', 'hamstrings'])
  })
})

describe('injuryLabel', () => {
  it('title-cases and joins', () => {
    expect(injuryLabel(['lower back', 'glutes'])).toBe('Lower back, Glutes')
    expect(injuryLabel([])).toBe('')
  })
})

/**
 * BF-135's structural half, read off the source.
 *
 * The reported failure is vertical: a `flex-none` header above a `min-h-0` set list, with the log
 * sheet covering the bottom of the screen. Nothing renders in a test runner, so what is asserted
 * here is the shape that made the squeeze possible — a header that could grow without bound, and
 * the second full-width banner that grew it.
 */
const ROOT = path.resolve(__dirname, '../../..')
const raw = readFileSync(path.join(ROOT, 'components/workout/active-workout-screen.tsx'), 'utf8')
/** The comments explain the removed banner by quoting it, so a raw match would pass on prose. */
const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

describe('the active-exercise header cannot squeeze the set list', () => {
  it('caps and scrolls instead of growing without bound', () => {
    expect(code).toMatch(/flex-none max-h-\[\d+%\] overflow-y-auto overscroll-contain/)
  })

  it('no longer renders the AMRAP instruction during the set', () => {
    // It is on the ready screen, in fuller form, for every exercise. Two copies on one flow is what
    // made this the second banner. `isBaseline` never clears while BF-131 is open, so this one was
    // permanent rather than a first-session artefact.
    expect(code).not.toMatch(/AMRAP Test — pick a challenging weight/)
    expect(raw).toMatch(/Pick a weight you can manage for 8–15 reps/)
  })

  it('still warns about the injury on both screens, and both can swap', () => {
    expect(code).toMatch(/<InjuryBanner muscles=\{injuredMuscles\} onSwap=\{requestSwap\}/)
    expect(code).toMatch(/<InjuryChip muscles=\{injuredMuscles\} onSwap=\{requestSwap\}/)
  })

  it('does not re-derive the injured muscles in the JSX', () => {
    // The pre-fix version computed them inside an IIFE in the active branch only, which is why the
    // ready screen — where the swap decision is made — had no warning at all.
    expect(code).not.toMatch(/activeInjuries\.some\(/)
  })
})

describe('injuryChipLabel — the compact form the chip has room for', () => {
  it('is the muscle itself when there is one', () => {
    expect(injuryChipLabel(['lower back'])).toBe('Lower back')
  })

  it('counts the rest rather than truncating the list', () => {
    expect(injuryChipLabel(['lower back', 'glutes'])).toBe('Lower back +1')
    expect(injuryChipLabel(['glutes', 'hamstrings', 'lower back'])).toBe('Glutes +2')
  })

  it('is empty for nothing injured, so the chip renders nothing at all', () => {
    expect(injuryChipLabel([])).toBe('')
  })
})
