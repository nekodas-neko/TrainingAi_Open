import { hrMaxFromAge } from '@trainingai/shared/health/hr-zones'
import type { FitnessSnapshot } from './types'

export interface BaselineResult {
  vo2max: number | null
  maxHr: number | null
  thresholdHr: number | null
  weeklyBaseMinutes: number | null
}

export interface FitnessSnapshotInputs {
  age: number | null
  restingHr: number | null
  /** From docs/.../2026-07-17-cardio-baseline-tests.md when available; null → age-based. */
  baseline: BaselineResult | null
}

const DEFAULT_RESTING_HR = 60
const BASE_MINUTES_FLOOR = 60

export function resolveFitnessSnapshot(i: FitnessSnapshotInputs): FitnessSnapshot {
  const restingHr = i.restingHr != null && i.restingHr > 0 ? i.restingHr : DEFAULT_RESTING_HR
  const b = i.baseline
  const hasBaseline = b != null && b.maxHr != null
  const maxHr = hasBaseline ? b!.maxHr! : hrMaxFromAge(i.age)
  return {
    maxHr,
    restingHr,
    vo2max: b?.vo2max ?? null,
    thresholdHr: b?.thresholdHr ?? null,
    weeklyBaseMinutes: b?.weeklyBaseMinutes ?? BASE_MINUTES_FLOOR,
    source: hasBaseline ? 'baseline' : 'age-estimate',
  }
}
