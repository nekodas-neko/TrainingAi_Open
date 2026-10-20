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
 *   night and the nights before it, so it is rebuilt by the readiness read's own scorer
 *   (`scoreSleepForDate`, one night window for both). A day left with no night is cleared.
 * - **Readiness, today: cleared.** The readiness read rewrites today on its next read once today's
 *   night exists (it persists on every read), and leaves it empty if the night is gone.
 * - **Readiness, a finished day: kept and marked** (`model_versions.readinessNightRevisedAt`). A
 *   finished day's readiness is what it said that morning, built from that morning's activity, load
 *   and illness inputs, which no later read can rebuild. Clearing it would turn a revised value into a
 *   gap; the marker lets the Orchestrator find and re-derive it from a verified snapshot.
 * - **Body Battery, today: released only when the night ARRIVED in this write.** A readiness anchor
 *   is frozen for its day, and a revision of a night that was already there must not move it: on
 *   18 Oct Oura revised the night at 22:23 local, and releasing then would have shifted that whole
 *   day's curve in the evening (Orchestrator's decision on #3085). An anchor frozen before today's
 *   night existed was frozen on a readiness without it (from that morning's body metrics), so it is
 *   released and the next read re-chooses it. "Arrived" means no night for today before the write,
 *   one after, AND no tombstoned Oura Cloud sleep row for the day (#3099): a delete then a
 *   re-create in two webhooks is a revision, so the anchor stays. A live nap or rest row on the day
 *   does not count (#3104 review). A finished day's battery is left for the re-derive.
 *
 * **One user at a time.** Two sleep webhooks for the same user can land in the same second (19 Oct's
 * two periods did). Interleaved, an older fingerprint can be re-scored last and a stale score stick on
 * a finished day, so the read-before, the write and the re-score run under a per-user lock
 * (`withOuraSleepWriteLock`).
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
import { sleepComponentsToContributors, SLEEP_SCORE_MODEL_VERSION } from '@trainingai/shared/health/sleep-score'
import { scoreSleepForDate, SLEEP_SCORE_HISTORY_DAYS } from '@trainingai/shared/health/sleep-score-for-date'

/** How many days back a changed night is re-scored. Matches the training-stress look-back. */
export const RESCORE_WINDOW_DAYS = 7

export type NightRescoreRepo = Pick<WorkoutRepository,
  'getUserById' | 'listSleepSessions' | 'getOuraDailyDerived' | 'upsertOuraDailyDerived' |
  'clearNightDerivedScores' | 'releaseBodyBatteryAnchor' | 'withOuraSleepWriteLock' | 'listDeletedOuraCloudSleepDates'>

export interface NightWatch {
  userId: string
  tz: string
  today: string
  /** Wake date → fingerprint of that date's canonical night, before the write. */
  before: Map<string, string>
  /** Wake dates that held a tombstoned Oura Cloud sleep row before the write. */
  hadDeletedOuraNight: Set<string>
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

/** `date`'s Sleep Score and contributors through the readiness read's own scorer. Null with no night. */
export function scoreNightForDate(sessions: readonly SleepSession[], date: string, tz: string) {
  const scored = scoreSleepForDate(sessions, date, tz)
  return scored ? { score: scored.result.score, contributors: sleepComponentsToContributors(scored.result.components) } : null
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
  const [sessions, ouraDates] = await Promise.all([
    repo.listSleepSessions(userId, shiftDateStr(from, -1), today),
    repo.listDeletedOuraCloudSleepDates(userId, from, today),
  ])
  return { userId, tz, today, before: nightFingerprints(sessions, tz, from, today), hadDeletedOuraNight: new Set(ouraDates) }
}

/** After the write: re-scores every recent day whose night changed. See the file header for what each pillar gets. */
export async function rescoreChangedNights(repo: NightRescoreRepo, watch: NightWatch, now: Date = new Date()): Promise<RescoreOutcome> {
  const { userId, tz, today } = watch
  const from = windowFrom(today)
  const sessions = await repo.listSleepSessions(userId, shiftDateStr(from, -SLEEP_SCORE_HISTORY_DAYS), today)
  const after = nightFingerprints(sessions, tz, from, today)
  const changed = changedNightDates(watch.before, after)
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
      // #3099: a night appearing on a day where Oura had deleted one is a re-create, a revision: a
      // delete and a re-create in two webhooks must not release an anchor frozen while the night was
      // there. Only deleted rows count; a live nap or rest row on the day leaves a late night an arrival.
      const arrived = !watch.before.has(day) && after.has(day) && !watch.hadDeletedOuraNight.has(day)
      if (arrived && await repo.releaseBodyBatteryAnchor(userId, day)) out.batteryReleased.push(day)
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
  return repo.withOuraSleepWriteLock(userId, async () => {
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
  })
}
