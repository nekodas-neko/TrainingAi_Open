import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { rateLimit } from '@/lib/rate-limit'
import { DEFAULT_TZ, todayInTz, normalizeDateParamIso, shiftDateStr, daysBetweenDateStrs } from '@trainingai/shared/date-utils'
import { buildBatteryRecoveryCalibration } from '@trainingai/shared/health/battery-recovery-calibration'
import { reportServerError } from '@/lib/observability'
import { answeredMorningScales } from '@trainingai/shared/health/self-report'
import { generationCensus, modelGeneration } from '@trainingai/shared/health/model-generation'

/**
 * Admin Body-Battery calibration: each day's end-of-day battery next to the recovery rating the
 * owner gave that morning, plus how well the two agree over the window.
 *
 * Read-only, GET-only, admin session required. Q-79 — this is a regression check that the model
 * still tracks what the owner reports feeling, NOT a user-facing insight. The measured gradient is
 * modest and the owner already knows how recovered they felt; what has value is noticing the day
 * the agreement breaks.
 *
 * Values come from `body_battery_daily.end_value` as persisted — never recomputed here, so the
 * panel checks what the app actually served rather than what a fresh run would produce.
 */

/** Widest window a single request may cover. */
const MAX_RANGE_DAYS = 180
const DEFAULT_RANGE_DAYS = 60

export async function GET(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await requireAdmin(userId, session.user?.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }

  if (!rateLimit(`${userId}:battery-recovery-calibration`, 20, 60_000)) {
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

  const rawDays = Number(q.get('days'))
  const days = Number.isFinite(rawDays) && rawDays >= 1
    ? Math.min(Math.floor(rawDays), MAX_RANGE_DAYS)
    : DEFAULT_RANGE_DAYS

  const end = to ?? todayInTz(tz)
  const start = from ?? shiftDateStr(end, -(days - 1))
  if (end < start) {
    return NextResponse.json({ error: '`to` must not precede `from`' }, { status: 400 })
  }
  const span = daysBetweenDateStrs(start, end) + 1
  if (span > MAX_RANGE_DAYS) {
    return NextResponse.json(
      { error: `Range too wide — ${span} days requested, ${MAX_RANGE_DAYS} is the maximum` },
      { status: 400 },
    )
  }

  try {
    const repo = await getRepository()
    const [battery, checkins] = await Promise.all([
      repo.getBodyBatteryHistory(userId, start, end),
      repo.listDayCheckins(userId, start, end, 'morning'),
    ])

    // TN-57: the touched flag, not the column. 78 of the owner's 97 morning rows carry a
    // `perceived_recovery` and none of them was ever answered — so this route was calibrating
    // against a neutral seed. The correlation is expected to EMPTY rather than shift, and
    // that is the correct result, not something to rescue by relaxing the filter.
    const recoveryByDate = new Map(checkins.map(c => [c.logDate, answeredMorningScales(c).perceivedRecovery]))
    const batteryByDate = new Map(battery.map(b => [b.date, b.endValue]))

    // LA-135. `model_version` has been written on every row since the table existed and read by
    // nothing, so a window spanning a model change produced one correlation over two different
    // models and said nothing about it. Measured 2026-09-24: four generations are stored, and the
    // v4 → v5 boundary alone moves the mean end-of-day value 62.9 → 15.2.
    //
    // The window is NOT narrowed. Silently dropping days would answer a question nobody asked and
    // hide that it had done so; a 90-day request would come back computed over a handful of rows
    // with nothing saying why. Instead the census ships beside the figure, and when the window does
    // span a boundary each generation also gets its own calibration — so there is always a number
    // that means something, next to the evidence for whether the headline one does.
    const models = generationCensus(battery.map(b => b.modelVersion))
    const spansModelChange = models.length > 1
    const byModel = spansModelChange
      ? models.map(({ generation, days }) => ({
          generation,
          days,
          calibration: buildBatteryRecoveryCalibration({
            from: start,
            to: end,
            batteryByDate: new Map(
              battery
                .filter(b => modelGeneration(b.modelVersion) === generation)
                .map(b => [b.date, b.endValue]),
            ),
            recoveryByDate,
          }),
        }))
      : null

    return NextResponse.json(
      {
        timezone: tz,
        generatedAt: new Date().toISOString(),
        models,
        spansModelChange,
        byModel,
        ...buildBatteryRecoveryCalibration({
          from: start,
          to: end,
          batteryByDate,
          recoveryByDate,
        }),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (err) {
    reportServerError(err, { userId, url: '/api/admin/battery-recovery-calibration' })
    console.error('[admin/battery-recovery-calibration] failed:', err)
    return NextResponse.json(
      { error: 'Failed to build the calibration', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
