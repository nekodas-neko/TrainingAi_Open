import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { stripComments } from '../../../scripts/lib/strip-comments.js'

const ROOT = path.resolve(__dirname, '../../..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
/** The comments explain the fix by quoting the old strings, so a scanner that reads them misfires. */
const code = (rel: string) =>
  stripComments(read(rel))

/**
 * BF-196 — two numbers in different units, neither saying so.
 *
 * The prescription card's estimate is measured against the WORKING budget (session budget minus the
 * measured warm-up carve-out), so a 60-minute session reads ~51. The done screen's tile is wall
 * clock from the start of the warm-up. Side by side they invited "51 of my 60" and "48 is way under
 * 60"; measured, the session was exactly full (51 planned against a 51-minute working budget).
 */
describe('BF-196 — the working estimate names its unit', () => {
  it('the prescription card does not render a bare minute count', () => {
    const src = code('components/workout/ai-prescription-card.tsx')
    expect(src).toMatch(/estimatedSessionDurationMin\} min of work/)
    expect(src).not.toMatch(/estimatedSessionDurationMin\} min`/)
  })

  it('matches the picker rendering the same number on the same screen', () => {
    // pre-workout-screen mounts SessionDurationPicker directly above AiPrescriptionCard and feeds
    // both from prescription.estimatedSessionDurationMin. One quantity, one phrase.
    const picker = code('components/workout/session-duration-picker.tsx')
    const card = code('components/workout/ai-prescription-card.tsx')
    const phrase = /min of work/
    expect(picker).toMatch(phrase)
    expect(card).toMatch(phrase)

    const screen = code('components/workout/pre-workout-screen.tsx')
    expect(screen).toMatch(/estimatedMin=\{periodization\.state\.prescription\.estimatedSessionDurationMin\}/)
  })
})

describe('BF-196 — the completed-session tile names the other unit', () => {
  it('the tile is labelled as total, not as a bare duration', () => {
    const src = code('components/workout/done-screen.tsx')
    expect(src).toMatch(/label: "Total time"/)
    expect(src).not.toMatch(/label: "Duration"/)
  })

  it('the naming is on the LABEL, so the value stays a clean tabular number', () => {
    const src = code('components/workout/done-screen.tsx')
    // Appending a word to the value would widen a fixed 2-column tile and break tabular-nums.
    expect(src).toMatch(/label: "Total time",\s*value: workoutDurationSec != null \? formatTime\(workoutDurationSec\) : "—"/)
  })

  it('the tile still measures wall clock from the warm-up, which is what makes it "total"', () => {
    // If this stops being whole-session, the label becomes a lie — the value is derived from
    // durationMinutes (workoutEndMs − workoutStartMs, stamped at the start of the warm-up).
    expect(code('components/workout/done-screen.tsx'))
      .toMatch(/durationMinutes != null\s*\?\s*durationMinutes \* 60/)
  })
})
