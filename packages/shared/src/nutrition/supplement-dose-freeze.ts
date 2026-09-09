/**
 * Which dose a supplement log freezes (BF-3, OR-104).
 *
 * `supplement_logs` stamps the dose at log time so that editing a definition cannot rewrite
 * history — for a drug whose clinical story is its escalation schedule, the escalation is exactly
 * what a retroactive rewrite destroys.
 *
 * The rule here is the half OR-104 added, and it lives in one place because there are TWO write
 * paths — the server (`lib/data/postgres/adapter.ts`) and the offline store
 * (`lib/local-store/sqlite-backend.ts`) — and a log written offline must not disagree with one
 * written online about what was taken.
 */

/**
 * The free text to freeze beside a resolved structured amount, or null.
 *
 * **A definition's free-text `dose` is frozen only when no structured amount was resolved.** They
 * are the same question asked twice: the edit sheet offers `amount`+`unit` AND the free-text `dose`
 * with nothing reconciling them, so the natural reading of a field labelled `Dose` — what is in the
 * vial — writes a number that contradicts the structured one. `Retatrutide` carried
 * `default_amount 0.5 · unit mg` beside `dose '10mg'`, 20× apart, and the 2026-09-07 log froze
 * both. It was invisible because `supplementSubtitle()` reaches for the free text last, so the
 * screen read "0.5 mg today" while the archive kept the wrong number for every later reader —
 * including the dose tracker OR-102a/b will build on it.
 *
 * A supplement carrying ONLY free text still freezes it. That is the case BF-3 exists for: every
 * supplement predating the structured columns has nothing else, and dropping it would make their
 * history unreconstructable.
 *
 * The test is the resolved amount, not where it came from. A caller passing an explicit amount
 * while the definition holds contradicting prose is the same hazard wearing a different hat, and
 * the freeze means whatever is written here is what history keeps.
 */
export function freezableDoseText(
  resolvedAmount: number | null | undefined,
  definitionDoseText: string | null | undefined,
): string | null {
  if (resolvedAmount != null) return null
  // Blank is absent. The two write paths already disagreed here before this function existed —
  // the local store used a truthy test (`def.dose ? … : null`) so `''` became null, while the
  // server used `?? null` and kept it. A cleared form field arrives as `''`, and an empty string
  // sitting where "no dose recorded" belongs reads differently downstream.
  const text = definitionDoseText?.trim()
  return text ? text : null
}
