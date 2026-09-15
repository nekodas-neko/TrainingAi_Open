import { shiftDateStr } from '../date-utils'

/**
 * The structured week-in-review (BF-5).
 *
 * `app/api/weekly-digest` used to compute every one of these numbers, flatten them into a prose
 * block for the model, and throw the values away — so a page that wanted to CHART the week had
 * nothing to read but the model's sentences. Parsing them back out is the thing CLAUDE.md bans for
 * `JSON.parse` of model output, and worse here: the prompt only *asks* the model to quote the
 * numbers it was given.
 *
 * So the route builds this, and `buildWeeklyDigestContext` formats the prompt block FROM it. One
 * set of numbers, one place they are turned into words.
 */

/** A value on a calendar day, `null` where nothing was measured — a gap, not a zero. */
export interface DailyPoint {
  date: string
  value: number | null
}

export interface WeekOverWeek {
  week: number | null
  priorWeek: number | null
  /** Seven entries, recap-week Monday through Sunday. */
  byDay: DailyPoint[]
}

export interface WeeklyDigestMetrics {
  /** Recap-week Monday, in the user's timezone. */
  weekStart: string
  /** Recap-week Sunday. */
  weekEnd: string
  priorWeekStart: string

  training: {
    sessions: number
    priorSessions: number
    volumeKg: number
    priorVolumeKg: number
    /**
     * `null` when there is no prior week to compare against — NOT `0`, which would draw as
     * "no change" and is a different claim. The prose renders this case as "first week of data".
     */
    volumeChangePct: number | null
    byDay: { date: string; volumeKg: number; sessions: number }[]
  }

  /** Weighted sets per muscle for the recap week, heaviest first. */
  muscleSets: { muscle: string; sets: number }[]

  /**
   * `description` is `describePersonalRecord`'s output and is what a surface should render: a
   * bodyweight PR is BW_REF-relative and must never be shown as a weight (Q-19). `estimated1rm` is
   * the raw stored number, for charting only.
   */
  prs: { exerciseName: string; estimated1rm: number; description: string }[]

  /**
   * `source` is chosen for the WHOLE window, never per day — overnight HRV if any night in the
   * two weeks carries one, otherwise the body-metrics column. Mixing the two within one series
   * would draw points from two instruments on one line with nothing marking the change.
   */
  hrv: WeekOverWeek & { source: 'overnight' | 'body-metrics' | null }
  readiness: WeekOverWeek
  sleepScore: WeekOverWeek
  /** Hours, unrounded — the prose renders it to one decimal. */
  sleepHours: WeekOverWeek
  stressHighMinutes: WeekOverWeek

  illness: { flag: string; biomarkers: Record<string, { z: number }> | null } | null
  resilience: { level: number; band: string; asOf: string } | null
  ots: { avg: number; hasHighLoadDay: boolean } | null
  /** Newest reading minus oldest across the fetched two-week window. */
  weightChangeKg: number | null
  friendCount: number | null
}

/** The seven recap-week days, Monday first. */
export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => shiftDateStr(weekStart, i))
}

/**
 * The prompt's data block.
 *
 * Every line here was previously built inline in the route; the wording is reproduced exactly,
 * because changing what the model is told changes what the user reads and that is a separate
 * decision from making the numbers available.
 */
export function buildWeeklyDigestContext(m: WeeklyDigestMetrics): string {
  // The sign comes from comparing the volumes, not from the rounded percentage: a +0.4% week is
  // "+0%", and deriving the sign from the rounded value would print a bare "0%" instead.
  const volChange = m.training.priorVolumeKg > 0
    ? `${m.training.volumeKg > m.training.priorVolumeKg ? '+' : ''}${m.training.volumeChangePct}% vs the week before`
    : 'first week of data'

  const muscleVolumeLine = m.muscleSets.length > 0
    ? `Sets per muscle that week (weighted): ${m.muscleSets.map(x => `${x.muscle} ${x.sets.toFixed(1)}`).join(', ')}`
    : null

  const prLine = m.prs.length > 0
    ? `PRs that week: ${m.prs.map(p => p.description).join(', ')}`
    : 'PRs that week: none'

  const hrvLine = m.hrv.week != null
    ? `Overnight HRV: ${m.hrv.week} ms avg that week${m.hrv.priorWeek != null ? ` (week before ${m.hrv.priorWeek} ms)` : ''}`
    : null

  const readinessLine = m.readiness.week != null
    ? `Oura readiness: ${m.readiness.week}/100 avg that week${m.readiness.priorWeek != null ? ` (week before ${m.readiness.priorWeek}/100)` : ''}`
    : null

  const illnessZs = m.illness?.biomarkers && m.illness.flag !== 'normal'
    ? Object.entries(m.illness.biomarkers)
        .map(([k, v]) => `${k} z ${v.z > 0 ? '+' : ''}${v.z}`)
        .join(', ')
    : null
  const illnessLine = m.illness
    ? `Illness radar (vs personal baseline): ${m.illness.flag}${illnessZs ? ` — ${illnessZs}` : ''}`
    : null

  const stressLine = m.stressHighMinutes.week != null
    ? `Daytime stress: high for ~${m.stressHighMinutes.week} min/day avg that week${m.stressHighMinutes.priorWeek != null ? ` (week before ~${m.stressHighMinutes.priorWeek} min/day)` : ''}`
    : null

  const resilienceLine = m.resilience
    ? `Stress resilience: ${m.resilience.band} (level ${m.resilience.level}/5, as of ${m.resilience.asOf})`
    : null

  const otsLine = m.ots
    ? `Training stress (own OTS model): avg ${m.ots.avg.toFixed(1)} that week${m.ots.hasHighLoadDay ? ', with high-load day(s)' : ''}`
    : null

  const sleepQualityLine = m.sleepScore.week != null
    ? `Sleep quality: ${m.sleepScore.week}/100 avg nightly sleep score that week${m.sleepScore.priorWeek != null ? ` (week before ${m.sleepScore.priorWeek}/100)` : ''}`
    : null

  return [
    `Last week (the completed Mon–Sun week being reviewed): ${m.training.sessions} sessions, ${m.training.volumeKg} kg volume (${volChange})`,
    `The week before that: ${m.training.priorSessions} sessions, ${m.training.priorVolumeKg} kg volume`,
    muscleVolumeLine,
    prLine,
    hrvLine,
    readinessLine,
    illnessLine,
    stressLine,
    resilienceLine,
    otsLine,
    m.weightChangeKg != null ? `Body weight change: ${m.weightChangeKg.toFixed(1)} kg over 2 weeks` : null,
    m.sleepHours.week != null ? `${m.sleepHours.week.toFixed(1)}h avg sleep` : null,
    sleepQualityLine,
    m.friendCount != null ? `Friends training that week: ${m.friendCount} friends connected` : null,
  ].filter(Boolean).join('\n')
}
