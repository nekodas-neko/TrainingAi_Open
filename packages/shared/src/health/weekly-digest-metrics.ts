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
// The week's recap, written from the numbers rather than asked for (RV-201).
//
// The model was handed `buildWeeklyDigestContext(metrics)` — a complete, deterministic fact block —
// and asked to reword it as bullets. Under the owner's 2026-09-25 prefer-logic decision (recorded
// on RV-200) that call goes, and the bullets are built here from the same metrics.
//
// **What is deliberately NOT carried over: the prompt's "one specific recommendation for the week
// ahead".** Templating a fact is restating something measured; templating advice is inventing it,
// and a rule that tells the owner to back off a week is a training decision rather than a
// rendering one. RV-201 asked for "bullets from the week-over-week deltas" and that is what this
// produces. If he wants the recommendation back it is a separate, deliberate design.

/** `+12%` / `−4%` / null when there is no prior week to compare against. */
function pct(now: number, prior: number): string | null {
  if (prior <= 0) return null
  const change = Math.round(((now - prior) / prior) * 100)
  return `${change > 0 ? '+' : change < 0 ? '−' : '±'}${Math.abs(change)}%`
}

/**
 * A signed delta between two whole-number readings, or null when either is missing.
 * Uses the same minus sign as `pct` — a hyphen and a minus render differently at the card's size.
 */
function delta(now: number | null, prior: number | null, unit: string): string | null {
  if (now == null || prior == null) return null
  const d = Math.round(now - prior)
  if (d === 0) return `level at ${now}${unit}`
  return `${d > 0 ? 'up' : 'down'} ${Math.abs(d)}${unit} to ${now}${unit}`
}

export function buildWeeklyDigestText(m: WeeklyDigestMetrics): string {
  const bullets: string[] = []

  // Training load. Sessions and tonnage together, because either alone misreads a week: three
  // heavy sessions and five light ones are not the same week at equal volume.
  const volPct = pct(m.training.volumeKg, m.training.priorVolumeKg)
  // A missing percentage has two causes and only one of them is "first week of data": a prior week
  // that was pure rest, or pure cardio, also has no tonnage to divide by. Saying the history does
  // not exist because last week was a deload is a false claim about the account, so the sentence
  // is reserved for a prior week with no sessions at all.
  const noPrior = m.training.priorSessions === 0 && m.training.priorVolumeKg === 0
  const load = `${m.training.sessions} session${m.training.sessions === 1 ? '' : 's'}, `
    + `${Math.round(m.training.volumeKg).toLocaleString('en-AU')} kg total`
    + (volPct ? ` (${volPct} vs the week before, which had ${m.training.priorSessions})`
      : noPrior ? ' — first week of data'
      : ` (the week before logged ${m.training.priorSessions} session${m.training.priorSessions === 1 ? '' : 's'} and no tonnage)`)
  bullets.push(load)

  if (m.muscleSets.length > 0) {
    const top = m.muscleSets.slice(0, 3).map(x => `${x.muscle} ${x.sets.toFixed(1)}`).join(', ')
    bullets.push(`Most-worked muscles by weighted sets: ${top}`)
  }

  bullets.push(m.prs.length > 0
    ? `Personal records: ${m.prs.map(p => p.description).join('; ')}`
    : 'No personal records this week')

  // Recovery, as one bullet rather than three — three near-identical lines read as padding.
  // Each clause carries its OWN label: hanging one "overnight HRV" off the front of the joined
  // list reads correctly only while HRV is present, and turns into "overnight HRV readiness down
  // 5" on any week without it.
  const sleepDiff = m.sleepHours.week != null && m.sleepHours.priorWeek != null
    ? m.sleepHours.week - m.sleepHours.priorWeek
    : null
  const recovery = [
    m.hrv.week != null
      ? `overnight HRV ${delta(m.hrv.week, m.hrv.priorWeek, ' ms') ?? `${Math.round(m.hrv.week)} ms`}`
      : null,
    m.readiness.week != null
      ? `readiness ${delta(m.readiness.week, m.readiness.priorWeek, '') ?? `${m.readiness.week}`}`
      : null,
    m.sleepScore.week != null
      ? `sleep quality ${delta(m.sleepScore.week, m.sleepScore.priorWeek, '') ?? `${m.sleepScore.week}`}/100`
      : null,
    m.sleepHours.week != null
      ? `sleep averaging ${m.sleepHours.week.toFixed(1)} h a night`
        // A rendered "+0.0 h" is a claim of change that the number contradicts; below the
        // printed precision there is nothing to report, so report nothing.
        + (sleepDiff != null && Math.abs(sleepDiff) >= 0.05
          ? ` (${sleepDiff > 0 ? '+' : '−'}${Math.abs(sleepDiff).toFixed(1)} h)`
          : '')
      : null,
  ].filter((x): x is string => x != null)
  if (recovery.length > 0) bullets.push(`Recovery — ${recovery.join(', ')}`)

  if (m.stressHighMinutes.week != null) {
    bullets.push(`High daytime stress ~${Math.round(m.stressHighMinutes.week)} min/day`
      + (m.stressHighMinutes.priorWeek != null
        ? ` (week before ~${Math.round(m.stressHighMinutes.priorWeek)})`
        : ''))
  }
  if (m.ots) {
    bullets.push(`Training stress averaged ${m.ots.avg.toFixed(1)}`
      + (m.ots.hasHighLoadDay ? ', with at least one high-load day' : ''))
  }

  if (m.illness) bullets.push(`Illness radar: ${m.illness.flag}`)
  if (m.resilience) bullets.push(`Resilience: ${m.resilience.band} (as of ${m.resilience.asOf})`)
  if (m.weightChangeKg != null && Math.abs(m.weightChangeKg) >= 0.1) {
    bullets.push(`Weight ${m.weightChangeKg > 0 ? 'up' : 'down'} ${Math.abs(m.weightChangeKg).toFixed(1)} kg over the fortnight`)
  }

  return bullets.map(b => `• ${b}`).join('\n')
}
