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
import { alignSeries, allPairSummaries, coverage, bucketSeries, coarsestCadenceMinutes, type NamedSeries } from '@/lib/health/device-comparison'
import { normalizeDateParamIso, DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { formatInTimeZone } from 'date-fns-tz'

/** Device keys are stable strings the UI and any later report can key on. */
const OURA = 'oura_ring'
const STRAP = 'chest_strap'
const COLMI = 'colmi_ring'

/**
 * The width used only when the data cannot say — a series too short to have a cadence.
 *
 * **It used to be the width, full stop, and that was the bug.** The strap emits ~1 Hz while both
 * rings sample every 5 minutes at their finest, so a fixed grid finer than the coarsest device makes
 * pairs coincide by luck: `overlap: 0`, which reads as "they never agreed" and means "they were
 * never compared". The module has said *bucket to the coarsest cadence* since it was written;
 * `coarsestCadenceMinutes` is that sentence implemented, and this constant is now the fallback
 * rather than the policy.
 */
const DEFAULT_BUCKET_MINUTES = 5
const MAX_BUCKET_MINUTES = 60

/**
 * Which signal to compare. `heart_rate` is the original and stays the default.
 *
 * `stress` was the metric that exposed PS-15: Oura's buckets land at **:15 and :45** and the
 * Colmi's at **:00 and :30** — permanently fifteen minutes apart, so on the five-minute grid this
 * route used to hardcode, no pair could ever form and every summary read `overlap: 0`. That reads
 * as two devices that disagree and means two that were never compared. Measured over the eight
 * afternoon buckets of 2026-08-27, the same two series agree at **rho = 0.64** once the width is
 * taken from the data instead of a constant.
 *
 * Steps are deliberately absent: Oura writes a daily scalar and the Colmi an hourly series, so
 * comparing them means summing the Colmi side to a day — and **PS-16 says nothing should sum those
 * buckets until a counted walk settles whether they are cumulative**, because summing a cumulative
 * counter gives a number that is badly wrong and still looks plausible.
 */
const METRICS = ['heart_rate', 'stress'] as const
type Metric = (typeof METRICS)[number]

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

  const metricParam = params.get('metric') ?? 'heart_rate'
  if (!(METRICS as readonly string[]).includes(metricParam)) {
    return NextResponse.json({ error: `Unknown metric — one of ${METRICS.join(', ')}` }, { status: 400 })
  }
  const metric = metricParam as Metric

  const repo = await getRepository()

  // Raw samples first, at their own timestamps. The bucket width is chosen from them below rather
  // than before them, which is the whole of PS-15's first half.
  const raw: { device: string; unit: string; rows: { timestamp: Date; value: number }[] }[] =
    metric === 'heart_rate'
      ? await (async () => {
          const [oura, strap, colmi] = await Promise.all([
            // 'ble' is the Oura ring's own source tag on oura_heartrate; 'chest_strap' is the H10's.
            repo.getOuraHeartrateBySource(userId, 'ble', from, to),
            repo.getOuraHeartrateBySource(userId, 'chest_strap', from, to),
            repo.getColmiReadings(userId, ['heart_rate'], from, to),
          ])
          return [
            { device: OURA,  unit: 'bpm', rows: oura.map(r => ({ timestamp: r.timestamp, value: r.bpm })) },
            { device: STRAP, unit: 'bpm', rows: strap.map(r => ({ timestamp: r.timestamp, value: r.bpm })) },
            { device: COLMI, unit: 'bpm', rows: colmi.map(r => ({ timestamp: r.measuredAt, value: r.value })) },
          ]
        })()
      : await (async () => {
          const [oura, colmi] = await Promise.all([
            repo.getOuraDaytimeStressBuckets(userId, from, to),
            repo.getColmiReadings(userId, ['stress'], from, to),
          ])
          // Two different units, declared rather than assumed — which is what makes the summaries
          // below suppress a mean bias in mixed units and report rank agreement instead.
          return [
            { device: OURA,  unit: 'normalised_-1..1', rows: oura.map(r => ({ timestamp: r.bucketStart, value: r.level })) },
            { device: COLMI, unit: 'raw_0..100',       rows: colmi.map(r => ({ timestamp: r.measuredAt, value: r.value })) },
          ]
        })()

  const devices = raw.map(r => r.device)
  const units = Object.fromEntries(raw.map(r => [r.device, r.unit]))

  // Bucket ONCE at a nominal width purely to measure each device's cadence, then re-bucket at the
  // coarsest of them. Cheap (two passes over a bounded window) and it is the only way to pick a
  // width from the data rather than from a guess.
  const probe: NamedSeries[] = raw.map(r => ({
    device: r.device, unit: r.unit,
    points: bucketSeries(r.rows, 1),
  }))
  const derivedMinutes = coarsestCadenceMinutes(probe, DEFAULT_BUCKET_MINUTES)

  // An explicit `bucket` still wins — the caller may want a whole-day view — but the default is now
  // measured. `bucketSource` says which happened, because a reader who cannot tell them apart cannot
  // tell a real disagreement from a grid that was too fine.
  const bucketRaw = Number(params.get('bucket'))
  const explicit = params.get('bucket') != null && Number.isFinite(bucketRaw)
  const bucketMinutes = explicit
    ? Math.min(MAX_BUCKET_MINUTES, Math.max(1, Math.round(bucketRaw)))
    : Math.min(MAX_BUCKET_MINUTES, derivedMinutes)

  const series: NamedSeries[] = raw.map(r => ({
    device: r.device, unit: r.unit,
    points: bucketSeries(r.rows, bucketMinutes),
  }))

  const rows = alignSeries(series)
  const truncated = rows.length > MAX_ROWS

  return NextResponse.json({
    metric,
    units,
    range: { from: fromStr, to: toStr, timezone: tz },
    // Reported, because every `overlap` below is a function of it — a reader who does not know the
    // bucket width cannot tell a real disagreement from a grid that was too fine.
    bucketMinutes,
    bucketSource: explicit ? 'requested' : 'derived-from-cadence',
    derivedMinutes,
    devices,
    // Computed over the FULL set, then the table is truncated — so the statistics describe the
    // window asked for rather than whatever fitted in the response.
    coverage: coverage(rows, devices),
    pairs: allPairSummaries(rows, devices, units),
    rowCount: rows.length,
    truncated,
    rows: truncated ? rows.slice(0, MAX_ROWS) : rows,
  })
}
