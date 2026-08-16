/** Muscle-recovery band — thresholds + colors defined once (used by the home
 *  muscle-status widget and any Health surface showing recovery %). */
export function recoveryBand(pct: number): { key: 'recovered' | 'partial' | 'fatigued'; color: string } {
  if (pct >= 80) return { key: 'recovered', color: 'var(--accent-green)' }
  if (pct >= 50) return { key: 'partial',   color: 'var(--accent-amber)' }
  return { key: 'fatigued', color: 'var(--destructive)' }
}
