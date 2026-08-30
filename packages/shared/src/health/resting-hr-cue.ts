import { scoreBand } from './score-band'

/**
 * How a resting-HR reading reads against the user's own baseline (TN-13).
 *
 * **A delta, not a tier word, and that is the finding.** Measured against `perceived_recovery`,
 * expressing either HR candidate as a deviation from the owner's own baseline roughly **doubles** its
 * correlation with felt state:
 *
 * | | r | n |
 * |---|---|---|
 * | waking-rest HR, raw bpm | +0.176 | 51 |
 * | nightly resting HR, raw bpm | +0.129 | 46 |
 * | waking-rest HR, Δ vs its own 7-day baseline | **+0.291** | 51 |
 * | nightly resting HR, Δ vs its own 7-day baseline | **+0.278** | 43 |
 *
 * Which metric you pick moves the number far less (+0.291 vs +0.278) than raw-versus-relative does.
 * **So the defect was showing an absolute bpm at all** — 69 means nothing without knowing the usual
 * is 63.
 *
 * NOT a 0–100 score, so the colour comes from a band rather than from a fabricated percentage. The
 * text carries the sign and the number, so this is never colour-only state.
 *
 * Here rather than in the component because it is domain math over `scoreBand` — and because a
 * component file cannot be imported by a test in this repo's node-only vitest projects.
 */
export function restingHrCue(
  bpm: number | null,
  baseline: number | null,
): { color: string; word: string } | null {
  if (bpm == null) return null
  // No baseline yet: say what the number IS rather than inventing a comparison for it.
  if (baseline == null) return { color: 'hsl(var(--muted-foreground))', word: 'Resting' }
  const delta = Math.round(bpm) - Math.round(baseline)
  const word = delta === 0 ? 'same as usual' : `${delta > 0 ? '+' : '−'}${Math.abs(delta)} vs usual`
  // The thresholds are unchanged from the tier version they replace — only what is SHOWN changed.
  if (delta <= -2) return { color: scoreBand(85).color, word }
  if (delta <= 2) return { color: scoreBand(75).color, word }
  if (delta <= 5) return { color: scoreBand(60).color, word }
  return { color: scoreBand(40).color, word }
}
