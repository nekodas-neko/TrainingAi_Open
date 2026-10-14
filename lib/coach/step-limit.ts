// #2792 — how many steps one Coach reply may take, and what the last one may do.
//
// A question that chains read tools used to spend all six steps reading and end with no answer at
// all (measured on pnpm dev, 2026-10-11: "Which of my sessions has the most volume?" ended on a read
// tool in 3 of 3 runs). The last step now answers: only the chart stays available — a chart is an
// answer, and the client's "shown" result brings the model back to write after it — and the system
// prompt is told to answer from what it has read. After: 8 of 8 runs ended in a chart or prose.

/** Steps one reply may take. The read-only tools chain; a widget ends the turn by suspending. */
export const COACH_MAX_STEPS = 6

/** Appended to the system prompt on the last step. Withholding every tool with `toolChoice: 'none'`
 *  was tried first and was not enough on its own: Gemini still emitted a call (usually a chart), which
 *  then failed as an unknown tool. */
export const FINAL_STEP_NOTE = 'You have used all your data lookups for this reply. Answer the user now from the tool results above: in prose, or with one renderChart if a chart answers it. Call no other tool.'

/** The `prepareStep` override for step `stepNumber` (0-based): none before the last step. */
export function coachStepOverride(stepNumber: number, system: string): { activeTools: ['renderChart']; system: string } | undefined {
  return stepNumber >= COACH_MAX_STEPS - 1
    ? { activeTools: ['renderChart'], system: `${system}\n\n${FINAL_STEP_NOTE}` }
    : undefined
}
