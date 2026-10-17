import type { HeartHealthDayOutcome } from '@trainingai/shared/running/heart-health-copy'

// The wording moved to packages/shared so the native app reads the same sentences.
export * from '@trainingai/shared/running/heart-health-copy'

// Web-only: CSS variables, so it stays out of packages/shared.
export const OUTCOME_COLOR: Partial<Record<HeartHealthDayOutcome, string>> = {
  counted: 'var(--accent-green)',
  'not-counted': 'var(--accent-amber)',
}
