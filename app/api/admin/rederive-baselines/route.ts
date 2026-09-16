import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { rateLimit } from '@/lib/rate-limit'
import { DEFAULT_TZ, todayInTz } from '@trainingai/shared/date-utils'
import { computeDailySummaries, type NightInput } from '@trainingai/shared/health/daily-summary'
import type { OuraDailySummaryRow } from '@/lib/data/repository'

/**
 * Re-derive the stored personal baselines from the stored nightly values (BF-13 / TN-6 / Q-506).
 *
 * The seed defect itself shipped fixed (`seedOrUpdateBaseline`, Q-6): a fold that cold-starts now
 * seeds the mean from the first sample instead of annealing toward it from zero. That fix does not
 * reach the STORED baselines, because `computeDailySummaries` resumes from the previous night's
 * persisted checkpoint (`DailySummarySeed`) — so the zero-folded state is inherited forward every
 * night, indefinitely. Measured on the owner's history after the fix shipped: the temperature
 * baseline read 35.578 °C at n=62 and 35.658 at n=72, still climbing toward nightly values of
 * 35.72–36.04, with `temp_dev_c` positive on 10 nights out of 10.
 *
 * This replays the fold cold (`seed = null`) over the nights already persisted and rewrites what it
 * finds different. It restates no formula — `computeDailySummaries` is the same function the rollup
 * folds with, so what this writes is by construction what a fresh fold would have written.
 *
 * Admin-only. POST because it writes. `dryRun` (the default) reports the full before/after without
 * writing, so the range can be read before it is committed.
 */

/**
 * Only the temperature baseline is written back, per the owner's decision of 2026-08-24: fix the
 * seed for all six metrics, re-derive only the ones measurably wrong. Temperature was the only one
 * out by a meaningful amount (gap +2.80 nightly sd, above baseline on 100% of nights); the other
 * five sat between −0.09 and +0.28 sd, i.e. inside noise, and re-deriving them would be a data
 * change with no evidence behind it. They are still recomputed and REPORTED below, so a later
 * measurement that flips one has the number in front of it — adding it here is then a one-line
 * change, not an investigation.
 */
const WRITTEN_METRIC = 'temp' as const

/** The fold is only correct from the first night of history: a cold replay over a sub-range would
 *  seed from whichever night the range happened to start on, which is the defect this route exists
 *  to undo. So the read is deliberately unbounded and takes no `from`/`to` — unlike
 *  `backfill-derived-scores`, whose per-day recompute is genuinely independent per day. */
const HISTORY_FLOOR = '1970-01-01'

interface NightOutcome {
  date: string
  nHistory: number
  tempMeanC: number | null
  stored: { baselineC: number | null; devX8: number | null; tempDevC: number | null }
  rederived: { baselineC: number | null; devX8: number | null; tempDevC: number | null }
  action: 'written' | 'unchanged'
}

const toNightInput = (r: OuraDailySummaryRow): NightInput => ({
  date: r.date,
  sleepDurationHours: r.sleepDurationHours,
  sleepEfficiency: r.sleepEfficiency,
  deepSleepHours: r.deepSleepHours,
  remSleepHours: r.remSleepHours,
  restlessPeriods: r.restlessPeriods,
  sleepLatencySec: r.sleepLatencySec,
  hrvAvgMs: r.hrvAvgMs,
  rhrLowBpm: r.rhrLowBpm,
  rhrAvgBpm: r.rhrAvgBpm,
  recoveryIndexHours: r.recoveryIndexHours,
  tempMeanC: r.tempMeanC,
  metAvg: r.metAvg,
  breathAvgRpm: r.breathAvgRpm,
})

/** Baseline mean in °C. The ×100 factor is the one at the fold's own call site
 *  (`daily-summary.ts` — `Math.round(night.tempMeanC * 100)`), read from there rather than inferred:
 *  inferring the scale per metric is what produced BF-13's near-miss "severe sleep defect", which
 *  was only the ×60 factor being guessed as ×100. */
const tempBaselineC = (b: { meanX8: number } | null): number | null =>
  b == null ? null : b.meanX8 / 8 / 100

export async function POST(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await requireAdmin(userId, session.user?.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }

  if (!rateLimit(`${userId}:rederive-baselines`, 4, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  // Fail closed on the write: only an explicit `dryRun=false` commits.
  const dryRun = new URL(req.url).searchParams.get('dryRun') !== 'false'

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const repo = await getRepository()
  const stored = await repo.getOuraDailySummary(userId, HISTORY_FLOOR, todayInTz(tz))

  if (stored.length === 0) {
    return NextResponse.json({ error: 'No stored daily summaries to re-derive' }, { status: 404 })
  }

  const rederived = computeDailySummaries(stored.map(toNightInput), null)

  const nights: NightOutcome[] = []
  const toWrite: OuraDailySummaryRow[] = []
  // `nHistory` is incremented once per night unconditionally, so a cold replay over the same nights
  // reproduces it exactly. A mismatch therefore means the stored history is gapped or out of order —
  // a different defect from this one, so it is reported and never written.
  const nHistoryMismatches: { date: string; stored: number; rederived: number }[] = []

  for (let i = 0; i < stored.length; i++) {
    const before = stored[i]
    const after = rederived[i]
    if (before.nHistory !== after.nHistory) {
      nHistoryMismatches.push({ date: before.date, stored: before.nHistory, rederived: after.nHistory })
    }

    const changed =
      (before.tempBaseline?.meanX8 ?? null) !== (after.tempBaseline?.meanX8 ?? null) ||
      (before.tempBaseline?.devX8 ?? null) !== (after.tempBaseline?.devX8 ?? null) ||
      before.tempDevC !== after.tempDevC

    nights.push({
      date: before.date,
      nHistory: before.nHistory,
      tempMeanC: before.tempMeanC,
      stored: {
        baselineC: tempBaselineC(before.tempBaseline),
        devX8: before.tempBaseline?.devX8 ?? null,
        tempDevC: before.tempDevC,
      },
      rederived: {
        baselineC: tempBaselineC(after.tempBaseline),
        devX8: after.tempBaseline?.devX8 ?? null,
        tempDevC: after.tempDevC,
      },
      action: changed ? 'written' : 'unchanged',
    })

    if (!changed) continue
    // The stored row with only the temperature baseline and its deviation swapped in. Every other
    // column is the value read moments earlier, so the upsert — which sets the whole row — is
    // value-identical outside the two columns this route owns. The five untouched baselines come
    // through as `before`'s, deliberately, per WRITTEN_METRIC above.
    toWrite.push({ ...before, tempBaseline: after.tempBaseline, tempDevC: after.tempDevC })
  }

  // Sequential, like `backfill-derived-scores`: a history-wide fan-out against a `max: 10` pool
  // would starve the rest of the app (the failure mode that took production down in session 165).
  if (!dryRun && toWrite.length > 0) {
    await repo.upsertOuraDailySummary(userId, toWrite)
  }

  const latest = nights[nights.length - 1]
  return NextResponse.json({
    metric: WRITTEN_METRIC,
    timezone: tz,
    dryRun,
    generatedAt: new Date().toISOString(),
    summary: {
      nightsExamined: nights.length,
      changed: toWrite.length,
      unchanged: nights.length - toWrite.length,
      from: nights[0].date,
      to: latest.date,
      latestBaselineC: { stored: latest.stored.baselineC, rederived: latest.rederived.baselineC },
      nHistoryMismatches,
    },
    nights,
  })
}
