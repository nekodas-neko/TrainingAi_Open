import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { fromZonedTime } from 'date-fns-tz'
import { DEFAULT_TZ, normalizeDateParamIso } from '@trainingai/shared/date-utils'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tz = session.user?.timezone ?? DEFAULT_TZ

  // Support two calling conventions:
  // 1. ?start=<ISO>&end=<ISO>  — caller already has UTC timestamps
  // 2. ?date=YYYY-MM-DD&startTime=HH:MM&endTime=HH:MM — server converts using session tz
  const dateParam = req.nextUrl.searchParams.get('date')
  const startTimeParam = req.nextUrl.searchParams.get('startTime')
  const endTimeParam = req.nextUrl.searchParams.get('endTime')

  let startDate: Date
  let endDate: Date

  if (dateParam && startTimeParam && endTimeParam) {
    // Q-130: this split the raw param straight into Number() — the exact
    // `RangeError: Invalid time value` shape the guard exists to prevent, and the only one of the
    // four flagged routes already doing arithmetic on an unvalidated value.
    const normalized = normalizeDateParamIso(dateParam)
    if (!normalized) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
    // Seconds optional: `activity_logs.start_time` is a Postgres `time`, which serialises as
    // `HH:MM:SS`, and the detail sheet passes it through untouched. A HH:MM-only regex therefore
    // 400'd *every* call from that sheet, so its HR chart never rendered — the same
    // schema/handler disagreement as the dash-vs-slash date rule, one field along. Seconds are
    // then dropped: the window already snaps to whole minutes (end takes :59 below).
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(startTimeParam) || !/^\d{2}:\d{2}(:\d{2})?$/.test(endTimeParam)) {
      return NextResponse.json({ error: 'Invalid startTime or endTime' }, { status: 400 })
    }
    const [y, mo, d] = normalized.split('-').map(Number)
    const [sh, sm] = startTimeParam.split(':').map(Number)
    const [eh, em] = endTimeParam.split(':').map(Number)
    startDate = fromZonedTime(new Date(y, mo - 1, d, sh, sm, 0), tz)
    endDate = fromZonedTime(new Date(y, mo - 1, d, eh, em, 59), tz)
  } else {
    const start = req.nextUrl.searchParams.get('start')
    const end = req.nextUrl.searchParams.get('end')
    if (!start || !end) return NextResponse.json({ error: 'Missing start or end' }, { status: 400 })
    startDate = new Date(start)
    endDate = new Date(end)
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return NextResponse.json({ error: 'Invalid date format' }, { status: 400 })
    }
  }

  const repo = await getRepository()
  // Local-only. This used to fall back to an on-demand Oura Cloud heartrate fetch when the window
  // was empty; the ring has been on our own BLE key since the 2026-07-07 re-key, so that call could
  // only ever 401. An empty window now means the BLE drain has not reached this span yet.
  const samples = await repo.getHrForWindow(session.user.id, startDate, endDate)

  if (!samples.length) return NextResponse.json({ avgHr: null, maxHr: null, readings: [] }, { headers: { 'Cache-Control': 'private, no-store' } })

  const avgHr = Math.round(samples.reduce((sum, s) => sum + s.bpm, 0) / samples.length)
  const maxHr = Math.max(...samples.map(s => s.bpm))
  const readings = samples.map(s => ({
    timestamp: s.timestamp instanceof Date ? s.timestamp.toISOString() : String(s.timestamp),
    bpm: s.bpm,
  }))

  return NextResponse.json({ avgHr, maxHr, readings }, { headers: { 'Cache-Control': 'private, no-store' } })
}
