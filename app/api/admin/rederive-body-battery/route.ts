import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { rateLimit } from '@/lib/rate-limit'
import { DEFAULT_TZ, todayInTz, normalizeDateParamIso, shiftDateStr, daysBetweenDateStrs, dateStrMidnightInTz } from '@trainingai/shared/date-utils'
import { computeBodyBatteryDay, BODY_BATTERY_MODEL_VERSION } from '@/lib/health/body-battery-day'

/**
 * Re-derive stored Body Battery days under the current model (TN-72, owner-approved 2026-09-27).
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
 * Admin-only, POST because it writes, `dryRun` unless `dryRun=false`, and sequential: each day is
 * ~10 queries against a `max: 10` pool (session 165).
 */

const MAX_RANGE_DAYS = 31

interface DayOutcome {
  date: string
  action: 'written' | 'unchanged' | 'no-row' | 'today'
  stored?: { endValue: number; modelVersion: string | null }
  recomputed?: { endValue: number; charged: number; drained: number; hrSampleCount: number }
  error?: string
}

export async function POST(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await requireAdmin(userId, session.user?.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }
  if (!rateLimit(`${userId}:rederive-body-battery`, 4, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const q = req.nextUrl.searchParams
  const parse = (raw: string | null) => (raw ? normalizeDateParamIso(raw) : null)
  const from = parse(q.get('from'))
  const to = parse(q.get('to'))
  if ((q.get('from') && !from) || (q.get('to') && !to)) {
    return NextResponse.json({ error: 'Invalid date — expected YYYY-MM-DD or YYYY/MM/DD' }, { status: 400 })
  }
  const dryRun = q.get('dryRun') !== 'false'

  const today = todayInTz(tz)
  const end = to ?? shiftDateStr(today, -1)
  const start = from ?? shiftDateStr(end, -(MAX_RANGE_DAYS - 1))
  if (end < start) return NextResponse.json({ error: '`to` must not precede `from`' }, { status: 400 })
  const span = daysBetweenDateStrs(start, end) + 1
  if (span > MAX_RANGE_DAYS) {
    return NextResponse.json(
      { error: `Range too wide — ${span} days requested, ${MAX_RANGE_DAYS} is the maximum` },
      { status: 400 },
    )
  }

  const repo = await getRepository()
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
      const outcome: DayOutcome = {
        date: d,
        action: same ? 'unchanged' : 'written',
        stored: { endValue: stored.endValue, modelVersion: stored.modelVersion },
        recomputed: {
          endValue: snapshot.endValue, charged: snapshot.totalCharged,
          drained: snapshot.totalDrained, hrSampleCount: snapshot.hrSampleCount,
        },
      }
      if (!dryRun && !same) await repo.upsertBodyBatteryDaily(userId, snapshot)
      days.push(outcome)
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

  return NextResponse.json({
    from: start, to: end, timezone: tz, dryRun, modelVersion: BODY_BATTERY_MODEL_VERSION,
    generatedAt: new Date().toISOString(),
    summary: {
      daysExamined: days.length,
      written: moved.length,
      unchanged: days.filter(x => x.action === 'unchanged').length,
      noRow: days.filter(x => x.action === 'no-row' && !x.error).length,
      failed: days.filter(x => x.error).length,
      endValueDelta: { mean: mean(deltas), meanAbs: mean(deltas.map(Math.abs)), min: deltas.length ? Math.min(...deltas) : null, max: deltas.length ? Math.max(...deltas) : null },
      recomputedEnd: { mean: mean(ends), atZero: ends.filter(v => v === 0).length, atHundred: ends.filter(v => v === 100).length },
    },
    days,
  })
}
