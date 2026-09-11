// RV-41 — one column, two validators, and the looser one was the LLM's.
//
// Measured 2026-09-03: `PUT /api/nutrition/targets {"calories":26000}` answered
// `400 expected number to be <=20000`, while the same value through `/api/coach/apply` returned 200
// and read back from Postgres as 26000. The macro fields were 50× apart. The Coach's patch schema
// carried one shared `max(100_000)` for all seven fields.
//
// These tests pin the two schemas *against each other* rather than against a literal: a test that
// hardcoded 20,000 would pass just as happily if the two sides drifted again, since each would still
// match its own copy of the number. What must hold is that they read the same source.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { GOAL_BOUNDS, goalBoundSchema, type GoalBoundField } from '../goal-bounds'

const COACH_FIELDS = ['calories', 'proteinG', 'carbsG', 'fatG', 'stepsGoal', 'calorieGoal', 'waterGoalMl'] as const

describe('RV-41 — the Coach cannot write a goal the user routes refuse', () => {
  it.each(COACH_FIELDS)('%s: the value just over the bound is refused', field => {
    const over = GOAL_BOUNDS[field].max + 1
    expect(goalBoundSchema(field).safeParse(over).success).toBe(false)
  })

  it.each(COACH_FIELDS)('%s: the bound itself is still accepted', field => {
    expect(goalBoundSchema(field).safeParse(GOAL_BOUNDS[field].max).success).toBe(true)
  })

  it.each(COACH_FIELDS)('%s: below zero is refused', field => {
    expect(goalBoundSchema(field).safeParse(-1).success).toBe(false)
  })

  // The specific numbers from the write-up, kept because they are what the owner saw stored.
  it('refuses the 26,000 kcal the confirmation card once rendered', () => {
    expect(goalBoundSchema('calories').safeParse(26_000).success).toBe(false)
    expect(goalBoundSchema('calorieGoal').safeParse(26_000).success).toBe(true)  // its own bound is 30,000
  })

  it('refuses 5,000 g of protein and 50,000 ml of water', () => {
    expect(goalBoundSchema('proteinG').safeParse(5_000).success).toBe(false)
    expect(goalBoundSchema('waterGoalMl').safeParse(50_000).success).toBe(false)
  })

  // The type diverged too, and that half cost a 500 rather than a bad number.
  it('refuses a fractional stepsGoal on every path', () => {
    expect(goalBoundSchema('stepsGoal').safeParse(8_000.5).success).toBe(false)
    expect(goalBoundSchema('stepsGoal').safeParse(8_000).success).toBe(true)
  })

  it('leaves the non-integral fields fractional', () => {
    for (const f of COACH_FIELDS) {
      if (f === 'stepsGoal') continue
      expect(goalBoundSchema(f).safeParse(100.5).success).toBe(true)
    }
  })

  // The regression guard proper is a SOURCE check, not a value one. Asserting "no bound exceeds
  // 100,000" was the obvious guard and it is wrong: `stepsGoal` is legitimately 200,000, the one
  // field whose user-route bound is looser than the Coach's old shared ceiling. A value assertion
  // here would have to carve out that exception and would then be pinning the numbers rather than
  // the thing that broke — which was two schemas each matching its own copy.
  //
  // What must hold is that the Coach's schema declares no bounds of its own.
  it('lib/coach/patch.ts declares no numeric bounds for the goal fields', () => {
    const src = readFileSync('lib/coach/patch.ts', 'utf8')
    expect(src).toContain('goalBoundSchema')
    // Comments stripped: the file explains this history in prose and names the old ceiling while
    // doing so, which is documentation rather than a bound. Checking the raw text would fail on the
    // comment that exists to stop the regression.
    const code = src.split('\n')
      .filter(l => { const t = l.trim(); return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') })
      .join('\n')
    // The exact sentinel this entry was about, in both spellings TypeScript accepts.
    expect(code).not.toContain('100_000')
    expect(code).not.toContain('100000')
  })

  // A field the Coach can write but GOAL_BOUNDS does not know about would fall back to whatever the
  // patch schema happens to declare — which is how this started.
  it('every field the Coach can write has a declared bound', () => {
    for (const f of COACH_FIELDS) {
      expect(Object.keys(GOAL_BOUNDS)).toContain(f satisfies GoalBoundField)
    }
  })

  it('builds a real zod schema, not a passthrough', () => {
    expect(goalBoundSchema('calories')).toBeInstanceOf(z.ZodNumber)
  })
})
