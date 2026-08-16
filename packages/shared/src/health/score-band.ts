// Canonical 0-100 score → band. Single source of truth for the label and color
// that were previously copy-pasted ~15× with a 45-vs-50 threshold drift.
export interface ScoreBand { label: 'High' | 'Moderate' | 'Low'; color: string }

export function scoreBand(score: number): ScoreBand {
  if (score >= 70) return { label: 'High', color: '#22c55e' }
  if (score >= 50) return { label: 'Moderate', color: '#f59e0b' }
  return { label: 'Low', color: '#ef4444' }
}

// For callers that already hold the band LABEL (a server-computed `label` field, a legend key)
// and would otherwise re-hardcode the three hexes to colour it. A legend in particular assigns
// the colours their meaning, so a drifting copy there makes the legend lie about the chart.
export function scoreBandByLabel(label: ScoreBand['label']): string {
  if (label === 'High') return '#22c55e'
  if (label === 'Moderate') return '#f59e0b'
  return '#ef4444'
}
