// Shared direction-arrow formatting for an HR change value (a beat-drop or recovery rate). Positive =
// HR FELL (recovering, good) → ↓cyan; negative = HR ROSE (still climbing) → ↑amber. Never prints a
// confusing double-minus ("−-21") for a negative input. Used by both the per-exercise Heart & Recovery
// card and the cross-activity HR Recovery Profile card — extracted here so the convention can't drift
// between the two (per the "extract before a third copy" UI rule).
export interface HrChangeDisplay {
  text: string
  color?: string
}

export function formatHrChange(n: number | null | undefined): HrChangeDisplay {
  if (n == null) return { text: '—' }
  if (n > 0) return { text: `↓${n}`, color: 'var(--accent-cyan)' }
  if (n < 0) return { text: `↑${-n}`, color: 'var(--accent-amber)' }
  return { text: '0' }
}
