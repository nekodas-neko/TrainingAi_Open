import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { rateLimit } from '@/lib/rate-limit'
import { DEFAULT_TZ, normalizeDateParamIso } from '@trainingai/shared/date-utils'
import { rederiveBodyBattery } from '@/lib/health/rederive-body-battery'

/**
 * Re-derive stored Body Battery days under the current model (TN-72, owner-approved 2026-09-27).
 * The work is `rederiveBodyBattery` (`lib/health/rederive-body-battery.ts`), shared with the agent
 * key (issue 2381); this route is the admin-session door to it.
 *
 * Admin-only, POST because it writes, `dryRun` unless `dryRun=false`, at most 31 days per call.
 */
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

  const repo = await getRepository()
  const result = await rederiveBodyBattery({ repo, userId, tz, from, to, dryRun })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json(result.report)
}
