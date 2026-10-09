import type { WorkoutRepository } from '@/lib/data/repository'
import { todayInTz, shiftDateStr, daysBetweenDateStrs, dateStrMidnightInTz } from '@trainingai/shared/date-utils'
import { computeBodyBatteryDay, BODY_BATTERY_MODEL_VERSION } from '@/lib/health/body-battery-day'
import { isMeasuredBatteryDay } from '@/lib/data/postgres/slices/body-battery'

/**
 * Re-derive stored Body Battery days under the current model (TN-72, owner-approved 2026-09-27).
 * The one implementation, called by `POST /api/admin/rederive-body-battery` (admin session) and by
 * the agent key (`/api/agent-actions`, job `rederive-body-battery`, issue 2381).
 *
 * `body_battery_daily` is written only by the live route, for today, so a model change left every
 * earlier day on the model it was written under: v5 days ending near 0 beside v6 days ending near
 * 60, a step that reads as a recovery. This recomputes each finished day through the same function
 * the route serves from, walking midnight to midnight.
 *
 * **The anchor is kept, not re-chosen.** Each stored row carries the anchor that day froze, and
 * v5 → v6 changed the walk, not the anchor rule. A day with no stored row is skipped rather than
 * invented, and today is skipped because the live route owns it.
 *
 * `dryRun` writes nothing, and it is sequential: each day is ~10 queries against a `max: 10` pool
 * (session 165).
 *
 * **`kept` is a day the write guard refuses** (TN-20): the recompute recorded no movement and the
 * stored day did, so the stored day stays. Before #2230 such a day was reported `written`, with its
 * end-value delta in the summary, although nothing changed in the table.
 *
 * Idempotent: a second run over the same range finds every day `unchanged` and writes nothing.
 */

export const REDERIVE_BODY_BATTERY_MAX_RANGE_DAYS = 31

interface DayOutcome {
  date: string
  action: 'written' | 'kept' | 'unchanged' | 'no-row' | 'today'
  stored?: { endValue: number; modelVersion: string | null }
  recomputed?: { endValue: number; charged: number; drained: number; hrSampleCount: number }
  error?: string
}

export interface RederiveBodyBatteryInput {
  repo: WorkoutRepository
  userId: string
  tz: string
  /** Already-normalised `YYYY-MM-DD`, or null for the default (the 31 days ending yesterday). */
  from: string | null
  to: string | null
  dryRun: boolean
}

export type RederiveBodyBatteryResult =
  | { ok: true; report: Awaited<ReturnType<typeof buildReport>> }
  | { ok: false; error: string }

export async function rederiveBodyBattery(input: RederiveBodyBatteryInput): Promise<RederiveBodyBatteryResult> {
  const { tz, from, to } = input
  const today = todayInTz(tz)
  const end = to ?? shiftDateStr(today, -1)
  const start = from ?? shiftDateStr(end, -(REDERIVE_BODY_BATTERY_MAX_RANGE_DAYS - 1))
  if (end < start) return { ok: false, error: '`to` must not precede `from`' }
  const span = daysBetweenDateStrs(start, end) + 1
  if (span > REDERIVE_BODY_BATTERY_MAX_RANGE_DAYS) {
    return { ok: false, error: `Range too wide — ${span} days requested, ${REDERIVE_BODY_BATTERY_MAX_RANGE_DAYS} is the maximum` }
  }
  return { ok: true, report: await buildReport(input, start, end, span, today) }
}

async function buildReport(input: RederiveBodyBatteryInput, start: string, end: string, span: number, today: string) {
  const { repo, userId, tz, dryRun } = input
  const storedRows = await repo.getBodyBatteryHistory(userId, start, end)
  const storedByDate = new Map(storedRows.map(r => [r.date, r]))
  const days: DayOutcome[] = []

  for (let i = 0; i < span; i++) {
    const d = shiftDateStr(start, i)
    if (d >= today) { days.push({ date: d, action: 'today' }); continue }
    const stored = storedByDate.get(d)
    if (!stored) { days.push({ date: d, action: 'no-row' }); continue }
    try {
      const { snapshot } = await computeBodyBatteryDay({
        repo, userId, tz, date: d,
        until: dateStrMidnightInTz(shiftDateStr(d, 1), tz),
        computeReadinessIfMissing: false,
      })
      const same = stored.modelVersion === snapshot.modelVersion && stored.endValue === snapshot.endValue
        && stored.totalCharged === snapshot.totalCharged && stored.totalDrained === snapshot.totalDrained
      let action: DayOutcome['action'] = 'unchanged'
      if (!same) {
        // A real run takes the database's answer; a dry run predicts it from the same rule.
        const written = dryRun
          ? isMeasuredBatteryDay(snapshot) || !isMeasuredBatteryDay(stored)
          : await repo.upsertBodyBatteryDaily(userId, snapshot)
        action = written ? 'written' : 'kept'
      }
      days.push({
        date: d,
        action,
        stored: { endValue: stored.endValue, modelVersion: stored.modelVersion },
        recomputed: {
          endValue: snapshot.endValue, charged: snapshot.totalCharged,
          drained: snapshot.totalDrained, hrSampleCount: snapshot.hrSampleCount,
        },
      })
    } catch (err) {
      // One day that cannot be computed must never abort the range.
      console.error(`[rederive-body-battery] ${d} failed:`, err)
      days.push({ date: d, action: 'no-row', error: err instanceof Error ? err.message : String(err) })
    }
  }

  // The owner asked for how many days move and by how much, so the summary answers that directly.
  const moved = days.filter(x => x.action === 'written' && x.stored && x.recomputed)
  const deltas = moved.map(x => x.recomputed!.endValue - x.stored!.endValue)
  const ends = days.filter(x => x.recomputed).map(x => x.recomputed!.endValue)
  const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null)

  return {
    from: start, to: end, timezone: tz, dryRun, modelVersion: BODY_BATTERY_MODEL_VERSION,
    generatedAt: new Date().toISOString(),
    summary: {
      daysExamined: days.length,
      written: moved.length,
      kept: days.filter(x => x.action === 'kept').length,
      unchanged: days.filter(x => x.action === 'unchanged').length,
      noRow: days.filter(x => x.action === 'no-row' && !x.error).length,
      failed: days.filter(x => x.error).length,
      endValueDelta: { mean: mean(deltas), meanAbs: mean(deltas.map(Math.abs)), min: deltas.length ? Math.min(...deltas) : null, max: deltas.length ? Math.max(...deltas) : null },
      recomputedEnd: { mean: mean(ends), atZero: ends.filter(v => v === 0).length, atHundred: ends.filter(v => v === 100).length },
    },
    days,
  }
}
