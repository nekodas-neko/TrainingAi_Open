import type { WorkoutRepository } from '@/lib/data/repository'
import { dateStrMidnightInTz, shiftDateStr, toAestDateStr, toAestDay } from '@trainingai/shared/date-utils'
import { HRR1_MAX_OFFSET_MS, measureHrr60, planHrr1Backfill, summariseHrr1Changes, type Hrr1Change } from '@trainingai/shared/workout/hrr1-backfill'
import { HRR60_ANCHOR_TOL_MS, HRR60_BAR_WINDOW_DAYS, personalHrr60Bar, setRestAnchorMs } from '@trainingai/shared/workout/hrr60'

/**
 * Re-measure every stored `set_hr_stats` row's `hrr1_bpm`, `rest_adequate` and drop curve from dense
 * HR (#2457, #2601, #2299 step 2). The ONE implementation behind both doors:
 * `POST /api/admin/backfill-set-hrr1` (admin session) and the agent-key job `backfill-set-hrr1`
 * (`lib/agent-actions/jobs.ts`). Moved here unchanged from the route so the key could reach it.
 *
 * It overwrites stored values, null included: a verified snapshot first (docs/admin-actions.md).
 */
/** How much series is fetched past the last set end in a session: the largest drop offset and its
 *  anchor tolerance, so the last set's 90 s and 120 s drops can be re-derived. */
const WINDOW_TAIL_MS = HRR1_MAX_OFFSET_MS + HRR60_ANCHOR_TOL_MS
const SAMPLE_LIMIT = 50

export async function backfillSetHrr1(args: {
  repo: Pick<WorkoutRepository, 'listSetHrStatsForHrr1Backfill' | 'getHrForWindow' | 'writeSetHrr1'>
  userId: string
  tz: string
  dryRun: boolean
}) {
  const { repo, userId, tz, dryRun } = args
  const rows = await repo.listSetHrStatsForHrr1Backfill(userId)

  const bySession = new Map<string, typeof rows>()
  for (const r of rows) {
    const list = bySession.get(r.workoutSessionId)
    if (list) list.push(r)
    else bySession.set(r.workoutSessionId, [r])
  }

  // Pass 1: every session's series, and every row's HRR60 — the inputs to each row's bar.
  const series = new Map<string, Awaited<ReturnType<typeof repo.getHrForWindow>>>()
  const sessionStartMs = new Map<string, number>()
  const hrr60ByTime: { atMs: number; bpm: number }[] = []
  let noSeries = 0
  for (const [sessionId, sessionRows] of bySession) {
    const ends = sessionRows.map(r => setRestAnchorMs(r.setEndMs, r.loggedAt)).filter((t): t is number => t != null)
    const readings = ends.length
      ? await repo.getHrForWindow(
        userId,
        new Date(Math.min(...ends) - HRR60_ANCHOR_TOL_MS),
        new Date(Math.max(...ends) + WINDOW_TAIL_MS),
      )
      : []
    if (readings.length === 0) noSeries += sessionRows.length
    series.set(sessionId, readings)
    if (ends.length) sessionStartMs.set(sessionId, Math.min(...ends))
    for (const r of sessionRows) {
      const bpm = measureHrr60(r, readings)
      const anchorMs = setRestAnchorMs(r.setEndMs, r.loggedAt)
      if (bpm != null && anchorMs != null) hrr60ByTime.push({ atMs: anchorMs, bpm })
    }
  }
  const barForSession = (sessionId: string): number => {
    const start = sessionStartMs.get(sessionId)
    if (start == null) return personalHrr60Bar([])
    const from = dateStrMidnightInTz(shiftDateStr(toAestDay(new Date(start), tz), -HRR60_BAR_WINDOW_DAYS), tz).getTime()
    return personalHrr60Bar(hrr60ByTime.filter(h => h.atMs >= from && h.atMs < start).map(h => h.bpm))
  }

  // Pass 2: plan each session's rows against its own bar.
  const changes: Hrr1Change[] = []
  let measured = 0
  for (const [sessionId, sessionRows] of bySession) {
    const bar = barForSession(sessionId)
    const planned = planHrr1Backfill(sessionRows, series.get(sessionId) ?? [], () => bar)
    changes.push(...planned)
    const afterById = new Map(planned.map(c => [c.setLogId, c.after.hrr1Bpm]))
    measured += sessionRows
      .filter(r => (afterById.has(r.setLogId) ? afterById.get(r.setLogId) : r.hrr1Bpm) != null).length
  }

  const written = dryRun
    ? 0
    : await repo.writeSetHrr1(userId, changes.map(c => ({ setLogId: c.setLogId, ...c.after })))

  const days = new Set(changes.filter(c => c.loggedAt).map(c => toAestDateStr(c.loggedAt!, tz)))

  return {
    dryRun,
    timezone: tz,
    generatedAt: new Date().toISOString(),
    summary: {
      rowsExamined: rows.length,
      sessionsExamined: bySession.size,
      rowsWithHrr1After: measured,
      rowsWithNoSeries: noSeries,
      ...summariseHrr1Changes(changes),
      daysChanged: days.size,
      written,
    },
    sample: changes.slice(0, SAMPLE_LIMIT).map(c => ({
      setLogId: c.setLogId, loggedAt: c.loggedAt?.toISOString() ?? null, before: c.before, after: c.after,
    })),
  }
}
