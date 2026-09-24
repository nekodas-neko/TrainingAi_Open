// `body_battery_daily.model_version` is written as `v6:rest0.05:chg0.12:…` — a generation prefix
// followed by the constants that generation ran with. The column exists so tuning analysis never
// mixes data from different constant sets, and until LA-135 **nothing in the codebase read it**.
//
// It is not decoration. Measured in production 2026-09-24 the table held four generations, and the
// v4 → v5 boundary moves the mean end-of-day value from 62.9 to 15.2. A correlation computed across
// that boundary is a correlation with a code change, which CLAUDE.md names as not evidence.

/**
 * The generation prefix of a stored model version — the part before the first `:`.
 *
 * Only the prefix is compared, deliberately. The interpolated constants change whenever a rate is
 * tuned, so comparing whole strings would split one generation into a new bucket per tuning pass
 * and report a "model change" where the model's shape never moved.
 */
export function modelGeneration(version: string | null | undefined): string {
  if (!version) return 'unknown'
  const head = version.split(':')[0]?.trim()
  return head ? head : 'unknown'
}

export interface GenerationCount {
  generation: string
  days: number
}

/**
 * How many days each generation contributed, most days first.
 *
 * The caller reports this alongside any number computed over the window, so a figure spanning a
 * boundary is visibly spanning one. Returning counts rather than silently narrowing the window is
 * the point: a filter that quietly drops days answers a question nobody asked, and does it without
 * saying so.
 */
export function generationCensus(versions: Iterable<string | null | undefined>): GenerationCount[] {
  const counts = new Map<string, number>()
  for (const v of versions) {
    const g = modelGeneration(v)
    counts.set(g, (counts.get(g) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([generation, days]) => ({ generation, days }))
    .sort((a, b) => b.days - a.days || a.generation.localeCompare(b.generation))
}
