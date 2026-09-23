// Canonical 0-100 score → band. Single source of truth for the label and color
// that were previously copy-pasted ~15× with a 45-vs-50 threshold drift.
//
// **The colours are theme tokens, not hex (RV-99).** The same good/warning/bad triad existed twice
// — this file returned raw `#22c55e`/`#f59e0b`/`#ef4444`, while `recovery-band.ts` and
// `body-battery-band.ts` returned these tokens for the identical concept. Resolved in dark they are
// different colours rather than shades: the green was `rgb(34,197,94)` against the token's
// `rgb(86,238,102)`, and the reds differ in contrast by about 1.6:1. Only the token half can follow
// the theme, so the tokens win and this file moved.
//
// **A `var()` cannot be handed to a canvas.** Chart.js paints onto a canvas, which resolves no CSS,
// and silently fills black — any Chart.js caller must pass these through `resolveColor()`
// (`packages/shared/src/chart-colors.ts`). DOM and SVG consumers need nothing. Checked at the time
// of the move: every current consumer is DOM or SVG.
export interface ScoreBand { label: 'High' | 'Moderate' | 'Low'; color: string }

export const SCORE_BAND_COLOR = {
  High: 'var(--accent-green)',
  Moderate: 'var(--accent-amber)',
  Low: 'var(--destructive)',
} as const

export function scoreBand(score: number): ScoreBand {
  if (score >= 70) return { label: 'High', color: SCORE_BAND_COLOR.High }
  if (score >= 50) return { label: 'Moderate', color: SCORE_BAND_COLOR.Moderate }
  return { label: 'Low', color: SCORE_BAND_COLOR.Low }
}

// For callers that already hold the band LABEL (a server-computed `label` field, a legend key)
// and would otherwise re-hardcode the three hexes to colour it. A legend in particular assigns
// the colours their meaning, so a drifting copy there makes the legend lie about the chart.
export function scoreBandByLabel(label: ScoreBand['label']): string {
  return SCORE_BAND_COLOR[label]
}
