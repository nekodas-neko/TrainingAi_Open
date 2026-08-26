import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { z } from 'zod'

// BF-19 — app-load readout: p50/p95 per route over N days, split cold vs warm.
//
// **Not named `timing-*`.** `admin/timing-baseline` and `admin/time-audit` already exist and are
// about WORKOUT duration; a third `timing-` route would be read as a sibling of those and it is
// not related to them at all.
//
// **The cold/warm split is the report, not a facet of it.** Every merge is a Railway deploy and the
// service worker's cache name is stamped from the deploy SHA, so the device's offline shell is
// invalidated once per deploy — 80 times on one measured day. A percentile pooling both measures
// release cadence rather than the app, which is worse than no number because it looks like an
// answer.
const QuerySchema = z.object({
  // 14 is the retention window, so a longer request cannot return more data than exists.
  days: z.coerce.number().int().min(1).max(14).default(7),
}).strict()

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }

  if (!rateLimit(`admin-app-load:${session.user.id}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { searchParams } = new URL(req.url)
  const q = QuerySchema.safeParse({ days: searchParams.get('days') ?? undefined })
  if (!q.success) return NextResponse.json({ error: 'Invalid query' }, { status: 400 })

  const repo = await getRepository()
  const rows = await repo.getAppLoadReport(session.user.id, q.data.days)

  return NextResponse.json({
    days: q.data.days,
    // Stated rather than left to be inferred: a reader seeing only warm rows should know whether
    // that means the app is warm or that nothing cold was recorded.
    coldSamples: rows.filter(r => r.cold).reduce((n, r) => n + r.samples, 0),
    warmSamples: rows.filter(r => !r.cold).reduce((n, r) => n + r.samples, 0),
    routes: rows,
  }, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
