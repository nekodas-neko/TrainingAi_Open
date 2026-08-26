// Three devices, one time grid — the owner's "compare data across the 3 devices" (PS-8).
//
// Oura ring, Polar H10 chest strap and the Colmi R09, aligned to a common bucket and scored
// pairwise. The strap is the only real ground truth here: it measures electrically rather than
// optically, so a ring/ring disagreement says they differ while a ring/strap disagreement says
// which one is wrong.
//
// LEARNING MODE: this route READS the Colmi tables — reading is what learning mode is for — and
// writes nothing anywhere. It produces no score and nothing here reaches one.
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { alignSeries, allPairSummaries, coverage, bucketSeries, type NamedSeries } from '@/lib/health/device-comparison'
import { normalizeDateParamIso, DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { formatInTimeZone } from 'date-fns-tz'

/** Device keys are stable strings the UI and any later report can key on. */
const OURA = 'oura_ring'
const STRAP = 'chest_strap'
const COLMI = 'colmi_ring'
const DEVICES = [OURA, STRAP, COLMI]

/**
 * Default bucket width. **Five minutes, not one.**
 *
 * The strap emits ~1 Hz, but both rings sample every 5 minutes at their finest. On a 1-minute grid
 * two 5-minute devices coincide only by luck, so every ring-to-ring pair would report `overlap: 0`
 * — which reads as "they never agreed" when it means "they were never compared". Bucket to the
 * coarsest cadence present, and let the caller widen it further for a whole-day view.
 */
const DEFAULT_BUCKET_MINUTES = 5
const MAX_BUCKET_MINUTES = 60

const MAX_DAYS = 30
/** Rows are capped so a month-long window cannot return a 40k-row body. The cap is REPORTED, never
 *  silent — a truncated table that looks complete is worse than no table. */
const MAX_ROWS = 3000

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }

  const userId = session.user.id
  const tz = session.user.timezone ?? DEFAULT_TZ
  const params = req.nextUrl.searchParams

  // Every date param goes through normalizeDateParam before any arithmetic — a raw param reaching
  // date maths is a 500, and this route accepts both separators because the client emits slashes.
  // `normalizeDateParamIso` accepts BOTH separators — the client's localDateString() emits slashes,
  // and a dash-only regex rejects every real request before the handler runs.
  const toStr = normalizeDateParamIso(params.get('to') ?? formatInTimeZone(new Date(), tz, 'yyyy-MM-dd'))
  if (!toStr) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
  const fromStr = normalizeDateParamIso(params.get('from') ?? toStr)
  if (!fromStr) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })

  const from = new Date(`${fromStr}T00:00:00.000Z`)
  const to = new Date(`${toStr}T23:59:59.999Z`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
    return NextResponse.json({ error: 'Invalid range' }, { status: 400 })
  }
  const spanDays = Math.round((to.getTime() - from.getTime()) / 86_400_000)
  if (spanDays > MAX_DAYS) {
    return NextResponse.json({ error: `Range too wide — ${MAX_DAYS} days maximum` }, { status: 400 })
  }

  const bucketRaw = Number(params.get('bucket') ?? DEFAULT_BUCKET_MINUTES)
  const bucketMinutes = Number.isFinite(bucketRaw)
    ? Math.min(MAX_BUCKET_MINUTES, Math.max(1, Math.round(bucketRaw)))
    : DEFAULT_BUCKET_MINUTES

  const repo = await getRepository()
  const [ouraRows, strapRows, colmiRows] = await Promise.all([
    // 'ble' is the Oura ring's own source tag on oura_heartrate; 'chest_strap' is the H10's.
    repo.getOuraHeartrateBySource(userId, 'ble', from, to),
    repo.getOuraHeartrateBySource(userId, 'chest_strap', from, to),
    repo.getColmiReadings(userId, ['heart_rate'], from, to),
  ])

  const series: NamedSeries[] = [
    { device: OURA,  points: bucketSeries(ouraRows.map(r => ({ timestamp: r.timestamp, value: r.bpm })), bucketMinutes) },
    { device: STRAP, points: bucketSeries(strapRows.map(r => ({ timestamp: r.timestamp, value: r.bpm })), bucketMinutes) },
    { device: COLMI, points: bucketSeries(colmiRows.map(r => ({ timestamp: r.measuredAt, value: r.value })), bucketMinutes) },
  ]

  const rows = alignSeries(series)
  const truncated = rows.length > MAX_ROWS

  return NextResponse.json({
    metric: 'heart_rate',
    unit: 'bpm',
    range: { from: fromStr, to: toStr, timezone: tz },
    // Reported, because every `overlap` below is a function of it — a reader who does not know the
    // bucket width cannot tell a real disagreement from a grid that was too fine.
    bucketMinutes,
    devices: DEVICES,
    // Computed over the FULL set, then the table is truncated — so the statistics describe the
    // window asked for rather than whatever fitted in the response.
    coverage: coverage(rows, DEVICES),
    pairs: allPairSummaries(rows, DEVICES),
    rowCount: rows.length,
    truncated,
    rows: truncated ? rows.slice(0, MAX_ROWS) : rows,
  })
}
