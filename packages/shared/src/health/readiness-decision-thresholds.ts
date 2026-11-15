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
// `docs/reviews/2026-11-15-readiness-centre-75.md`, which reports each cut's firing count before and
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
export const DELOAD_READINESS_RECOMMENDED_MIN = 57
/** The AI prescription prompt's rest-day rule: readiness under this. */
export const PROMPT_REST_DAY_READINESS_BELOW = 45
/** Home early-deload card: readiness under this with ACWR over its bound (`readiness-payload.ts`). */
export const EARLY_DELOAD_READINESS_BELOW = 51
/** Running recovery gate: rest below this. */
export const RUNNING_REST_READINESS_BELOW = 57
/** Running recovery gate: soften a hard run below this. */
export const RUNNING_SOFTEN_READINESS_BELOW = 72
/** Training-stress (OTS) model: below this the "high stress" bar drops 10%. */
export const OTS_LOW_READINESS_BELOW = 67

export const READINESS_DECISION_THRESHOLDS: readonly ReadinessDecisionThreshold[] = [
  { name: 'rest-day: recovered', where: 'packages/shared/src/health/rest-day-guidance.ts', side: 'atLeast', before: 75, after: REST_DAY_RECOVERED_MIN },
  { name: 'rest-day: rest fully', where: 'packages/shared/src/health/rest-day-guidance.ts', side: 'below', before: 60, after: REST_DAY_REST_BELOW },
  { name: 'session pick: low readiness', where: 'packages/shared/src/ai-periodization/ai-dynamic.ts', side: 'below', before: 60, after: SESSION_LOW_READINESS_BELOW },
  { name: 'deload grade: soft', where: 'packages/shared/src/ai-periodization/ai-dynamic.ts', side: 'atLeast', before: 70, after: DELOAD_READINESS_SOFT_MIN },
  { name: 'deload grade: recommended', where: 'packages/shared/src/ai-periodization/ai-dynamic.ts', side: 'atLeast', before: 50, after: DELOAD_READINESS_RECOMMENDED_MIN },
  { name: 'AI prompt: rest day', where: 'packages/shared/src/ai-periodization/prompt.ts', side: 'below', before: 40, after: PROMPT_REST_DAY_READINESS_BELOW },
  { name: 'early-deload card', where: 'lib/health/readiness-payload.ts', side: 'below', before: 45, after: EARLY_DELOAD_READINESS_BELOW },
  { name: 'running gate: rest', where: 'packages/shared/src/running/recovery-gate.ts', side: 'below', before: 50, after: RUNNING_REST_READINESS_BELOW },
  { name: 'running gate: soften', where: 'packages/shared/src/running/recovery-gate.ts', side: 'below', before: 65, after: RUNNING_SOFTEN_READINESS_BELOW },
  { name: 'training stress: low readiness', where: 'lib/oura-models/inference/ots.ts', side: 'below', before: 60, after: OTS_LOW_READINESS_BELOW },
]
