import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { calculateBaseline } from '@trainingai/shared/nutrition/goal-recommendation'
import { goalBaseline } from '../goal-baseline'
import type { User } from '@trainingai/shared/types'

const ROOT = path.resolve(__dirname, '../../..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

/**
 * BF-101 — the "Recommended" affordance on the goals form.
 *
 * The owner's instinct was that these numbers do not need a model, and he was right: every field on
 * that screen except sleep already has a deterministic value in `calculateBaseline`. What this
 * guards is the three ways that promise silently stops being true — the deterministic path growing
 * a network call, the button appearing where no baseline exists, and the two paths drifting into
 * quoting different numbers for the same profile.
 */

const COMPLETE_USER = {
  id: 'u1',
  heightCm: 178,
  dateOfBirth: '1990-06-15',
  sex: 'male',
  activityLevel: 'moderate',
  fitnessGoal: 'recomp',
} as unknown as User

const INPUT = { user: COMPLETE_USER, latestWeightKg: 71.7, latestBodyFatPct: 18.4, measuredRmr: null }

describe('goalBaseline', () => {
  it('is calculateBaseline, not a second formula', () => {
    const ageYears = new Date().getFullYear() - 1990 - (new Date() < new Date(`${new Date().getFullYear()}-06-15`) ? 1 : 0)
    expect(goalBaseline(INPUT)).toEqual(calculateBaseline({
      weightKg: 71.7,
      heightCm: 178,
      ageYears,
      sex: 'male',
      activityLevel: 'moderate',
      fitnessGoal: 'recomp',
      bodyFatPct: 18.4,
      measuredRmr: null,
    }))
  })

  it('carries the measured RMR through, so the button cannot quote a predicted resting rate', () => {
    // BF-33's whole point: a measurement outranks the prediction. If `goalBaseline` dropped the
    // field the two would tie, which is what makes this assertion an inequality rather than a value.
    const measured = goalBaseline({ ...INPUT, measuredRmr: { rmrKcal: 1900, ffmKgAtTest: 58 } })
    expect(measured!.calories).not.toBe(goalBaseline(INPUT)!.calories)
  })

  it.each([
    ['weight', { latestWeightKg: null }],
    ['height', { user: { ...COMPLETE_USER, heightCm: null } as unknown as User }],
    ['date of birth', { user: { ...COMPLETE_USER, dateOfBirth: null } as unknown as User }],
    ['sex', { user: { ...COMPLETE_USER, sex: null } as unknown as User }],
    ['activity level', { user: { ...COMPLETE_USER, activityLevel: null } as unknown as User }],
    ['fitness goal', { user: { ...COMPLETE_USER, fitnessGoal: null } as unknown as User }],
    ['the whole user', { user: null }],
  ])('withholds everything when %s is missing', (_label, patch) => {
    // Not "falls back to a default": `calculateBaseline` would happily return numbers computed from
    // a sex and an activity level the user never chose, and a Recommended button rendering one of
    // those is worse than no button at all.
    expect(goalBaseline({ ...INPUT, ...patch })).toBeNull()
  })

  it('needs no body fat — Mifflin-St Jeor is the documented fallback', () => {
    expect(goalBaseline({ ...INPUT, latestBodyFatPct: null })).not.toBeNull()
  })
})

describe('the deterministic path makes no model call', () => {
  it.each(['components/profile/goal-baseline.ts', 'components/profile/recommended-value.tsx'])('%s', rel => {
    // Comments stripped first: `goal-baseline.ts` names the recommend route in prose, explaining
    // that it shares that route's baseline rather than calling it. Matching the prose would make
    // this assertion fail for the documentation that justifies it.
    const src = read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(src).not.toMatch(/fetch\s*\(/)
    expect(src).not.toMatch(/\/api\//)
  })
})

describe('no button where there is no baseline', () => {
  it('Sleep Goal has no Recommended control', () => {
    // `BaselineResult` carries no sleep field. The failure this pins is not a typo but a later
    // session adding "8 hours" to be consistent — an unsourced number sitting beside sourced ones.
    const src = read('components/profile/goal-targets-section.tsx')
    const start = src.indexOf('{/* Sleep Goal */}')
    const end = src.indexOf('{/* Water Goal */}')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(src.slice(start, end)).not.toContain('RecommendedValue')
  })

  it('Fiber has no baseline key in the macro pane', () => {
    const src = read('components/profile/macro-targets-pane.tsx')
    const fiber = src.split('\n').find(l => l.includes("key: 'fiberG'"))
    expect(fiber).toBeDefined()
    expect(fiber).not.toContain('baselineKey')
  })
})
