import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { rateLimit } from '@/lib/rate-limit'
import { reportServerError } from '@/lib/observability'
import { buildReadinessPayload } from '@/lib/health/readiness-payload'

// The payload type is re-exported because ten call sites already import it from this route path.
// It is defined in the shared module alongside the builder. Deliberately not enumerated here — the
// list this replaced named four sites, claimed there were five, and one of the four
// (`readiness-card.tsx`) had since been deleted.
export type { ReadinessScoreResponse } from '@/lib/health/readiness-payload'

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`${userId}:readiness-score`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  try {
    const payload = await buildReadinessPayload(userId, session.user?.timezone ?? DEFAULT_TZ)
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "private, no-store" },
    })
  } catch (err) {
    // Same silent 500 as /api/body-battery on 2026-08-03 — see the note there.
    reportServerError(err, { userId, url: '/api/readiness-score' })
    return NextResponse.json({ error: 'Readiness score unavailable' }, { status: 500 })
  }
}
