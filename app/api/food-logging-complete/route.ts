import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { z } from 'zod'
import { rateLimit } from '@/lib/rate-limit'
import { DEFAULT_TZ, todayInTz } from '@trainingai/shared/date-utils'

/**
 * Q-387 — "I have finished logging today", and its Undo.
 *
 * The maintenance calibration averages the intake of every logged day, and a day abandoned after
 * lunch is byte-for-byte identical to a completed light day. Measured: 14 days at a true 2,600
 * maintenance with six stopping at 1,400 estimated **2,086** — 514 kcal low, `confidence: 'medium'`,
 * nothing flagged. It reaches `targetFromMaintenance`, so the error lands on the recommended daily
 * target with a cut's deficit on top.
 *
 * `complete: false` is the Undo the owner asked for. A day marked by accident has to be reversible,
 * because the whole point is that a wrong day poisons the estimate.
 */
// Both separators: the client's `localDateString()` emits YYYY/MM/DD, and a dash-only regex would
// reject every such request with a Zod error before the handler runs.
const Body = z.object({
  date: z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/).optional(),
  complete: z.boolean(),
}).strict()

export async function POST(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`food-logging-complete:${userId}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const tz = session.user.timezone ?? DEFAULT_TZ
  const logDate = parsed.data.date?.replace(/\//g, '-') ?? todayInTz(tz)

  const repo = await getRepository()
  // Preserve whatever the evening check-in holds — this write is only about the food-log flag, and
  // `saveDayCheckin` overwrites every column it is given a value for.
  const existing = await repo.getDayCheckin(userId, logDate, 'evening')
  const saved = await repo.saveDayCheckin(userId, {
    logDate,
    phase: 'evening',
    physicalTiredness: existing?.physicalTiredness ?? null,
    mentalDrain:       existing?.mentalDrain ?? null,
    barelyMoved:       existing?.barelyMoved ?? null,
    hydration:         existing?.hydration ?? null,
    lateHeavyMeal:     existing?.lateHeavyMeal ?? null,
    wakeMood:          existing?.wakeMood ?? null,
    perceivedRecovery: existing?.perceivedRecovery ?? null,
    motivation:        existing?.motivation ?? null,
    sleepQualityFeel:  existing?.sleepQualityFeel ?? null,
    restingSoreness:   existing?.restingSoreness ?? null,
    illnessContext:    existing?.illnessContext ?? null,
    perceivedRecoveryTouched: existing?.perceivedRecoveryTouched ?? false,
    sleepQualityFeelTouched:  existing?.sleepQualityFeelTouched ?? false,
    soreMuscles:       existing?.soreMuscles ?? [],
    journal:           existing?.journal ?? null,
    foodLoggingCompletedAt: parsed.data.complete ? new Date() : null,
  })

  return NextResponse.json({
    date: logDate,
    complete: saved.foodLoggingCompletedAt != null,
    completedAt: saved.foodLoggingCompletedAt,
  })
}
