import type { PaceBand } from '@trainingai/shared/walking/walk-pacer'

// The pacer's bands, constants and ladder live once in `packages/shared` so Preview's walk reads
// the same definition of "on pace" (#3525), including the speed rung's windowed speed and history
// targets (#3549). This module keeps what is specific to the web app's theme.
export * from '@trainingai/shared/walking/walk-pacer'

/** Theme token for a band. Paired with {@link PacerReading.mark} at every call site, never alone. */
export function bandColor(band: PaceBand): string {
  if (band === 'green') return 'var(--color-brand)'
  if (band === 'amber') return 'var(--accent-amber)'
  if (band === 'red') return 'var(--color-destructive)'
  return 'var(--color-muted-foreground)'
}
