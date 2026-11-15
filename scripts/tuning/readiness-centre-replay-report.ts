// #3778 — what moving the readiness centre to 75 does to STORED days, and whether the re-anchored
// decision thresholds still tell the same days to rest. READ-ONLY and pure: the CLI
// (`readiness-centre-replay.cjs`) feeds it rows from a database or the synthetic fixture and prints
// what this returns. Nothing here writes, and no stored score is ever rewritten by #3778.
//
// **The projection is the change, not a recompute of everything.** A stored row's score came from
// whatever model version was live that day. Recomputing it whole would mix #3778 with every older
// model change since, so this asks a narrower question: holding every other contributor where the
// row stored it, how far does THIS change move the row? Only resting HR, HRV balance and sleep
// balance moved, so
//
//     projected = clamp(round(stored + Σ w × (new sub-score − stored sub-score)))
//
// over those three. The new sub-score comes from the stored input (z) through the shipped curve when
// the row has one, from the stored sub-score through the same re-centring when it predates inputs
// (Q-501), and is the centre 75 when the contributor was unscored. The SQL in
// `docs/reviews/2026-11-15-readiness-centre-75.md` is the same arithmetic, so the two can be checked
// against each other on any local database.
import {
  baselineContributorCurve,
  preCentreSubScore,
  READINESS_BASELINE_CENTRE,
  READINESS_WEIGHTS,
} from '@trainingai/shared/health/readiness-composite'
import { scoreBand } from '@trainingai/shared/health/score-band'
import { READINESS_DECISION_THRESHOLDS } from '@trainingai/shared/health/readiness-decision-thresholds'

/** The three contributors #3778 re-centred, with the direction their stored z is read in. */
const CENTRED = {
  restingHeartRate: 'lower-better',
  hrvBalance: 'higher-better',
  sleepBalance: 'higher-better',
} as const

export interface StoredReadinessRow {
  day: string
  score: number
  contributors: unknown
}

export interface ProjectedRow {
  day: string
  stored: number
  projected: number
}

/** The same re-centring `baselineContributorCurve` applies, for a row that stored no z. */
function recentreStoredSubScore(s: number): number {
  const c = READINESS_BASELINE_CENTRE
  return s >= 50 ? c + (s - 50) * ((100 - c) / 50) : c - (50 - s) * (c / 50)
}

/** One stored row → its score under #3778, or null when the row has no contributor map to read. */
export function projectCentreShift(row: StoredReadinessRow): ProjectedRow | null {
  const map = row.contributors
  if (map == null || typeof map !== 'object' || Array.isArray(map)) return null
  let delta = 0
  let seen = 0
  for (const [key, direction] of Object.entries(CENTRED) as [keyof typeof CENTRED, 'lower-better' | 'higher-better'][]) {
    const c = (map as Record<string, unknown>)[key]
    if (c == null || typeof c !== 'object') continue
    const entry = c as { score?: unknown; input?: unknown }
    if (typeof entry.score !== 'number' || !Number.isFinite(entry.score)) continue
    seen++
    const next = !('input' in entry)
      ? recentreStoredSubScore(entry.score)
      : typeof entry.input === 'number' && Number.isFinite(entry.input)
        ? baselineContributorCurve(entry.input, direction)
        : READINESS_BASELINE_CENTRE
    delta += READINESS_WEIGHTS[key] * (Math.max(0, Math.min(100, Math.round(next))) - entry.score)
  }
  if (seen === 0) return null
  return { day: row.day, stored: row.score, projected: Math.max(0, Math.min(100, Math.round(row.score + delta))) }
}

export interface ThresholdCheck {
  name: string
  /** `below`: the rule fires when the score is under the threshold. `atLeast`: at or above it. */
  side: 'below' | 'atLeast'
  before: number
  after: number
  firedBefore: number
  firedAfter: number
  /** Days the rule fired on before and not after, and the reverse. */
  stoppedFiring: number
  startedFiring: number
  /** The `after` value that would fire on exactly as many days as `before` did on the stored scores. */
  ratePreserving: number
}

export interface CentreShiftReport {
  rows: number
  moved: number
  medianMove: number | null
  maxMove: number | null
  minMove: number | null
  bandChanged: number
  bandTransitions: Record<string, number>
  thresholds: ThresholdCheck[]
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function fires(side: ThresholdCheck['side'], score: number, t: number): boolean {
  return side === 'below' ? score < t : score >= t
}

export function summariseCentreShift(projected: ProjectedRow[]): CentreShiftReport {
  const moves = projected.map(r => r.projected - r.stored)
  const bandTransitions: Record<string, number> = {}
  let bandChanged = 0
  for (const r of projected) {
    const a = scoreBand(r.stored).label
    const b = scoreBand(r.projected).label
    if (a !== b) {
      bandChanged++
      bandTransitions[`${a} → ${b}`] = (bandTransitions[`${a} → ${b}`] ?? 0) + 1
    }
  }
  const thresholds = READINESS_DECISION_THRESHOLDS.map(t => {
    let firedBefore = 0, firedAfter = 0, stoppedFiring = 0, startedFiring = 0
    for (const r of projected) {
      const was = fires(t.side, r.stored, t.before)
      const now = fires(t.side, r.projected, t.after)
      if (was) firedBefore++
      if (now) firedAfter++
      if (was && !now) stoppedFiring++
      if (!was && now) startedFiring++
    }
    // Smallest value whose firing count on the projected scores reaches the old count (`below`), or
    // the largest whose count does not fall under it (`atLeast`). Scores are integers 0–100.
    let ratePreserving = t.before
    if (t.side === 'below') {
      for (let v = 0; v <= 101; v++) {
        if (projected.filter(r => r.projected < v).length >= firedBefore) { ratePreserving = v; break }
      }
    } else {
      for (let v = 101; v >= 0; v--) {
        if (projected.filter(r => r.projected >= v).length >= firedBefore) { ratePreserving = v; break }
      }
    }
    return { name: t.name, side: t.side, before: t.before, after: t.after, firedBefore, firedAfter, stoppedFiring, startedFiring, ratePreserving }
  })
  return {
    rows: projected.length,
    moved: moves.filter(m => m !== 0).length,
    medianMove: median(moves),
    maxMove: moves.length ? Math.max(...moves) : null,
    minMove: moves.length ? Math.min(...moves) : null,
    bandChanged,
    bandTransitions,
    thresholds,
  }
}

// ── The synthetic fixture ────────────────────────────────────────────────────────────────────────
//
// The local database seeds 14 days, too few for any normal to mature, so a replay over it moves
// nothing and proves nothing. This fixture stands in: stored v17 rows built the way the composite
// builds them, from z values that are standard normal by construction (v9 made every z a true σ)
// with a shared daily factor, and pass-through inputs at plausible levels. Three populations, because
// the shift depends on how spread the inputs are and the owner's real spread is what the production
// SQL measures. Deterministic: the same seed gives the same rows on every machine.

export interface SyntheticPopulation {
  name: string
  /** Mean previous-night Sleep Score, yesterday's Activity score and recovery-index score. */
  sleep: number
  activity: number
  recoveryIndex: number
  /** Correlation between the three centred z values (one shared daily factor). */
  rho: number
}

export const SYNTHETIC_POPULATIONS: readonly SyntheticPopulation[] = [
  { name: 'A: sleep 62, activity 62, rho 0.3', sleep: 62, activity: 62, recoveryIndex: 40, rho: 0.3 },
  { name: 'B: sleep 70, activity 65, rho 0.3', sleep: 70, activity: 65, recoveryIndex: 40, rho: 0.3 },
  { name: 'C: sleep 60, activity 60, rho 0.5', sleep: 60, activity: 60, recoveryIndex: 35, rho: 0.5 },
]

export function syntheticStoredRows(pop: SyntheticPopulation, n: number, seed = 3778): StoredReadinessRow[] {
  let state = seed
  const rnd = () => { state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648 }
  const gauss = () => { let u = 0; while (u === 0) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()) }
  const clamp = (x: number) => Math.max(0, Math.min(100, Math.round(x)))
  const rows: StoredReadinessRow[] = []
  for (let i = 0; i < n; i++) {
    const f = gauss()
    const z = () => Math.sqrt(pop.rho) * f + Math.sqrt(1 - pop.rho) * gauss()
    const rhrZ = z(), hrvZ = z(), sleepZ = z(), tempZ = gauss() * 0.8
    // The v17 sub-score: the pre-#3778 curve, which is the shipped curve read back on its old scale.
    const v17 = (zz: number, d: 'higher-better' | 'lower-better') => clamp(preCentreSubScore(baselineContributorCurve(zz, d)))
    const contributors = {
      restingHeartRate: { score: v17(rhrZ, 'lower-better'), input: rhrZ, provisional: false, gap: null },
      hrvBalance: { score: v17(hrvZ, 'higher-better'), input: hrvZ, provisional: false, gap: null },
      sleepBalance: { score: v17(sleepZ, 'higher-better'), input: sleepZ, provisional: false, gap: null },
      temperature: { score: clamp(baselineContributorCurve(tempZ, 'closer-better')), input: tempZ, provisional: false, gap: null },
      previousNight: { score: clamp(pop.sleep + 18 * (0.5 * f + 0.87 * gauss())), provisional: false, gap: null },
      activityBalance: { score: clamp(pop.activity + 15 * gauss()), provisional: false, gap: null },
      recoveryIndex: { score: clamp(pop.recoveryIndex + 20 * gauss()), provisional: true, gap: null },
    }
    const score = Math.round((Object.keys(READINESS_WEIGHTS) as (keyof typeof READINESS_WEIGHTS)[])
      .reduce((s, k) => s + contributors[k].score * READINESS_WEIGHTS[k], 0))
    rows.push({ day: `synthetic-${i}`, score, contributors })
  }
  return rows
}
