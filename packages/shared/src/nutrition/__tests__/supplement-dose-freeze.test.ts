// OR-104 — one rule, two write paths. The server and the offline store both freeze a dose onto the
// log, and a log written offline must not disagree with one written online about what was taken.
//
// This is the only place the rule is executed in a test: the local store's own suite asserts
// against its SOURCE TEXT (it greps `sqlite-backend.ts` rather than running it, because native
// SQLite does not run in this sandbox), so a behavioural change there passes those tests untouched.
// Putting the decision in a shared function is what makes both paths genuinely covered.
import { describe, it, expect } from 'vitest'
import { freezableDoseText } from '../supplement-dose-freeze'

describe('freezableDoseText', () => {
  it('drops a free text that would contradict the structured amount', () => {
    // The production shape: 0.5 mg structured, '10mg' free text — the vial strength, typed into a
    // field labelled `Dose`. 20× apart, and frozen into the archive by every log.
    expect(freezableDoseText(0.5, '10mg')).toBeNull()
  })

  it('drops it even when the two AGREE, because agreement is not the test', () => {
    // Deliberate. Keeping the prose whenever it happens to match would leave the rule depending on
    // parsing free text to decide — which is the thing being removed, and would put the defect back
    // the moment a titration changed one and not the other.
    expect(freezableDoseText(2, '2 mg')).toBeNull()
  })

  it('freezes free text for a supplement that has only that', () => {
    // The BF-3 case, and the reason this is not simply "never stamp the text": every supplement
    // predating the structured columns carries nothing else, so dropping it would make their
    // history unreconstructable.
    expect(freezableDoseText(null, '1 scoop')).toBe('1 scoop')
    expect(freezableDoseText(undefined, '1 scoop')).toBe('1 scoop')
  })

  it('freezes nothing when there is nothing to freeze', () => {
    expect(freezableDoseText(null, null)).toBeNull()
    expect(freezableDoseText(null, undefined)).toBeNull()
  })

  it('treats a resolved ZERO as a real amount, not as absent', () => {
    // `!= null`, not falsy: a 0 amount is a value someone recorded, and a truthiness test would
    // silently fall through to the prose for it.
    expect(freezableDoseText(0, '10mg')).toBeNull()
  })

  it('keeps a blank free text out of the log, whitespace included', () => {
    // A cleared field arrives as '' from a form, not as null. Freezing '' would put an empty string
    // where "no dose recorded" belongs, and the two read differently downstream.
    expect(freezableDoseText(null, '')).toBeNull()
    // The whitespace case is what separates trimming from a bare falsy check — '   ' is truthy, so
    // a mutant dropping the trim survived on '' alone. A field cleared by selecting and deleting
    // can easily leave a space behind.
    expect(freezableDoseText(null, '   ')).toBeNull()
  })

  it('trims what it does freeze', () => {
    expect(freezableDoseText(null, '  1 scoop  ')).toBe('1 scoop')
  })
})
