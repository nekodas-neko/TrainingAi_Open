// Per-exercise HR trend aggregation (plan 2026-07-21-per-set-hr-metrics). Rolls the durable per-set
// snapshots (set_hr_stats) up to one point per session and a per-intensity-band breakdown for a single
// exercise. Derive-don't-store: this runs on read, never persisted (mirrors hrr-trend.ts). Pure.
import type { SetHrStatsRow } from '@/lib/data/repository'

export interface ExerciseHrSessionPoint {
  workoutSessionId: string
  /** ISO date (yyyy-mm-dd) of the session, from the first set's logged_at. */
  date: string | null
  phaseType: string | null
  setCount: number
  /** Sets that had trustworthy HR coverage — the metric means are over these only. */
  coveredSets: number
  avgPeakBpm: number | null
  maxPeakBpm: number | null
  avgBpm: number | null
  /** Mean beat-drop during rest at 30/60/90/120s after the set — the recovery curve (null past the
   *  rest actually taken; e.g. avgDrop120 is null when rests were < 2 min). */
  avgDrop30: number | null
  avgDrop60: number | null
  avgDrop90: number | null
  avgDrop120: number | null
  bestDrop60: number | null
  avgSecToPreset: number | null
  avgSecToResting: number | null
  avgPctHrrAtRestEnd: number | null
}

export interface ExerciseHrIntensityBucket {
  /** Inclusive-exclusive %1RM band label, e.g. "70–79". */
  label: string
  min: number
  max: number
  n: number
  avgPeakBpm: number | null
  avgDrop60: number | null
  avgPctHrrAtRestEnd: number | null
}

export interface ExerciseHrTrend {
  exerciseName: string | null
  sessions: ExerciseHrSessionPoint[]
  byIntensity: ExerciseHrIntensityBucket[]
  totalSets: number
  coveredSets: number
}

const INTENSITY_BANDS: { label: string; min: number; max: number }[] = [
  { label: '<70',   min: 0,   max: 70 },
  { label: '70–79', min: 70,  max: 80 },
  { label: '80–89', min: 80,  max: 90 },
  { label: '90+',   min: 90,  max: Infinity },
]

function mean(nums: (number | null)[]): number | null {
  const vals = nums.filter((n): n is number => n != null)
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
}

function toIsoDate(d: Date | null): string | null {
  if (!d) return null
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** Aggregate one exercise's per-set rows (oldest-first) into per-session points + an intensity-band
 *  breakdown. Metric means use only sets with `coverageOk` — a censored/sparse set contributes to
 *  setCount but not to the HR numbers. */
export function aggregateExerciseHrTrend(rows: SetHrStatsRow[]): ExerciseHrTrend {
  const exerciseName = rows[0]?.exerciseName ?? null

  // ── Per-session points ──
  const bySession = new Map<string, SetHrStatsRow[]>()
  for (const r of rows) {
    const arr = bySession.get(r.workoutSessionId) ?? []
    arr.push(r)
    bySession.set(r.workoutSessionId, arr)
  }

  const sessions: ExerciseHrSessionPoint[] = [...bySession.entries()].map(([workoutSessionId, sets]) => {
    const covered = sets.filter(s => s.coverageOk)
    const peaks = covered.map(s => s.peakBpm).filter((n): n is number => n != null)
    const firstDated = sets.find(s => s.loggedAt != null)?.loggedAt ?? null
    return {
      workoutSessionId,
      date: toIsoDate(firstDated),
      phaseType: sets.find(s => s.phaseType != null)?.phaseType ?? null,
      setCount: sets.length,
      coveredSets: covered.length,
      avgPeakBpm: mean(covered.map(s => s.peakBpm)),
      maxPeakBpm: peaks.length ? Math.max(...peaks) : null,
      avgBpm: mean(covered.map(s => s.avgBpm)),
      avgDrop30: mean(covered.map(s => s.drop30s)),
      avgDrop60: mean(covered.map(s => s.drop60s)),
      avgDrop90: mean(covered.map(s => s.drop90s)),
      avgDrop120: mean(covered.map(s => s.drop120s)),
      bestDrop60: (() => {
        const d = covered.map(s => s.drop60s).filter((n): n is number => n != null)
        return d.length ? Math.max(...d) : null
      })(),
      avgSecToPreset: mean(covered.map(s => s.secToPreset)),
      avgSecToResting: mean(covered.map(s => s.secToResting)),
      avgPctHrrAtRestEnd: mean(covered.map(s => s.pctHrrAtRestEnd)),
    }
  }).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))

  // ── Per-intensity-band breakdown (covered sets with a known %1RM) ──
  const covered = rows.filter(r => r.coverageOk)
  const byIntensity: ExerciseHrIntensityBucket[] = INTENSITY_BANDS.map(band => {
    const inBand = covered.filter(r => r.intensityPct != null && r.intensityPct >= band.min && r.intensityPct < band.max)
    return {
      label: band.label, min: band.min, max: band.max === Infinity ? 100 : band.max,
      n: inBand.length,
      avgPeakBpm: mean(inBand.map(r => r.peakBpm)),
      avgDrop60: mean(inBand.map(r => r.drop60s)),
      avgPctHrrAtRestEnd: mean(inBand.map(r => r.pctHrrAtRestEnd)),
    }
  }).filter(b => b.n > 0)

  return { exerciseName, sessions, byIntensity, totalSets: rows.length, coveredSets: covered.length }
}

export interface ExerciseHrSummary {
  exerciseName: string
  exerciseId: string | null
  sessions: number
  coveredSets: number
  lastDate: string | null
  avgPeakBpm: number | null
  /** Mean 60s beat-drop during rest — the headline recovery number (higher = faster recovery). */
  avgDrop60: number | null
  avgPctHrrAtRestEnd: number | null
  avgSecToPreset: number | null
}

/** One summary row per exercise from a mixed bag of per-set rows — the cross-exercise overview the
 *  AI uses to compare lifts (e.g. "which recovers slowest") before drilling into one. Newest-trained
 *  first. Metric means use covered sets only. */
export function summarizeHrByExercise(rows: SetHrStatsRow[]): ExerciseHrSummary[] {
  const groups = new Map<string, SetHrStatsRow[]>()
  for (const r of rows) {
    const key = r.exerciseId ?? `name:${r.exerciseName}`
    const arr = groups.get(key) ?? []
    arr.push(r)
    groups.set(key, arr)
  }
  return [...groups.values()].map(g => {
    const covered = g.filter(s => s.coverageOk)
    const dated = g.map(s => s.loggedAt).filter((d): d is Date => d != null).sort((a, b) => b.getTime() - a.getTime())
    return {
      exerciseName: g[0].exerciseName,
      exerciseId: g[0].exerciseId,
      sessions: new Set(g.map(s => s.workoutSessionId)).size,
      coveredSets: covered.length,
      lastDate: toIsoDate(dated[0] ?? null),
      avgPeakBpm: mean(covered.map(s => s.peakBpm)),
      avgDrop60: mean(covered.map(s => s.drop60s)),
      avgPctHrrAtRestEnd: mean(covered.map(s => s.pctHrrAtRestEnd)),
      avgSecToPreset: mean(covered.map(s => s.secToPreset)),
    }
  }).sort((a, b) => (b.lastDate ?? '').localeCompare(a.lastDate ?? ''))
}
