import { TREND_EMPTY as SHARED_TREND_EMPTY } from '@trainingai/shared/health/trend-empty-copy'
import type { TrendField } from './trend-sparkline-equal'

// The wording moved to packages/shared so the native app reads the same sentences.
export * from '@trainingai/shared/health/trend-empty-copy'

// Keys stay checked against the web's trend fields.
export const TREND_EMPTY = SHARED_TREND_EMPTY satisfies Partial<Record<TrendField, string>>
