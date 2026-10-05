import type { SleepScoreCoverage } from '@trainingai/shared/health/sleep-score'

const LABELS: Record<string, string> = {
  totalSleep: 'total sleep', restfulness: 'restfulness', efficiency: 'efficiency', rem: 'REM', deep: 'deep',
  latency: 'latency', timing: 'timing', schedule: 'schedule', hrv: 'HRV', hr: 'heart rate',
}

/**
 * OR-204. The line under the Sleep Score when the night's inputs were incomplete, or null when they
 * were not. Two strengths, no number: the owner asked for something that says "this score is less
 * complete", not a second metric to read.
 */
export function sleepCoverageNote(coverage: SleepScoreCoverage | null | undefined): { text: string; strong: boolean } | null {
  if (!coverage || coverage.level === 'full') return null
  if (coverage.level === 'partial') return { text: 'Partial data', strong: false }
  const names = coverage.missing.map(k => LABELS[k] ?? k)
  return { text: `Less complete: no ${names.join(', ')}`, strong: true }
}
