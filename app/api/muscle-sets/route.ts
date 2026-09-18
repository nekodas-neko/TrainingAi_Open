import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { DEFAULT_TZ, normalizeDateParamIso, todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'

export interface MuscleSetsWindowEntry {
  muscle: string
  sets: number
}

export interface MuscleSetsWindowResponse {
  /** Echoed back in dash form, so a caller that sent slashes can key its cache on what it got. */
  from: string
  to: string
  muscles: MuscleSetsWindowEntry[]
}

/** The longest span this route will aggregate, in days. */
const MAX_WINDOW_DAYS = 400
/** Used when `from` is omitted — long enough for the 60-day balance view with room to widen. */
const DEFAULT_WINDOW_DAYS = 90

// BOTH separators, deliberately: the client's `localDateString()` emits `YYYY/MM/DD`, so a
// dash-only schema rejects every real request with a Zod error before the handler runs. The shape
// is all this can check — `normalizeDateParamIso` is what rejects 2026-02-31.
const DateParam = z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/)
const Query = z.object({ from: DateParam.optional(), to: DateParam.optional() }).strict()

/**
 * LB-111 — weighted sets per muscle over an arbitrary window.
 *
 * The engine half of OR-118's movement-balance card. Nothing served this before: every existing
 * muscle-set route computes the CURRENT week server-side and takes no params, and
 * `muscle-tonnage-trend` is windowed but returns tonnage, which is not a substitute — legs move far
 * heavier loads, so a tonnage share overstates them and would hide the very pull-set deficit the
 * card exists to show.
 *
 * **This counts across programme changes, and that is the decision this route exists to make.**
 * `getWeeklySetsByMuscleGroup` scopes to one `programId`, so a 60-day window spanning a programme
 * change would drop everything logged under the previous one. That is right for its callers, which
 * grade a week against *that* programme's targets, and wrong here: the card's claim is about the
 * lifter's training balance, not one programme's adherence. Hence a separate read rather than a
 * `from`/`to` on `weekly-muscle-sets`, whose other two fields — the per-muscle target and the
 * week's phase scale — are week-shaped and have no meaning over sixty days.
 */
export async function GET(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const parsed = Query.safeParse({
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid date parameter' }, { status: 400 })
  }

  const tz = session.user.timezone ?? DEFAULT_TZ
  const to = parsed.data.to ? normalizeDateParamIso(parsed.data.to) : todayInTz(tz)
  const from = parsed.data.from
    ? normalizeDateParamIso(parsed.data.from)
    : shiftDateStr(to ?? todayInTz(tz), -(DEFAULT_WINDOW_DAYS - 1))

  // A date-SHAPED string that is not a real day (2026-02-31) reaches the driver as [pg 22008] and
  // is recorded as a server fault, so it is rejected here as the client error it is.
  if (from === null || to === null) {
    return NextResponse.json({ error: 'Invalid date parameter' }, { status: 400 })
  }
  if (from > to) {
    return NextResponse.json({ error: 'from must not be after to' }, { status: 400 })
  }

  const spanDays = Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  ) + 1
  if (spanDays > MAX_WINDOW_DAYS) {
    return NextResponse.json(
      { error: `Window must be ${MAX_WINDOW_DAYS} days or fewer` },
      { status: 400 },
    )
  }

  const repo = await getRepositoryAsync()
  const totals = await repo.getSetsByMuscleInWindow(userId, from, to, tz)

  const muscles = Object.entries(totals)
    .map(([muscle, sets]) => ({ muscle, sets }))
    .sort((a, b) => b.sets - a.sets || a.muscle.localeCompare(b.muscle))

  return NextResponse.json(
    { from, to, muscles } satisfies MuscleSetsWindowResponse,
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
