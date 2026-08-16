import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { z } from 'zod'
import { DEFAULT_TZ, todayInTz } from '@trainingai/shared/date-utils'
import { prescribeOverride, OVERRIDE_RATIONALE_PREFIX } from '@trainingai/shared/running/prescription'
import { targetsForRunType } from '@trainingai/shared/running/hr-targets'
import { weeklyZoneTargets } from '@trainingai/shared/running/zone-targets'
import { CARDIO_GOALS } from '@trainingai/shared/running/cardio-goals'
import type { GoalKind, Prescription, RunType } from '@trainingai/shared/running/types'
import { assembleInputs, resolveSnapshot } from '@trainingai/shared/running/assemble-plan-context'

// POST responses aren't browser-cached regardless, but explicit no-store keeps this consistent
// with GET /api/running-plan — see the comment there on why max-age is wrong for this data.
const NO_STORE = 'private, no-store'

// Manually pick today's run structure/duration instead of the framework's own pick — the
// running-screen equivalent of the workout screen's short/standard/long duration preset,
// extended to also let you swap the prescribed TYPE (skip intervals, run easy instead, etc).
const OverrideBody = z.object({
  runType: z.enum(['recovery', 'easy', 'long', 'tempo', 'interval']),
  durationMin: z.number().int().min(10).max(120),
})

const TYPE_LABEL: Record<RunType, string> = {
  recovery: 'a recovery run', easy: 'an easy run', long: 'a long run', tempo: 'a tempo run', interval: 'an interval session',
}

export async function POST(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`${userId}:running-plan`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const parsed = OverrideBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const repo = await getRepository()

  const plan = await repo.getActiveRunningPlan(userId)
  if (!plan) return NextResponse.json({ error: 'No active running plan' }, { status: 404 })

  const fitness = await resolveSnapshot(repo, userId, tz)
  const { ctx, gate } = await assembleInputs(repo, userId, tz, fitness, plan)

  const base: Prescription = {
    type: parsed.data.runType,
    durationMin: parsed.data.durationMin,
    // A manually-picked type has no framework-derived distance target (that only makes sense
    // for the framework's own long-run/push-session logic) — the user is choosing structure,
    // not a distance goal, for today.
    distanceKm: null,
    targets: targetsForRunType(parsed.data.runType, fitness),
    rationale: `${OVERRIDE_RATIONALE_PREFIX}${TYPE_LABEL[parsed.data.runType]} today.`,
    frameworkKey: plan.frameworkKey,
  }
  const { prescription, gateAction, gateReasons } = prescribeOverride(ctx, gate, base)

  const today = todayInTz(tz)
  const existing = (await repo.getPrescribedRuns(userId, today, today))[0]
  // Overriding always re-commits to running today — an earlier skip is superseded by picking
  // a different structure, so status resets to pending regardless of what it was.
  const run = await repo.upsertPrescribedRun(userId, {
    id: existing?.id ?? crypto.randomUUID(),
    planId: plan.id,
    date: today,
    runType: prescription.type,
    durationMin: prescription.durationMin,
    distanceKm: prescription.distanceKm,
    targetHrLow: prescription.targets.hrLowBpm,
    targetHrHigh: prescription.targets.hrHighBpm,
    targetZoneIds: prescription.targets.zoneIds,
    rationale: prescription.rationale,
    gateAction,
    status: 'pending',
    activityLogId: existing?.activityLogId ?? null,
  })

  const zoneTargets = weeklyZoneTargets(plan.frameworkKey, fitness.weeklyBaseMinutes)
  const goalMeta = CARDIO_GOALS[plan.goalKind as GoalKind] ?? null
  const goal = goalMeta ? { key: goalMeta.key, label: goalMeta.label, blurb: goalMeta.blurb } : null

  return NextResponse.json(
    { plan, prescription, gateAction, gateReasons, run, zoneTargets, goal, isPushSession: false },
    { headers: { 'Cache-Control': NO_STORE } },
  )
}
