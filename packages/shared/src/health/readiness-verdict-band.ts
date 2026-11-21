// The one rule for "is this readiness score outside the usual band" (#2105). A leaf module with no
// imports so Preview can use it without pulling the verdict's baseline code into the app bundle.
// The server's frozen verdict (`readinessVerdictForDay`) and Preview's Home line (#3659) both call it.

export type ReadinessBandVerdict = 'normal' | 'poor' | 'good'

/** Strictly under the band is poor, strictly over is good, the edges are usual. */
export function readinessVerdictOfScore(
  score: number,
  band: { low: number; high: number },
): ReadinessBandVerdict {
  return score < band.low ? 'poor' : score > band.high ? 'good' : 'normal'
}
