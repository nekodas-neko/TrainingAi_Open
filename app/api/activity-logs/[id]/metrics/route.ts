import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { activityImplausibleReason } from '@trainingai/shared/validation/plausibility'
import { z } from 'zod'
import { invalidUuidResponse } from '@/lib/api/route-errors'

// Health-Connect backfill for logs saved without HR/distance/calories (lib/health-connect-sync.ts
// enrichActivityLogs). The underlying UPDATE COALESCEs, so this can only ever FILL a null — but it
// had no maxima at all, which meant the one field it does get to set could be set to anything.
// Bounds mirror the sync-health exercise-session schema, the other Health-Connect entry point.
// `distanceKm` is nonnegative, not positive: a GPS activity with two or more points that never
// moved computes exactly 0, which `omitNullFields` does not strip. `.positive()` rejected the
// WHOLE payload for it — the same one-bad-field-kills-everything class as Q-36 (Q-41 finding 3).
// Calories keep `.positive()`: a zero there means "not measured", and the UPDATE only fills nulls.
const MetricsBody = z.object({
  distanceKm:     z.number().nonnegative().max(500).optional(),
  caloriesBurned: z.number().positive().max(20_000).optional(),
  avgHr:          z.number().int().positive().max(300).optional(),
  maxHr:          z.number().int().positive().max(300).optional(),
})

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id

  if (!rateLimit(`activity-metrics:${userId}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const body = MetricsBody.safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const { id } = await params
  const badId = invalidUuidResponse(id)
  if (badId) return badId

  const repo = await getRepository()
  const existing = await repo.getActivityLogById(userId, id)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // The rate checks need a duration, and the patch never carries one — it lives on the row being
  // enriched. Checking the patch against the row is the only way a 30-minute walk can reject the
  // 420 km someone tries to fill into it; the field bounds above can't express that.
  const reason = activityImplausibleReason({
    durationMin: existing.durationMin,
    steps: existing.steps,
    distanceKm:     body.data.distanceKm     ?? existing.distanceKm,
    caloriesBurned: body.data.caloriesBurned ?? existing.caloriesBurned,
    avgHr:          body.data.avgHr          ?? existing.avgHr,
    maxHr:          body.data.maxHr          ?? existing.maxHr,
  })
  if (reason) return NextResponse.json({ error: `Implausible activity: ${reason}` }, { status: 400 })

  await repo.updateActivityLogMetrics(userId, id, body.data)
  return NextResponse.json({ ok: true })
}
