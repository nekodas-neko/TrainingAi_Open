// Q-226. The owner opened "Exercise Readiness — Before Upper" and saw five muscles selected
// (Chest, Shoulders, Triceps, Quads, Calves) plus a whole-session-deload warning. Closing and
// reopening a minute later showed two (Quads, Calves) and no warning.
//
// Not a cache bug. `MoodCheckInSheet` is rendered unconditionally with `open` as a prop, so it never
// remounts and its state survives every close. The reset effect ran `setSoreMuscles(suggested)` with
// no `suggested` dependency, so it closed over whatever that state was left at by the *previous*
// open. `cachedFetch` always awaits a real request before its onData fires, so the correct value
// cannot possibly be in `suggested` during the pass that reset effect runs in — and the later
// seeding effect's `prev.length === 0` guard then refused to correct a list that was already full.
//
// This is a source-text guard because the repo has no React component-testing stack — no
// @testing-library, no .tsx test files — and adding one to cover a two-line change would be a much
// larger commitment than the change itself. What it can pin precisely is the two facts the bug was
// made of: the reset must not read `suggested`, and the effect that does read it must re-run when it
// resolves. Both are invisible to the type system, which is why the bug survived.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(join(process.cwd(), 'components/mood-checkin-sheet.tsx'), 'utf8')

/** The `else` arm of the initialLog effect — the fresh-check-in reset. */
const resetArm = () => {
  const start = SRC.indexOf('setEnergy(readinessToEnergy(readiness))')
  const end = SRC.indexOf('}, [initialLog, open])', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return SRC.slice(start, end)
}

describe('the sore-muscle picker seeds from suggestions exactly once, and never from a stale one (Q-226)', () => {
  it('found the reset arm to assert against', () => {
    // Without this the slices could be empty and every case below would pass on absence.
    expect(resetArm().length).toBeGreaterThan(100)
  })

  // The bug itself, in one assertion.
  it('the fresh-check-in reset does not read `suggested`', () => {
    expect(resetArm()).not.toMatch(/setSoreMuscles\(\s*suggested\s*\)/)
    expect(resetArm()).toMatch(/setSoreMuscles\(\s*\[\]\s*\)/)
  })

  // The other stale read, and the reason clearing it in the reset effect is not enough on its own:
  // both effects run in the same flush, so `suggested` still holds the previous open's value during
  // the reset pass. It has to be reassigned unconditionally here, cache hit or miss.
  it('the cache seed assigns `suggested` even on a miss, so it cannot survive an open', () => {
    expect(SRC).toMatch(/setSuggested\(seed \? suggestedSoreMuscles\(seed\.muscles, ALL_SORE_MUSCLES\) : \[\]\)/)
    expect(SRC).not.toMatch(/if \(seed\) setSuggested\(/)
  })

  // The other half: something has to seed, and it has to re-run when the fetch lands.
  it('the seeding effect depends on `suggested`, so it re-runs when the fetch resolves', () => {
    expect(SRC).toMatch(/\}, \[open, initialLog, suggested, seededFromSuggestions\]\)/)
  })

  it('still only fills an untouched list, so a deselected muscle is never re-added', () => {
    expect(SRC).toMatch(/setSoreMuscles\(prev => \(prev\.length === 0 \? suggested : prev\)\)/)
  })

  it('still latches per open, so a resolved fetch cannot re-seed mid-session', () => {
    expect(SRC).toMatch(/if \(!open\) \{ setSeededFromSuggestions\(false\); return \}/)
    expect(SRC).toMatch(/if \(initialLog \|\| seededFromSuggestions \|\| suggested\.length === 0\) return/)
  })

  // An edited check-in restores what was saved and must not be touched by any of the above.
  it('an existing log still restores its own saved muscles', () => {
    expect(SRC).toMatch(/setSoreMuscles\(initialLog\.soreMuscles\)/)
  })
})
