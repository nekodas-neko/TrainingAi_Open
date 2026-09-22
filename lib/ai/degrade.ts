/**
 * RV-69 — when the model fails, answer with the facts the route already assembled.
 *
 * Four prose routes used to throw away a complete fact block on the catch path and return an error:
 * `daily-digest` has built its lines before it ever calls the model, `weekly-digest` has
 * `buildWeeklyDigestContext`, `health-insight` has run `splitMeasured`, and the workout recap has
 * run `buildRecapFacts` (duration, volume, PR count, RPE drift, rest adherence). All of that is
 * deterministic, already computed, and was being discarded because the sentence *about* it could
 * not be written.
 *
 * `app/api/running-plan/explain/route.ts` is the reference: it answers 200 with the deterministic
 * rationale it was handed and `degraded: true`. `ai/health-insight` is the second precedent, and
 * the more exact one — it already returns a hand-written deterministic sentence when nothing was
 * measured, rather than paying for a model call whose only honest output is that.
 *
 * **Why a sentence and not the raw block.** The entry proposed returning the assembled lines. Two
 * of the three cards render the string into a plain `<p>` with no `whitespace-pre-line`, so
 * newlines collapse and a multi-line block arrives as a run-on. Joining explicitly is what makes
 * the degraded answer read as one deliberate readout on every surface, including the one card that
 * renders markdown.
 */

/**
 * Turn a route's own `Label: value` fact block into one honest sentence.
 *
 * Returns `null` when there are no facts — a lead with nothing after it is worse than the error
 * state it would replace, so the caller keeps its existing failure response in that case.
 *
 * @param clause how the route names what follows, as a full clause — `here is the day as recorded`,
 *               `here are the readings as recorded`. A bare noun was tried first and produced "here
 *               is the readings" on the one section whose subject is plural; the verb has to travel
 *               with the noun, and running the route locally is what showed it.
 * @param facts  newline-separated fact lines, exactly as they were handed to the model.
 */
export function degradedFromFacts(clause: string, facts: string): string | null {
  const lines = facts.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length === 0) return null
  return `A written summary could not be generated just now, so ${clause}: ${lines.join(' · ')}`
}
