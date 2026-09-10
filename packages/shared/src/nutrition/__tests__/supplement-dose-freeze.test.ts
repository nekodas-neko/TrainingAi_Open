// OR-104 — one rule, two write paths. The server and the offline store both freeze a dose onto the
// log, and a log written offline must not disagree with one written online about what was taken.
//
// This is the only place the rule is executed in a test: the local store's own suite asserts
// against its SOURCE TEXT (it greps `sqlite-backend.ts` rather than running it, because native
// SQLite does not run in this sandbox), so a behavioural change there passes those tests untouched.
// Putting the decision in a shared function is what makes both paths genuinely covered.
import { describe, it, expect } from 'vitest'
import { freezableDoseText, resolveLoggedDose } from '../supplement-dose-freeze'

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

describe('resolveLoggedDose (LA-90)', () => {
  const def = { defaultAmount: 5, unit: 'mg', dose: '5mg once daily' }

  it('resolves entirely from the definition when the caller supplies nothing', () => {
    expect(resolveLoggedDose(undefined, def)).toEqual({ amount: 5, unit: 'mg', doseText: null })
  })

  it('fills a MISSING field from the definition rather than dropping it — the divergence LA-90 names', () => {
    // The server did this; the local store took the caller's triple as given and left `unit` null.
    // Same tick, same supplement, two different rows depending on connectivity — and the offline
    // one wins, because a pushed mutation carries what the device recorded.
    expect(resolveLoggedDose({ amount: 7.5 }, def)).toEqual({ amount: 7.5, unit: 'mg', doseText: null })
    expect(resolveLoggedDose({ unit: 'mcg' }, def)).toEqual({ amount: 5, unit: 'mcg', doseText: null })
  })

  it("keeps the caller's complete triple untouched — a replayed log at the dose it was taken at", () => {
    expect(resolveLoggedDose({ amount: 2, unit: 'ml', doseText: 'half a vial' }, def))
      .toEqual({ amount: 2, unit: 'ml', doseText: 'half a vial' })
  })

  it('freezes the free text against the RESOLVED amount, not the caller-supplied one', () => {
    // The amount came from the definition here, and it still suppresses the prose — otherwise a
    // log would carry both `5 mg` and contradicting free text, which is the OR-104 hazard.
    expect(resolveLoggedDose({ unit: 'mg' }, def).doseText).toBeNull()
    // With no structured amount anywhere, the prose is the only record and is kept (BF-3).
    expect(resolveLoggedDose({ unit: 'mg' }, { defaultAmount: null, unit: null, dose: '10mg' }).doseText).toBe('10mg')
  })

  it('survives a missing definition without inventing anything', () => {
    expect(resolveLoggedDose({ amount: 3 }, null)).toEqual({ amount: 3, unit: null, doseText: null })
    expect(resolveLoggedDose(null, null)).toEqual({ amount: null, unit: null, doseText: null })
  })
})
