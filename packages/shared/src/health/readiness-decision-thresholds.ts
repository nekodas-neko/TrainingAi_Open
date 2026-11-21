// #3778 — every fixed cut an ACTION reads off our readiness score, in one place, on the scale whose
// baseline sits at 75 (`READINESS_BASELINE_CENTRE` in `readiness-composite.ts`).
//
// Import-free on purpose: client components read these (`deload-constants.ts` re-exports two of
// them), and anything that pulls `ai-dynamic` drags the ONNX runtime into the browser bundle (Q-221).
//
// **Why each one moved, and by how much.** Moving the centre lifts an ordinary day by several
// points and a day whose resting HR, HRV and sleep are far from normal by almost nothing. A cut that
// stayed where it was would therefore stop firing on days it fires on today: "rest under 60" would
// quietly tell fewer people to rest. The rule written in `rest-day-guidance.ts` when the Sleep Score
// was rescaled holds here too: re-anchor every threshold in the same change, preserving the days it
// fires on.
//
// The shift is not one number (it depends on how far each of the three centred inputs is from its
// normal), so no single new cut can keep the exact same days. Each `after` is the value that keeps
// the firing rate and flips the fewest days, measured by `scripts/tuning/readiness-centre-replay.cjs`
// over its synthetic fixture under three different assumed populations; all three agreed within one
// point, and 1–5% of days flip at each cut. The production check is the SQL in
// `scripts/tuning/readiness-centre-75.sql`, which reports each cut's firing count before and
// after and the rate-preserving value on the owner's stored days.
//
// **The band labels are deliberately NOT here.** High 70+ / Moderate 50+ / Low under 50
// (`score-band.ts`) describe the number, and letting an ordinary day read Moderate-to-High instead of
// the bottom of Moderate is the point of #3778. Anything that acts — tells someone to rest, deload,
// soften a run, or weights the session pick — is here and moved.

export type ReadinessDecisionSide = 'below' | 'atLeast'

export interface ReadinessDecisionThreshold {
  name: string
  /** Where it is read. */
  where: string
  side: ReadinessDecisionSide
  /** The cut on the 50-centred scale (model v17 and before). */
  before: number
  /** The cut on the 75-centred scale (v18, #3778). */
  after: number
}

/** Rest-day card: "Recovered" at or above this with no soreness. */
export const REST_DAY_RECOVERED_MIN = 80
/** Rest-day card: "Rest fully" below this. */
export const REST_DAY_REST_BELOW = 67
/** Session pick: below this, recovery weighs 0.55 instead of 0.40 (`ai-dynamic.ts`). */
export const SESSION_LOW_READINESS_BELOW = 67
/** Deload owed to 3+ training days stays a soft nudge at or above this (`ai-dynamic.ts`). */
export const DELOAD_READINESS_SOFT_MIN = 76
/** …is "recommended" at or above this, "strong" below it. */
export const DELOAD_READINESS_RECOMMENDED_MIN = 56
/** Home early-deload card: readiness under this with ACWR over its bound (`readiness-payload.ts`). */
export const EARLY_DELOAD_READINESS_BELOW = 51
/** Running recovery gate: rest below this. */
export const RUNNING_REST_READINESS_BELOW = 57
/** Running recovery gate: soften a hard run below this. */
export const RUNNING_SOFTEN_READINESS_BELOW = 72
/** Training-stress (OTS) model: below this the "high stress" bar drops 10%. */
export const OTS_LOW_READINESS_BELOW = 67

/** "Readiness is low" push (`health-alerts.ts`): readiness under this. **An owner decision (#3824).**
 *  The push used to follow the Low band label (< 50). The labels stay at 70/50 while the score rose,
 *  so following the label would reach the owner on 10 fewer of 118 stored days. 57 keeps the old rate
 *  (production count, 15 Nov: Low < 50 fired on 35 days, < 57 on the projected scores fires on 35).
 *  The alternative, the label (50), is one constant away. */
export const LOW_READINESS_ALERT_BELOW = 57

/** Every cut by name, so a comparison can ask for the one that matches the score's own scale. */
export const READINESS_CUTS = {
  restDayRecovered: { name: 'rest-day: recovered', where: 'packages/shared/src/health/rest-day-guidance.ts', side: 'atLeast', before: 75, after: REST_DAY_RECOVERED_MIN },
  restDayRest: { name: 'rest-day: rest fully', where: 'packages/shared/src/health/rest-day-guidance.ts', side: 'below', before: 60, after: REST_DAY_REST_BELOW },
  sessionLowReadiness: { name: 'session pick: low readiness', where: 'packages/shared/src/ai-periodization/ai-dynamic.ts', side: 'below', before: 60, after: SESSION_LOW_READINESS_BELOW },
  deloadSoft: { name: 'deload grade: soft', where: 'packages/shared/src/ai-periodization/ai-dynamic.ts', side: 'atLeast', before: 70, after: DELOAD_READINESS_SOFT_MIN },
  deloadRecommended: { name: 'deload grade: recommended', where: 'packages/shared/src/ai-periodization/ai-dynamic.ts', side: 'atLeast', before: 50, after: DELOAD_READINESS_RECOMMENDED_MIN },
  earlyDeload: { name: 'early-deload card', where: 'lib/health/readiness-payload.ts', side: 'below', before: 45, after: EARLY_DELOAD_READINESS_BELOW },
  runningRest: { name: 'running gate: rest', where: 'packages/shared/src/running/recovery-gate.ts', side: 'below', before: 50, after: RUNNING_REST_READINESS_BELOW },
  runningSoften: { name: 'running gate: soften', where: 'packages/shared/src/running/recovery-gate.ts', side: 'below', before: 65, after: RUNNING_SOFTEN_READINESS_BELOW },
  otsLowReadiness: { name: 'training stress: low readiness', where: 'lib/oura-models/inference/ots.ts', side: 'below', before: 60, after: OTS_LOW_READINESS_BELOW },
  lowReadinessAlert: { name: 'low-readiness push', where: 'packages/shared/src/health/health-alerts.ts', side: 'below', before: 50, after: LOW_READINESS_ALERT_BELOW },
} as const satisfies Record<string, ReadinessDecisionThreshold>

export type ReadinessCutKey = keyof typeof READINESS_CUTS

export const READINESS_DECISION_THRESHOLDS: readonly ReadinessDecisionThreshold[] = Object.values(READINESS_CUTS)

/** Readiness model v18 moved the centre from 50 to 75 (#3778). */
export const CENTRE_75_FROM_MODEL = 18

export type ReadinessScale = 'centre-50' | 'centre-75'

/** `model_versions.readiness` out of the row's JSONB, or null when the row carries no stamp. */
export function readinessModelVersionOf(modelVersions: unknown): string | null {
  if (modelVersions == null || typeof modelVersions !== 'object' || Array.isArray(modelVersions)) return null
  const v = (modelVersions as { readiness?: unknown }).readiness
  return typeof v === 'string' && v.length > 0 ? v : null
}

/**
 * Which scale a stored score is on, from the row's own `model_versions.readiness` stamp. Unstamped
 * rows predate the stamp (Q-273), so they are on the old scale. **Stored rows are never rewritten**,
 * so every past day — and today's row on release day, until it is next recomputed — keeps the scale it
 * was written on, and anything that compares it with a cut or with another day must ask this first.
 */
export function readinessScaleOf(modelVersion: string | null | undefined): ReadinessScale {
  const n = modelVersion == null ? NaN : Number(/^v(\d+):/.exec(modelVersion)?.[1])
  return Number.isFinite(n) && n >= CENTRE_75_FROM_MODEL ? 'centre-75' : 'centre-50'
}

/**
 * The cut to compare a readiness score with, chosen by the model version that produced THAT score:
 * the old cut for a score on the 50-centred scale, the moved one for a v18 score. Every comparison of
 * a readiness score with a fixed cut goes through here, so a stored pre-release score is judged by
 * the rule it was written for (a stored 62 is not "low" under v17's < 60, though it would be under 67).
 *
 * `modelVersion` is the row's stamp. A score computed in this request passes `READINESS_MODEL_VERSION`.
 */
export function cutFor(key: ReadinessCutKey, modelVersion: string | null | undefined): number {
  const cut = READINESS_CUTS[key]
  return readinessScaleOf(modelVersion) === 'centre-75' ? cut.after : cut.before
}

/** Whether the named rule fires for this score, on the cut that matches the score's scale. */
export function readinessCutFires(key: ReadinessCutKey, score: number, modelVersion: string | null | undefined): boolean {
  const cut = READINESS_CUTS[key]
  const t = cutFor(key, modelVersion)
  return cut.side === 'below' ? score < t : score >= t
}
