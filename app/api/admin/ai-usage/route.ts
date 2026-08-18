import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { z } from 'zod'

// Admin AI-usage observability readout — aggregates ai_call_log (calls by section,
// tokens, latency, and double-trip detection). Read-only; mirrors the admin
// db-stats route shape (auth → requireAdmin → rateLimit → repo → SWR JSON).
const QuerySchema = z.object({
  sinceHours: z.coerce.number().int().min(1).max(24 * 90).default(168),
  windowSeconds: z.coerce.number().int().min(1).max(3600).default(120),
  bucketHours: z.coerce.number().int().min(1).max(24).default(6),
})

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }

  if (!rateLimit(`admin-ai-usage:${session.user.id}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { searchParams } = new URL(req.url)
  const q = QuerySchema.safeParse({
    sinceHours: searchParams.get('sinceHours') ?? undefined,
    windowSeconds: searchParams.get('windowSeconds') ?? undefined,
    bucketHours: searchParams.get('bucketHours') ?? undefined,
  })
  if (!q.success) return NextResponse.json({ error: 'Invalid query' }, { status: 400 })

  const repo = await getRepository()
  const summary = await repo.getAiCallUsageSummary(q.data.sinceHours, q.data.windowSeconds, q.data.bucketHours)

  return NextResponse.json(summary, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
