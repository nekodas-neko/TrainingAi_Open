// Issue 3597 — the one place the no-score-change snapshot builds a per-minute movement grid from
// Oura-shaped activity rows, so the snapshot test reads the same before and after the refactor.
import { perMinuteMovementGrid } from '@trainingai/shared/health/per-minute-movement'
import { ouraActivityMovementSeries, type OuraActivitySeriesDay } from '@/lib/oura/cloud/activity-movement'

export function movementGridForTest(days: readonly OuraActivitySeriesDay[], fromMs: number, toMs: number) {
  return perMinuteMovementGrid(ouraActivityMovementSeries(days), fromMs, toMs)
}
