import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { requireAdmin, adminFailureOutcome } from '@/lib/admin'
import { rateLimit } from '@/lib/rate-limit'
import { safeCompare } from '@/lib/security/constant-time'
import { DEFAULT_TZ, todayInTz, normalizeDateParamIso, shiftDateStr, daysBetweenDateStrs } from '@trainingai/shared/date-utils'
import { buildDayAudit } from '@trainingai/shared/health/score-audit/build-day-audit'
import type { DayAudit } from '@trainingai/shared/health/score-audit/types'
import { reportServerError } from '@/lib/observability'
import { clientIp } from '@trainingai/shared/http/client-ip'

/**
 * Admin day-review: everything that fed each scored pillar on a day, in one payload — the raw
 * signals, the model constants behind them, each contributor's sub-score and the points it
 * contributed, what was missing, and the value persisted at the time.
 *
 * Read-only, GET-only. Two ways in:
 *  1. An admin session cookie (the in-app Admin → Day Review tab).
 *  2. `Authorization: Bearer <ADMIN_EXPORT_SECRET>` — for pulling a window of days out to review
 *     score calibration offline, where no browser session exists. Disabled entirely unless BOTH
 *     `ADMIN_EXPORT_SECRET` and `ADMIN_EXPORT_USER_ID` (or `WEBHOOK_USER_ID`) are set, and the
 *     resolved user must still be an admin — the token widens *transport*, never authority.
 */

/** Hard ceiling on a single range request — bounds both the response size and the query fan-out. */
const MAX_RANGE_DAYS = 31

type AuthOutcome =
  | { ok: true; userId: string; tz: string; via: 'session' | 'token' }
  | { ok: false; status: number; error: string }

async function authorize(req: NextRequest): Promise<AuthOutcome> {
  const bearer = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]

  if (bearer) {
    // Rate-limit every attempt per IP BEFORE the compare, so a token brute-force can't run at
    // unbounded throughput, and return the same 401 either way so a trip is indistinguishable
    // from a bad token.
    const ip = clientIp(req)
    if (!rateLimit(`day-review-token:${ip}`, 20, 60_000)) {
      return { ok: false, status: 401, error: 'Unauthorized' }
    }

    // Fail closed: an unset secret disables the token path, it never skips the check.
    const expected = process.env.ADMIN_EXPORT_SECRET
    const exportUserId = process.env.ADMIN_EXPORT_USER_ID ?? process.env.WEBHOOK_USER_ID
    if (!expected || !exportUserId || !safeCompare(bearer, expected)) {
      return { ok: false, status: 401, error: 'Unauthorized' }
    }

    // The token identifies a caller, not a role — the user it resolves to must be an admin,
    // exactly as the session path requires.
    try {
      await requireAdmin(exportUserId)
    } catch (err) {
      return adminFailureOutcome(err)
    }

    const repo = await getRepository()
    const user = await repo.getUserById(exportUserId)
    return { ok: true, userId: exportUserId, tz: user?.timezone ?? DEFAULT_TZ, via: 'token' }
  }

  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return { ok: false, status: 401, error: 'Unauthorized' }
  try {
    await requireAdmin(userId, session.user?.isAdmin)
  } catch (err) {
    return adminFailureOutcome(err)
  }
  return { ok: true, userId, tz: session.user?.timezone ?? DEFAULT_TZ, via: 'session' }
}

export async function GET(req: NextRequest) {
  const authed = await authorize(req)
  if (!authed.ok) return NextResponse.json({ error: authed.error }, { status: authed.status })
  const { userId, tz } = authed

  if (!rateLimit(`${userId}:admin-day-review`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  // ISO/dash form, not normalizeDateParam's slash form: the assembler does dash-based arithmetic
  // (shiftDateStr, dash-keyed DB rows, `${date}T00:00:00`). Accepts either separator on the way in.
  const q = req.nextUrl.searchParams
  const parse = (raw: string | null) => (raw ? normalizeDateParamIso(raw) : null)

  const single = parse(q.get('date'))
  const from = parse(q.get('from'))
  const to = parse(q.get('to'))

  if ((q.get('date') && !single) || (q.get('from') && !from) || (q.get('to') && !to)) {
    return NextResponse.json({ error: 'Invalid date — expected YYYY-MM-DD or YYYY/MM/DD' }, { status: 400 })
  }

  const start = from ?? single ?? todayInTz(tz)
  const end = to ?? single ?? todayInTz(tz)
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

    // Sequential on purpose: each day runs ~12 queries, and the pg pool is max:10 — fanning a
    // 31-day range out concurrently would starve the rest of the app (the failure mode that took
    // production down in session 165). A range is an offline review, latency is not the concern.
    // Q-497: indexed over the already-validated `span`, NOT `d <= end`. That comparison is on
    // STRINGS, and `shiftDateStr` emits an unpadded year — so one day after `9999-12-31` is
    // `10000-01-01`, and `'10000-01-01' <= '9999-12-31'` is **true** because `'1' < '9'`. Every
    // guard passes on the way in for `from=9999-12-01&to=9999-12-31` (the span is exactly 31), and
    // the loop then runs ~29M iterations of ~12 queries each against a `max: 10` pool.
    //
    // Padding the year does not fix it — `padStart(4, '0')` is a no-op on a five-digit year, which
    // is why this iterates by count instead. `span` comes from `daysBetweenDateStrs`, which is
    // millisecond arithmetic and correct at any year, and it is already bounded by MAX_RANGE_DAYS
    // above. No string ordering is involved at all now, so the whole class is gone rather than
    // bounded.
    const days: DayAudit[] = []
    for (let i = 0; i < span; i++) {
      days.push(await buildDayAudit({ repo, userId, date: shiftDateStr(start, i), tz }))
    }

    if (span === 1) return NextResponse.json(days[0])

    // Range responses hoist the model constants to the top level — they are identical on every
    // day, and repeating every curve 31 times is most of the payload.
    const models = Object.fromEntries(days[0].pillars.map(p => [p.pillar, p.model]))
    return NextResponse.json({
      from: start,
      to: end,
      timezone: tz,
      generatedAt: new Date().toISOString(),
      models,
      days: days.map(day => ({
        ...day,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured to drop `model`
        pillars: day.pillars.map(({ model, ...rest }) => rest),
      })),
    })
  } catch (err) {
    reportServerError(err, { userId, url: '/api/admin/day-review' })
    console.error('[admin/day-review] failed:', err)
    return NextResponse.json(
      { error: 'Failed to assemble the day audit', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
