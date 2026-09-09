/**
 * What a supplement's DEFINITION says the dose is (OR-104's surface half).
 *
 * **Not a duplicate of `supplementSubtitle`, which answers a different question.** That one is "what
 * did today record", so it leads with `loggedAmount`. This one is for the manage sheet, where you are
 * editing the definition and today's log is not the subject — leading with a logged amount there
 * would show a number the form in front of you cannot change.
 *
 * **The contradiction this exists to surface.** BF-112 added structured `amount`/`unit` beside the
 * free-text `dose` that had always been there, with nothing reconciling the two, and a field labelled
 * `Dose` naturally reads as *what is in the vial*. In production `Retatrutide` carries
 * `default_amount 0.5 · unit mg` **and** `dose '10mg'` — the vial strength — and the two disagree by
 * 20×. The list rendered the free text under the name, so the structured dose the app actually uses
 * was the one you could not see.
 */

export interface DefinitionDose {
  dose: string | null
  defaultAmount?: number | null
  unit?: string | null
}

/** The dose the app will actually use, preferring the number it can do arithmetic on. */
export function definitionDose(s: DefinitionDose): string | null {
  if (s.defaultAmount != null) return `${s.defaultAmount}${s.unit ? ` ${s.unit}` : ''}`
  return s.dose?.trim() || null
}

/**
 * True when the definition carries a structured amount AND free text, which is the state that can
 * hold two different answers to one question.
 *
 * Deliberately NOT an attempt to parse the free text and compare quantities: `10mg` against
 * `0.5 mg` is a contradiction, `with food` is not, and a parser that guesses would either miss the
 * real case or cry wolf on a note. Saying "this is a note, not the dose" is true either way.
 */
export function hasFreeTextBesideAmount(s: DefinitionDose): boolean {
  return s.defaultAmount != null && (s.dose?.trim() ?? '') !== ''
}
