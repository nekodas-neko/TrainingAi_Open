import type { GoalKind } from './types'

// Cardio-goal registry — the user picks a goal; each goal maps to a training
// framework (the deterministic plan template) and declares which progress markers
// matter for it. Grounded in the 2026-07-20 training-science brief (polarized 80/20
// Seiler; ACSM/WHO 150-min guideline; Daniels VDOT; Norwegian 4×4; HRR autonomic marker).
//
// goal_kind / framework_key are free-text DB columns, so adding a goal is additive —
// no migration. Legacy plans persisted 'cardio_health'/'distance_event' + their stored
// framework_key, so they keep prescribing from whatever framework they were created with.

export type ProgressMarker =
  | 'resting_hr'
  | 'hrr1'
  | 'vo2max'
  | 'time_trial'      // 5K/3K TT → VDOT
  | 'efficiency'      // pace @ fixed HR / aerobic decoupling
  | 'zone_distribution'

export interface CardioGoalMeta {
  key: GoalKind
  label: string
  /** One-line, user-facing description of the training focus. */
  blurb: string
  /** The framework (plan template) this goal defaults to. */
  defaultFrameworkKey: string
  /** Does the goal need a target race distance (5K/3K/10K…) to prescribe paces? */
  needsTargetDistance: boolean
  /** Markers this goal is judged by, most-important first (drives the baselines view). */
  markers: ProgressMarker[]
  /** Whether this goal is offered in the picker (legacy aliases are hidden). */
  selectable: boolean
}

export const CARDIO_GOALS: Record<GoalKind, CardioGoalMeta> = {
  speed: {
    key: 'speed',
    label: 'Get faster',
    blurb: 'Improve your 5K / 3K time — VO₂max intervals, threshold work and strides, with paces set from a recent time.',
    defaultFrameworkKey: 'speed-vo2max',
    needsTargetDistance: true,
    markers: ['time_trial', 'vo2max', 'efficiency', 'zone_distribution'],
    selectable: true,
  },
  endurance: {
    key: 'endurance',
    label: 'Go further',
    blurb: 'Build distance — an easy-run base (~80%) with a progressive weekly long run, capped at ~10%/week.',
    defaultFrameworkKey: 'polarized-80-20',
    needsTargetDistance: true,
    markers: ['efficiency', 'vo2max', 'resting_hr', 'zone_distribution'],
    selectable: true,
  },
  heart_health: {
    key: 'heart_health',
    label: 'Heart health',
    blurb: 'General cardiovascular fitness — mostly Zone 2 aerobic work, hitting the 150 min/week moderate-activity guideline.',
    defaultFrameworkKey: 'zone2-base',
    needsTargetDistance: false,
    markers: ['resting_hr', 'vo2max', 'zone_distribution'],
    selectable: true,
  },
  recovery: {
    key: 'recovery',
    label: 'Recovery & resilience',
    blurb: 'Raise vagal tone to lower resting HR and speed heart-rate recovery — high easy aerobic volume, no grey-zone grind.',
    defaultFrameworkKey: 'aerobic-recovery',
    needsTargetDistance: false,
    markers: ['hrr1', 'resting_hr', 'zone_distribution'],
    selectable: true,
  },
  intervals: {
    key: 'intervals',
    label: 'Intervals (Norwegian 4×4)',
    blurb: 'A proven, time-efficient VO₂max protocol — 4×4-minute high-intensity intervals with active recovery, twice a week, easy running filling the rest.',
    defaultFrameworkKey: 'norwegian-4x4',
    needsTargetDistance: false,
    markers: ['vo2max', 'hrr1', 'efficiency', 'zone_distribution'],
    selectable: true,
  },
  // ── Legacy aliases (pre-Phase-2 plans) — hidden from the picker, kept so a stored
  //    plan still resolves a framework/markers. ────────────────────────────────────
  cardio_health: {
    key: 'cardio_health',
    label: 'Cardio health',
    blurb: 'General cardiovascular fitness.',
    defaultFrameworkKey: 'zone2-base',
    needsTargetDistance: false,
    markers: ['resting_hr', 'vo2max', 'zone_distribution'],
    selectable: false,
  },
  distance_event: {
    key: 'distance_event',
    label: 'Distance event',
    blurb: 'Train for a distance event.',
    defaultFrameworkKey: 'polarized-80-20',
    needsTargetDistance: true,
    markers: ['efficiency', 'vo2max', 'zone_distribution'],
    selectable: false,
  },
}

export const SELECTABLE_CARDIO_GOALS: CardioGoalMeta[] = Object.values(CARDIO_GOALS).filter((g) => g.selectable)

/** The framework a goal defaults to (used when a plan is created without an explicit
 *  framework override). Falls back to the polarized base for an unknown goal. */
export function defaultFrameworkForGoal(kind: GoalKind): string {
  return CARDIO_GOALS[kind]?.defaultFrameworkKey ?? 'polarized-80-20'
}
