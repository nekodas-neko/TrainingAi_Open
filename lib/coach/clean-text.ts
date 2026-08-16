/**
 * Strip Gemini's function-call citation bracket out of an assistant reply.
 *
 * Gemini appends a citation-like bracket naming the functions it called —
 * `[default_api:getPlateauReport, default_api:getWorkoutsByExercise]` — to the end of an answer.
 * Observed on-device 2026-08-09 at the end of an otherwise good progression summary.
 *
 * The system prompt now forbids it, and that is not enough on its own: "instruct the model not to"
 * already failed once in this feature, for invented ids in Phase 1. This runs on render so a
 * relapse is invisible rather than shipped.
 *
 * Deliberately narrow — it matches only the `default_api:` form, so a bracket the user's own text
 * or a legitimate markdown link happens to contain is left alone.
 */
const TOOL_CITATION = /\s*\[\s*(?:default_api:[\w.]+\s*,?\s*)+\]\s*\.?/g

export function stripToolCitations(text: string): string {
  return text.replace(TOOL_CITATION, '').trimEnd()
}
