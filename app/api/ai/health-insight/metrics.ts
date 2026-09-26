// Assembling a section's metric lines, and keeping an absent reading distinguishable from a zero.
//
// Named prompt.ts until RV-201, when the model call went and `buildPrompt` with it. What survives
// is the part that was never about the model: a metric with no reading must not reach the reader
// as a value. `splitMeasured` is what enforces that, by routing an absent label away from the
// lines entirely — see `insight-text.ts` for the one sentence absent labels are allowed to appear in.

/**
 * Q-353. A metric that has no reading is **omitted**, and its name is collected instead.
 *
 * The prompt used to substitute the literal string `"no data"` for an absent field at ten sites, and
 * the model does not read that as absence — it asserts **zero** and editorialises. A day-one account
 * handed `Steps: no data` was told *"your activity tracker currently shows zero movement… this
 * inactivity creates a significant gap"*. Q-452 gated the card on a section having *some* data,
 * which closes only the fully-empty case; a user with a readiness score but no ring temperature
 * passes that gate and still gets the sentence.
 *
 * Omitting is the half that does the work — a line that is not there cannot be misread as a
 * measurement. Naming the absent metrics separately is what lets the model say "no temperature
 * reading today" instead of quietly implying the value was fine.
 */
export function metric(label: string, value: string | null | undefined): MetricLine {
  return { label, line: value == null ? null : `${label}: ${value}` }
}
export interface MetricLine { label: string; line: string | null }

export function splitMeasured(entries: (MetricLine | string)[]): { lines: string[]; absent: string[] } {
  const lines: string[] = []
  const absent: string[] = []
  for (const e of entries) {
    if (typeof e === 'string') { lines.push(e); continue }
    if (e.line != null) lines.push(e.line)
    else absent.push(e.label)
  }
  return { lines, absent }
}
