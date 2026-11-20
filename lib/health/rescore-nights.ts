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
 * - **Readiness, today: cleared, then scored now** (#3872), with the illness radar's fields stored
 *   beside it (#3086). The clear takes the score's provenance with it; the readiness read itself
 *   (`buildReadinessPayload`) then runs and stores today's score under its own rule, so a night
 *   arriving after the day's last read, or on a day the app is never opened, still leaves a score.
 *   With today's night gone it writes no readiness and the day stays empty. The read is the caller's
 *   to hand in (`scoreToday`, from `today-readiness-scorer.ts`): it reaches `@/lib/data`, and this
 *   module is reached from the data layer, so it must not import the read, not even lazily (the
 *   1.525.0 release test: Turbopack served `@/lib/data` empty through that cycle). A bare repository
 *   target (the adapter's `partial_night` outbox op) clears today's readiness and leaves the score
 *   to the next read.
 * - **Readiness, a finished day with a score: kept and marked**
 *   (`model_versions.readinessNightRevisedAt`). A finished day's readiness is what it said that
 *   morning, built from that morning's activity, load and illness inputs, which no later read can
 *   rebuild. Clearing it would turn a revised value into a gap; the marker lets the Orchestrator find
 *   and re-derive it from a verified snapshot.
 * - **Readiness, a finished day with no score: scored now** (#3872). Its night arrived after local
 *   midnight, or nothing scored it while it was today. It is scored by the per-day scorer the admin
 *   backfill uses (`buildDayAudit`), since the read can only score today. It fills a gap and replaces
 *   nothing a read stored: the fill is marked `readinessFilledOnArrival`, and only a day carrying
 *   that mark is scored again when more of its inputs land.
 * - **Readiness, when the `daily_readiness` document lands** ({@link rescoreReadinessDocuments}).
 *   It carries the temperature input, and it is not a sleep write. Landing after the night, it
 *   re-runs the same scorer for a recent day whose night exists, so the stored score does not depend
 *   on which document came first. If today's temperature arrived with it and the score moved, a
 *   frozen Body Battery anchor is released, as for a night that arrived.
 * - **"Today" is the read's clock**, not the watch's: a write that straddles local midnight treats
 *   the watched day as finished rather than clearing it for a read that will score the next day.
 * - **The webhook answers first** (`rescoreReadinessAfterAnswer`): readiness scoring is the full
 *   readiness read, so it runs as a job after the answer, under the same per-user lock, deciding on
 *   the state it finds then. Other callers score inline.
 * - **Body Battery, today: released only when the night ARRIVED in this write.** A readiness anchor
 *   is frozen for its day, and a revision of a night that was already there must not move it: on
 *   18 Oct Oura revised the night at 22:23 local, and releasing then would have shifted that whole
 *   day's curve in the evening (Orchestrator's decision on #3085). An anchor frozen before today's
 *   night existed was frozen on a readiness without it (from that morning's body metrics), so it is
 *   released and the next read re-chooses it. "Arrived" means no night for today before the write,
 *   one after, AND no tombstoned Oura Cloud NIGHT for the day (#3099): a delete then a re-create in
 *   two webhooks is a revision, so the anchor stays. A nap does not count, live (#3104 review) or
 *   deleted and retyped to `rest` (#3106 review). A finished day's battery is left for the re-derive.
 *
 * **One user at a time.** Two sleep webhooks for the same user can land in the same second (19 Oct's
 * two periods did). Interleaved, an older fingerprint can be re-scored last and a stale score stick on
 * a finished day, so the read-before, the write and the re-score run under a per-user lock
 * (`withOuraSleepWriteLock`).
 *
 * A re-read of identical documents (the daily reconciliation, a webhook repeat) changes no
 * fingerprint and so writes nothing. Changes older than {@link RESCORE_WINDOW_DAYS} are not acted
 * on, which bounds the work and keeps a 90-day connect backfill from rewriting history on its own.
 *
 * **The owner's own mark is the exception on both counts (#2265).** Marking or unmarking a night
 * partial is the owner's action on one named night, so that night is re-scored wherever it falls
 * (`ownerChanged`, below), not only inside the window: trends, the day log and the week view read the
 * stored score of an old night. And when the night is today's, today's frozen Body Battery anchor is
 * released the way an arriving night releases it, because the anchor was built from that night.
 * Best-effort throughout: a failure here is logged and never fails the ingest that triggered it.
 */
import type { WorkoutRepository } from '@/lib/data/repository'
import type { SleepSession } from '@trainingai/shared/types/body'
import { DEFAULT_TZ, shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'
import { nightSessions, canonicalNightForDate } from '@trainingai/shared/health/sleep-night'
import { sleepComponentsToContributors } from '@trainingai/shared/health/sleep-score'
import { scoreSleepForDate, SLEEP_SCORE_HISTORY_DAYS } from '@trainingai/shared/health/sleep-score-for-date'
import { scoreFinishedDayReadiness, readinessFilledOnArrival } from '@/lib/health/night-readiness'

/** How many days back a changed night is re-scored. Matches the training-stress look-back. */
export const RESCORE_WINDOW_DAYS = 7

/**
 * The whole repository: since #3872 a finished day is scored by `buildDayAudit`, which reads every
 * input a day's readiness has.
 */
export type NightRescoreRepo = WorkoutRepository

export interface NightWatch {
  userId: string
  tz: string
  today: string
  /** Wake date → fingerprint of that date's canonical night, before the write. */
  before: Map<string, string>
  /** Wake dates that held a tombstoned Oura Cloud night (never a nap) before the write. */
  hadDeletedOuraNight: Set<string>
}

export interface RescoreOutcome {
  /** Days whose canonical night changed, oldest first. */
  changed: string[]
  sleepRescored: string[]
  sleepCleared: string[]
  readinessCleared: string[]
  /** Days whose readiness was scored in this re-score (#3872). */
  readinessScored: string[]
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
 * #3872 review: whether a `daily_readiness` document's mapped day row differs from the stored one on
 * any value it carries. Oura's own readiness score is left out, as `fingerprint` leaves out its sleep
 * score: it is never ours (#3000). The webhook skips an unchanged document, the usual duplicate, so
 * it starts no readiness scoring on the per-user lock the morning's sleep writes wait on.
 */
export function readinessDocumentChanged(incoming: object, stored: object | undefined): boolean {
  const prior = (stored ?? {}) as Record<string, unknown>
  return Object.entries(incoming)
    .filter(([k]) => k !== 'date' && k !== 'readinessScore')
    .some(([k, v]) => JSON.stringify(v ?? null) !== JSON.stringify(prior[k] ?? null))
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
  return scored ? { score: scored.result.score, contributors: sleepComponentsToContributors(scored.result.components), modelVersion: scored.result.modelVersion } : null
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
    repo.listDeletedOuraCloudSleepDates(userId, from, today, tz),
  ])
  return { userId, tz, today, before: nightFingerprints(sessions, tz, from, today), hadDeletedOuraNight: new Set(ouraDates) }
}

/**
 * Defers a readiness scoring job past the answer to the request that caused it (#3872 review). Oura's
 * webhook allows 10 s, and today's scorer is the full readiness read. The job takes the per-user
 * lock itself and never throws.
 */
export type ReadinessScoringDefer = (job: () => Promise<void>) => void

/**
 * Runs the readiness read for today, which stores today's readiness when today's night exists and
 * writes nothing for readiness otherwise. Injected (`scoreTodayReadiness` in
 * `today-readiness-scorer.ts`) because the read reaches `@/lib/data` and this module is reached from
 * it. Throws on failure; the caller logs it.
 */
export type TodayReadinessScorer = (userId: string, tz: string) => Promise<void>

/** How readiness is scored after a re-score. Without `scoreToday`, today's readiness is left to the next read. */
export interface ReadinessScoring { scoreToday?: TodayReadinessScorer; deferReadiness?: ReadinessScoringDefer }

/** A re-score target that scores today's readiness, inline or (with `deferReadiness`) after the caller answers. */
export interface ScoringNightRescore extends ReadinessScoring { repo: NightRescoreRepo }

/** What an Oura write re-scores with: the bare repository (today's readiness left to the read), or a scoring target. */
export type NightRescoreTarget = NightRescoreRepo | ScoringNightRescore

/**
 * The webhook's target: the night's Sleep Score and clears inside the write, readiness right after
 * the answer. A long-running server (Railway), so the job outlives the response.
 */
export function rescoreReadinessAfterAnswer(repo: NightRescoreRepo, scoreToday: TodayReadinessScorer): ScoringNightRescore {
  return { repo, scoreToday, deferReadiness: job => { void job().catch(err => console.error('[rescore-nights] deferred readiness scoring failed:', err)) } }
}

/** The repository and readiness scoring a target carries. */
export function unpackRescoreTarget(target: NightRescoreTarget): { repo: NightRescoreRepo; scoring: ReadinessScoring } {
  return 'repo' in target
    ? { repo: target.repo, scoring: { scoreToday: target.scoreToday, deferReadiness: target.deferReadiness } }
    : { repo: target, scoring: {} }
}

/** After the write: re-scores every recent day whose night changed. See the file header for what each pillar gets. */
export async function rescoreChangedNights(
  repo: NightRescoreRepo, watch: NightWatch, now: Date = new Date(), ownerChanged: readonly string[] = [],
  /** `scoreToday` scores today's readiness; `deferReadiness` runs the scoring as a job handed to it instead of before this returns. */
  scoring: ReadinessScoring = {},
): Promise<RescoreOutcome> {
  const { scoreToday, deferReadiness } = scoring
  const { userId, tz, today } = watch
  const from = windowFrom(today)
  const ownerDates = ownerChanged.filter(d => d <= today)
  const earliest = [from, ...ownerDates].reduce((a, b) => (a < b ? a : b))
  const sessions = await repo.listSleepSessions(userId, shiftDateStr(earliest, -SLEEP_SCORE_HISTORY_DAYS), today)
  const after = nightFingerprints(sessions, tz, from, today)
  const changed = [...new Set([...changedNightDates(watch.before, after), ...ownerDates])].sort()
  const out: RescoreOutcome = { changed, sleepRescored: [], sleepCleared: [], readinessCleared: [], readinessScored: [], readinessMarked: [], batteryReleased: [] }
  if (changed.length === 0) return out

  // The readiness read decides "today" on its own clock. A write that began before local midnight
  // and re-scores after it must treat the watched day as finished: cleared, the read would score the
  // new day and leave this one empty for good (#3872 review).
  const stillToday = todayInTz(tz) === today
  for (const day of changed) {
    const scored = scoreNightForDate(sessions, day, tz)
    if (scored) {
      await repo.upsertOuraDailyDerived(userId, day, {
        sleepScore: scored.score,
        sleepContributors: scored.contributors,
        modelVersions: { sleep: scored.modelVersion },
      })
      out.sleepRescored.push(day)
    } else if (await repo.clearNightDerivedScores(userId, day, { sleep: true, readiness: false })) {
      out.sleepCleared.push(day)
    }

    if (day === today && stillToday) {
      if (await repo.clearNightDerivedScores(userId, day, { sleep: false, readiness: true })) out.readinessCleared.push(day)
      // #3099: a night appearing on a day where Oura had deleted one is a re-create, a revision: a
      // delete and a re-create in two webhooks must not release an anchor frozen while the night was
      // there. Only deleted rows count; a live nap or rest row on the day leaves a late night an arrival.
      const arrived = !watch.before.has(day) && after.has(day) && !watch.hadDeletedOuraNight.has(day)
      // #2265: the owner's mark on today's night changes what today's anchor was built from.
      const ownerMarked = ownerDates.includes(day) && after.has(day)
      if ((arrived || ownerMarked) && await repo.releaseBodyBatteryAnchor(userId, day)) out.batteryReleased.push(day)
    }
  }

  // #3872: readiness for each changed day, after its night's own scores, decided on the state the
  // job finds when it runs (so a deferred job that runs after a later write still scores right).
  const job = () => scoreReadinessForDays(repo, userId, tz, changed, { markRevised: true, now, scoreToday })
  if (deferReadiness) {
    deferReadiness(() => repo.withOuraSleepWriteLock(userId, async () => logReadiness(await job())))
  } else {
    const r = await job()
    out.readinessScored.push(...r.scored)
    out.readinessMarked.push(...r.marked)
  }
  return out
}

export interface ReadinessScoringOutcome { scored: string[]; marked: string[]; batteryReleased: string[] }

function logReadiness(r: ReadinessScoringOutcome): void {
  if (r.scored.length + r.marked.length + r.batteryReleased.length > 0) console.info(`[rescore-nights] readiness: ${JSON.stringify(r)}`)
}

/**
 * Scores readiness for `days` (#3872), each on its own night, best-effort per day:
 *
 * - **Today** (by the read's own clock): the readiness read (`opts.scoreToday`), which stores a
 *   score only when today's night exists. Without it, today is left to the next read. With `releaseAnchorOnChange` holding today, a frozen Body
 *   Battery anchor is released when the score moved, so the battery re-anchors on the score the
 *   readiness card shows (Q-39).
 * - **A finished day** with no score, or with one this path filled itself
 *   (`readinessFilledOnArrival`): the per-day scorer, `scoreFinishedDayReadiness`.
 * - **A finished day with a score a read stored** keeps it. With `markRevised` (its night changed)
 *   it is marked `readinessNightRevisedAt` for the re-derive.
 *
 * A day with no night of its own is never scored.
 */
export async function scoreReadinessForDays(
  repo: NightRescoreRepo, userId: string, tz: string, days: readonly string[],
  opts: {
    markRevised?: boolean; releaseAnchorOnChange?: ReadonlySet<string>; now?: Date
    /** Day → readiness stored before the write that started this; the anchor's change test compares against it. */
    priorScores?: ReadonlyMap<string, number | null>
    /** The readiness read for today; without it, today is skipped. */
    scoreToday?: TodayReadinessScorer
  } = {},
): Promise<ReadinessScoringOutcome> {
  const out: ReadinessScoringOutcome = { scored: [], marked: [], batteryReleased: [] }
  const today = todayInTz(tz)
  const due = [...new Set(days)].filter(d => d <= today).sort()
  if (due.length === 0) return out
  const now = opts.now ?? new Date()
  const [sessions, rows] = await Promise.all([
    repo.listSleepSessions(userId, shiftDateStr(due[0], -1), today),
    repo.getOuraDailyDerived(userId, due[0], today),
  ])
  const nights = nightSessions(sessions, tz)
  const stored = new Map(rows.map(r => [r.day, r]))
  for (const day of due) {
    const hasNight = canonicalNightForDate(nights, day, tz) != null
    const row = stored.get(day)
    if (day === today) {
      const scoreToday = opts.scoreToday
      if (!hasNight || !scoreToday) continue
      // The score before the document's write, when the caller took it: a read can store the new
      // score between the write and this job, and then the row alone shows no change.
      const before = opts.priorScores?.get(day) ?? row?.readinessScore ?? null
      const after = await bestEffort(day, async () => {
        await scoreToday(userId, tz)
        return (await repo.getOuraDailyDerived(userId, day, day))[0]?.readinessScore ?? null
      }, null)
      if (after == null) continue
      out.scored.push(day)
      if (opts.releaseAnchorOnChange?.has(day) && before != null && after !== before &&
        await bestEffort(day, () => repo.releaseBodyBatteryAnchor(userId, day), false)) out.batteryReleased.push(day)
      continue
    }
    const hasScore = row?.readinessScore != null
    if (!hasNight || (hasScore && !readinessFilledOnArrival(row?.modelVersions))) {
      if (hasScore && opts.markRevised) {
        await repo.upsertOuraDailyDerived(userId, day, { modelVersions: { readinessNightRevisedAt: now.toISOString() } })
        out.marked.push(day)
      }
      continue
    }
    // A finished day that never got a score, its night late, or one this path filled before the
    // rest of its inputs landed. Neither moves a value the owner saw.
    if (await bestEffort(day, () => scoreFinishedDayReadiness(repo, userId, day, tz, now), false)) out.scored.push(day)
  }
  return out
}

/**
 * #3872 review: a `daily_readiness` document carries the temperature input that today's readiness
 * and the illness radar read, and it is not a sleep write. Landing after the night, it re-scores the
 * recent days it covers, so the stored score is the same whichever document came first.
 * `temperatureArrived`: days that had no temperature before this write; only there may a frozen Body
 * Battery anchor move (an anchor frozen on a readiness without its temperature, like one frozen
 * before the night, #3085), and only when the score moved from `priorScores`, the score stored
 * before the write. The webhook passes only the days whose document changed
 * ({@link readinessDocumentChanged}). A deferred job lost to a restart is caught by the daily
 * reconcile (`reconcile.ts` → `backfillOuraCloud` → here, inline), which passes every recent day it
 * re-reads, changed or not. Best-effort; never throws.
 */
export async function rescoreReadinessDocuments(
  target: NightRescoreTarget, userId: string, days: readonly string[], temperatureArrived: readonly string[] = [],
  /** Day → readiness stored before the document was written (`writeOuraCloudData` reads it). */
  priorScores?: ReadonlyMap<string, number | null>,
): Promise<void> {
  if (days.length === 0) return
  const { repo, scoring } = unpackRescoreTarget(target)
  const defer = scoring.deferReadiness
  const job = () => repo.withOuraSleepWriteLock(userId, async () => {
    const user = await repo.getUserById(userId)
    const tz = user?.timezone ?? DEFAULT_TZ
    const from = windowFrom(todayInTz(tz))
    const recent = days.filter(d => d >= from)
    if (recent.length === 0) return
    logReadiness(await scoreReadinessForDays(repo, userId, tz, recent, { releaseAnchorOnChange: new Set(temperatureArrived), priorScores, scoreToday: scoring.scoreToday }))
  })
  const run = async () => {
    try { await job() } catch (err) { console.error('[rescore-nights] re-scoring readiness for a readiness document failed:', err) }
  }
  if (defer) defer(run)
  else await run()
}

/**
 * One day's readiness scoring, best-effort: a failure is logged and the remaining days still run,
 * as the sleep score's and the battery's do.
 */
async function bestEffort<T>(day: string, run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run()
  } catch (err) {
    console.error(`[rescore-nights] scoring readiness for ${day} failed:`, err)
    return fallback
  }
}

/**
 * Brackets one Oura sleep write: fingerprints before, re-scores after. Never throws; a failure on
 * either side is logged and the write's own result is returned untouched.
 */
export async function withNightRescore<T>(
  target: NightRescoreTarget | undefined, userId: string, write: () => Promise<T>,
  /** Wake dates the write changed by the owner's own hand, from its result: re-scored outside the window too. */
  ownerChanged?: (result: T) => string[],
): Promise<T> {
  if (!target) return write()
  const { repo, scoring } = unpackRescoreTarget(target)
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
        const outcome = await rescoreChangedNights(repo, watch, new Date(), ownerChanged?.(result) ?? [], scoring)
        if (outcome.changed.length > 0) console.info(`[rescore-nights] nights changed: ${JSON.stringify(outcome)}`)
      } catch (err) {
        console.error('[rescore-nights] re-scoring the changed nights failed:', err)
      }
    }
    return result
  })
}

/**
 * `ownerChanged` for {@link withNightRescore} around `setPartialNight`: the marked night's wake date,
 * only when the mark really flipped. A repeat tap or a replayed op re-scores nothing and never moves
 * today's frozen anchor (#3085: no anchor moves in the evening for a non-change).
 */
export function partialNightRescore(result: { date: string; changed: boolean } | 'not_found'): string[] {
  return result === 'not_found' || !result.changed ? [] : [result.date]
}
