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

export function buildPrompt(section: string, dataLines: string[], absent: string[]): string {
  // Stated in the instruction as well as enforced by omission. The two guard different failures:
  // omission stops the model reading an absent metric as a value, and the instruction stops it
  // inferring one from silence — a section with no steps line can still be told the user did not
  // walk today unless it is told otherwise.
  const absentNote = absent.length > 0
    ? `\n\nNot measured today, because no reading exists — ${absent.join(', ')}. These are missing readings, NOT zeros and NOT observed behaviour. Do not describe them as low, absent, skipped, or as anything the user did or did not do. Mention one only to say it was not recorded, and never build the tip around one.`
    : ''
  return `You are a concise health coach. Write a single insight (2-3 sentences, no markdown) for the user's ${section} data. Be specific to the numbers you are given, and never infer a value that is not listed.${absentNote}

Data:
${dataLines.join('\n')}`
}
