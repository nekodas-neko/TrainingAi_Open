/**
 * #3079 — a night Oura revises or deletes re-scores the day it belongs to.
 *
 * Our stored scores are computed when the app reads them, for the newest night only. Under the Oura
 * API a night arrives late, is re-sent when Oura re-analyses it, and can be deleted, so a day's
 * stored Sleep Score, readiness and Body Battery anchor could outlive the night they were built on.
 *
 * The mechanism is the smallest one that needs no new column: every Oura sleep write is bracketed by
 * {@link watchNights} (before) and {@link rescoreChangedNights} (after). Each recent day's canonical
 * night is fingerprinted on both sides, and only a day whose night actually changed is touched:
 *
 * - **Sleep Score: recomputed now**, for any changed day in the window. It is a function of the
 *   night and the nights before it, so it can be rebuilt exactly as the readiness read builds it
 *   (same 28-day list, same grouping, prior-night baselines). A day left with no night is cleared.
 * - **Readiness, today: cleared.** The readiness read rewrites today on its next read once today's
 *   night exists (it persists on every read), and leaves it empty if the night is gone.
 * - **Readiness, a finished day: kept and marked** (`model_versions.readinessNightRevisedAt`). A
 *   finished day's readiness is what it said that morning, built from that morning's activity, load
 *   and illness inputs, which no later read can rebuild. Clearing it would turn a revised value into a
 *   gap; the marker lets the Orchestrator find and re-derive it from a verified snapshot.
 * - **Body Battery, today: released.** A readiness anchor is frozen for its day; it goes back to
 *   provisional so the next read re-chooses it. A finished day's battery is left for the re-derive.
 *
 * A re-read of identical documents (the daily reconciliation, a webhook repeat) changes no
 * fingerprint and so writes nothing. Changes older than {@link RESCORE_WINDOW_DAYS} are not acted
 * on, which bounds the work and keeps a 90-day connect backfill from rewriting history on its own.
 * Best-effort throughout: a failure here is logged and never fails the ingest that triggered it.
 */
import type { WorkoutRepository } from '@/lib/data/repository'
import type { SleepSession } from '@trainingai/shared/types/body'
import { DEFAULT_TZ, shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'
import { nightSessions, canonicalNightForDate } from '@trainingai/shared/health/sleep-night'
import { computeSleepScore, sleepComponentsToContributors, sleepScoreBaselines, SLEEP_SCORE_MODEL_VERSION } from '@trainingai/shared/health/sleep-score'

/** How many days back a changed night is re-scored. Matches the training-stress look-back. */
export const RESCORE_WINDOW_DAYS = 7
/** The readiness read's history window, so a night re-scored here is scored on the same nights. */
const SLEEP_HISTORY_DAYS = 28

export type NightRescoreRepo = Pick<WorkoutRepository,
  'getUserById' | 'listSleepSessions' | 'getOuraDailyDerived' | 'upsertOuraDailyDerived' |
  'clearNightDerivedScores' | 'releaseBodyBatteryAnchor'>

export interface NightWatch {
  userId: string
  tz: string
  today: string
  /** Wake date → fingerprint of that date's canonical night, before the write. */
  before: Map<string, string>
}

export interface RescoreOutcome {
  /** Days whose canonical night changed, oldest first. */
  changed: string[]
  sleepRescored: string[]
  sleepCleared: string[]
  readinessCleared: string[]
  readinessMarked: string[]
  batteryReleased: string[]
}

/**
 * Every value that can change a night's score, in a stable order. Row ids and write stamps are not,
 * and neither is Oura's own sleep score, which is never ours (#3000) and which Oura re-scores without
 * changing the night.
 */
function fingerprint(night: object): string {
  const entries = Object.entries(night)
    .filter(([k]) => !/^(id|userId|updatedAt|createdAt|syncedAt|sleepScore)$/.test(k))
    .map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v] as const)
    .sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify(entries)
}

/**
 * Wake date → fingerprint of its canonical night, for every date in `[from, to]` that has one. Built
 * from the sessions dated in the window only, so the before and after sides group the same rows.
 */
export function nightFingerprints(sessions: readonly SleepSession[], tz: string, from: string, to: string): Map<string, string> {
  const inWindow = sessions.filter(s => s.date >= shiftDateStr(from, -1) && s.date <= to)
  const nights = nightSessions(inWindow, tz)
  const out = new Map<string, string>()
  for (const date of new Set(nights.map(n => n.date))) {
    if (date < from || date > to) continue
    const night = canonicalNightForDate(nights, date, tz)
    if (night) out.set(date, fingerprint(night))
  }
  return out
}

/** Dates whose night appeared, went, or changed between the two sides, oldest first. */
export function changedNightDates(before: Map<string, string>, after: Map<string, string>): string[] {
  const dates = new Set([...before.keys(), ...after.keys()])
  return [...dates].filter(d => before.get(d) !== after.get(d)).sort()
}

/**
 * `date`'s Sleep Score exactly as the readiness read scores its newest night: the sessions dated in
 * the 28 days up to it, grouped into nights, its canonical night against baselines of the nights
 * that ended before it. Null when the date has no night to score.
 */
export function scoreNightForDate(sessions: readonly SleepSession[], date: string, tz: string) {
  const nights = nightSessions(sessions.filter(s => s.date >= shiftDateStr(date, -SLEEP_HISTORY_DAYS) && s.date <= date), tz)
  const night = canonicalNightForDate(nights, date, tz)
  if (!night) return null
  const result = computeSleepScore(night, tz, sleepScoreBaselines(
    nights.filter(n => n.sleepEnd.getTime() < night.sleepEnd.getTime()), tz,
  ))
  return result ? { score: result.score, contributors: sleepComponentsToContributors(result.components) } : null
}

function windowFrom(today: string): string {
  return shiftDateStr(today, -RESCORE_WINDOW_DAYS)
}

/** Fingerprints the recent nights before an Oura sleep write. */
export async function watchNights(repo: NightRescoreRepo, userId: string): Promise<NightWatch> {
  const user = await repo.getUserById(userId)
  const tz = user?.timezone ?? DEFAULT_TZ
  const today = todayInTz(tz)
  const from = windowFrom(today)
  const sessions = await repo.listSleepSessions(userId, shiftDateStr(from, -1), today)
  return { userId, tz, today, before: nightFingerprints(sessions, tz, from, today) }
}

/** After the write: re-scores every recent day whose night changed. See the file header for what each pillar gets. */
export async function rescoreChangedNights(repo: NightRescoreRepo, watch: NightWatch, now: Date = new Date()): Promise<RescoreOutcome> {
  const { userId, tz, today } = watch
  const from = windowFrom(today)
  const sessions = await repo.listSleepSessions(userId, shiftDateStr(from, -SLEEP_HISTORY_DAYS), today)
  const changed = changedNightDates(watch.before, nightFingerprints(sessions, tz, from, today))
  const out: RescoreOutcome = { changed, sleepRescored: [], sleepCleared: [], readinessCleared: [], readinessMarked: [], batteryReleased: [] }
  if (changed.length === 0) return out

  const stored = new Map((await repo.getOuraDailyDerived(userId, changed[0], today)).map(r => [r.day, r]))
  for (const day of changed) {
    const scored = scoreNightForDate(sessions, day, tz)
    if (scored) {
      await repo.upsertOuraDailyDerived(userId, day, {
        sleepScore: scored.score,
        sleepContributors: scored.contributors,
        modelVersions: { sleep: SLEEP_SCORE_MODEL_VERSION },
      })
      out.sleepRescored.push(day)
    } else if (await repo.clearNightDerivedScores(userId, day, { sleep: true, readiness: false })) {
      out.sleepCleared.push(day)
    }

    if (day === today) {
      if (await repo.clearNightDerivedScores(userId, day, { sleep: false, readiness: true })) out.readinessCleared.push(day)
      if (await repo.releaseBodyBatteryAnchor(userId, day)) out.batteryReleased.push(day)
    } else if (stored.get(day)?.readinessScore != null) {
      await repo.upsertOuraDailyDerived(userId, day, { modelVersions: { readinessNightRevisedAt: now.toISOString() } })
      out.readinessMarked.push(day)
    }
  }
  return out
}

/**
 * Brackets one Oura sleep write: fingerprints before, re-scores after. Never throws; a failure on
 * either side is logged and the write's own result is returned untouched.
 */
export async function withNightRescore<T>(repo: NightRescoreRepo | undefined, userId: string, write: () => Promise<T>): Promise<T> {
  if (!repo) return write()
  let watch: NightWatch | null = null
  try {
    watch = await watchNights(repo, userId)
  } catch (err) {
    console.error('[rescore-nights] could not read the nights before an Oura sleep write:', err)
  }
  const result = await write()
  if (watch) {
    try {
      const outcome = await rescoreChangedNights(repo, watch)
      if (outcome.changed.length > 0) console.info(`[rescore-nights] nights changed: ${JSON.stringify(outcome)}`)
    } catch (err) {
      console.error('[rescore-nights] re-scoring the changed nights failed:', err)
    }
  }
  return result
}
