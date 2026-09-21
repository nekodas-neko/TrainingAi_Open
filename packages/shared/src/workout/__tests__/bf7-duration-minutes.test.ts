// BF-7 PR 2b (engine half) — the duration ladder takes minutes, and the three labels still work.
//
// The owner asked for a 45-minute session: *"id like to have the ability to choose a 45min session
// … but have the option to slide to 15/30/45/60/90options?"*, then settled the shape on 2026-08-23:
// *"yes I agree lets anchor to session; dont need 15minutes"*. So the control offers absolute
// minutes AROUND the session's configured length, which stays the anchor and the default.
//
// **The plan said the labels could be dropped because nothing is persisted. They are persisted.**
// `durationPreset` is a field on `AiPrescription`, which lives in `session_periodization.prescription`
// — 10 of 10 production rows carried one when this was written. Narrowing the type to `number` would
// have made every stored prescription unreadable by the code that reads it back. Hence the union,
// and hence `DURATION_PRESET_DELTA_MIN` surviving as the legacy decoder rather than being deleted.
import { describe, it, expect } from 'vitest'
import {
  requestedBudgetMin,
  budgetForPreset,
  durationDirection,
  warmupGoalSecFor,
  MIN_PRESET_BUDGET_MIN,
  DURATION_PRESET_DELTA_MIN,
} from '@trainingai/shared/workout/duration-model'

describe('a number is an absolute request in minutes (BF-7)', () => {
  it('asks for exactly the minutes chosen, whatever the session is configured at', () => {
    expect(requestedBudgetMin(60, 45)).toBe(45)
    expect(requestedBudgetMin(45, 45)).toBe(45)
    expect(requestedBudgetMin(90, 45)).toBe(45)
  })

  // The case the owner's request is named after, and the one the entry says proves the comparison
  // is against the session's own budget rather than a hardcoded 60.
  it('a 45-minute session anchors at 45, and choosing 60 on it EXPANDS', () => {
    expect(durationDirection(45, 45)).toBe(0)
    expect(durationDirection(45, 60)).toBe(1)
    expect(durationDirection(45, 30)).toBe(-1)
  })

  it('the ladder the owner asked for reads correctly on a 60-minute session', () => {
    expect(durationDirection(60, 30)).toBe(-1)
    expect(durationDirection(60, 45)).toBe(-1)
    expect(durationDirection(60, 60)).toBe(0)
    expect(durationDirection(60, 90)).toBe(1)
  })

  // The single most valuable invariant in this area: the under-fill at the anchor IS the
  // finish-early margin, so the anchor must never select expansion.
  it('choosing the anchor never expands, by number or by label', () => {
    expect(durationDirection(60, 60)).toBe(0)
    expect(durationDirection(60, 'standard')).toBe(0)
    expect(durationDirection(37, 37)).toBe(0)
  })

  it('still clamps what is achievable at the model floor', () => {
    expect(budgetForPreset(60, 5)).toBe(MIN_PRESET_BUDGET_MIN)
    // ...while the DIRECTION comes from the request, so a floored session still drops exercises
    // rather than silently switching to trimming sets (PR 2a's correction, extended to numbers).
    expect(durationDirection(MIN_PRESET_BUDGET_MIN, 5)).toBe(-1)
  })

  it('ignores a non-finite number rather than producing NaN minutes', () => {
    expect(requestedBudgetMin(60, Number.NaN)).toBe(60)
    expect(requestedBudgetMin(60, Number.POSITIVE_INFINITY)).toBe(60)
  })

  // The countdown the lifter watches is derived from the same budget the plan was built against
  // (Q-212). A number must not break that coupling.
  it('the warm-up countdown follows a numeric choice', () => {
    expect(warmupGoalSecFor(60, 30)).toBe(warmupGoalSecFor(60, 'short'))
    expect(warmupGoalSecFor(60, 60)).toBe(warmupGoalSecFor(60, 'standard'))
    expect(warmupGoalSecFor(60, 90)).toBe(warmupGoalSecFor(60, 'long'))
  })
})

describe('the stored labels still resolve (the plan said they would not need to)', () => {
  it('reads the three persisted values exactly as before', () => {
    expect(requestedBudgetMin(60, 'short')).toBe(60 - DURATION_PRESET_DELTA_MIN)
    expect(requestedBudgetMin(60, 'standard')).toBe(60)
    expect(requestedBudgetMin(60, 'long')).toBe(60 + DURATION_PRESET_DELTA_MIN)
  })

  // The labels are RELATIVE and the numbers are ABSOLUTE — that is the whole difference, and on a
  // non-60 session the two disagree. This is what makes dropping the labels a data change rather
  // than a rename, which is what the plan missed.
  it('a label and the number it looks like are NOT the same on a 45-minute session', () => {
    expect(requestedBudgetMin(45, 'short')).toBe(15)
    expect(requestedBudgetMin(45, 30)).toBe(30)
    expect(requestedBudgetMin(45, 'long')).toBe(75)
    expect(requestedBudgetMin(45, 90)).toBe(90)
  })

  // CONTROL — undefined is not a choice and must keep meaning "the session's own length". A fix
  // that treated a missing preset as 0 minutes would pass everything above and fail here.
  it('no choice at all still means the anchor', () => {
    expect(requestedBudgetMin(60, undefined)).toBe(60)
    expect(durationDirection(60, undefined)).toBe(0)
    expect(budgetForPreset(60, undefined)).toBe(60)
  })
})
