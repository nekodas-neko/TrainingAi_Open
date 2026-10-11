import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { rateLimit } from '@/lib/rate-limit'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { backfillSetHrr1 } from '@/lib/workout/backfill-set-hrr1'

/**
 * Fill `set_hr_stats.hrr1_bpm` for stored rows and rewrite `rest_adequate` from it (#2457, step 1
 * of #2299 v2). Every stored row is re-measured from the merged HR series with the dense rule
 * (`deriveHrr60`); a row the series cannot serve gets null in BOTH columns. That is the purpose:
 * old ring verdicts and shortcut-era `true`s clear, which the COALESCE upsert could never do.
 *
 * **This rewrites existing values, so it is a production data change.** Policy
 * (docs/rules/git-safety-and-packages.md): a verified snapshot — taken AND restored — first, then a
 * dry run whose counts are the prediction, then the real run, whose `written` must equal that
 * prediction (the repo write is one transaction and rolls back on a count mismatch).
 *
 * #2601 and #2299 step 2 widen it: the stored drop curve (`drop_30s`…`drop_120s`) goes through the
 * same dense rule at each offset, and the verdict uses the person's bar (`personalHrr60Bar`) fitted
 * on the HRR60 of the 30 days before each session — measured in a first pass over every session, so
 * a row's bar never depends on the order sessions are visited.
 *
 * Admin-only, POST because it writes, `dryRun` unless `dryRun=false`. Scope: the caller's own rows,
 * full history. Reads `oura_heartrate` only; never touches the raw archive. Idempotent: a second
 * real run finds nothing to change. Rows older than the 180-day `oura_heartrate` retention have no
 * series left and therefore go to null — the dry run counts them under `noSeries`.
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
  if (!rateLimit(`${userId}:backfill-set-hrr1`, 4, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const raw = req.nextUrl.searchParams.get('dryRun')
  if (raw != null && raw !== 'true' && raw !== 'false') {
    return NextResponse.json({ error: '`dryRun` must be true or false' }, { status: 400 })
  }
  const dryRun = raw !== 'false'
  const tz = session.user?.timezone ?? DEFAULT_TZ

  const repo = await getRepositoryAsync()
  return NextResponse.json(await backfillSetHrr1({ repo, userId, tz, dryRun }), { headers: { 'Cache-Control': 'private, no-store' } })
}
