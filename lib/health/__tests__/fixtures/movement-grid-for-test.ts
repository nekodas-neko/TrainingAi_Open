// Issue 3597 — the one place the no-score-change snapshot builds a per-minute movement grid from
// Oura-shaped activity rows, so the snapshot test reads the same before and after the refactor.
import { ouraCloudMetGrid, type OuraActivitySeriesDay } from '@trainingai/shared/health/oura-cloud-met'

export function movementGridForTest(days: readonly OuraActivitySeriesDay[], fromMs: number, toMs: number) {
  return ouraCloudMetGrid(days, fromMs, toMs)
}
