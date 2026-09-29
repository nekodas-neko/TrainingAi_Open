'use client'

import { getLocalStore } from '@/lib/local-store'
import { invalidateRunningPlan } from '@/lib/cache-groups'
import { todayInTz } from '@trainingai/shared/date-utils'

/**
 * Mark today's prescribed run done by the activity that satisfied it.
 *
 * Extracted from `done-activity-screen.tsx` for RV-166: a walk can satisfy a prescription now, and
 * the guided walk saves through its own screen, so two callers must agree on the payload. A second
 * copy is a walk that completes the day on one path and not the other.
 *
 * `completedAs` is not optional on purpose. The server writes null on any status change that does
 * not say otherwise (`adapter.ts` updatePrescribedRun), and `completedAsRun()` reads null as a run —
 * so a walk that forgets the field switches off the next quality session and puts walking pace into
 * easy-run stats (LB-179).
 *
 * Fire-and-forget: a failed link must never block the "Activity saved" toast the user is already
 * seeing — the run just stays 'pending' and can still be marked via Skip/Complete.
 */
export async function linkPrescribedRun(
  userId: string | undefined,
  prescribedRunId: string,
  activityLogId: string,
  tz: string,
  completedAs: 'run' | 'walk',
): Promise<void> {
  const store = userId ? getLocalStore(userId) : null
  if (store) {
    const today = todayInTz(tz)
    const runs = await store.getPrescribedRuns(today)
    const existing = runs.find((r) => r.id === prescribedRunId)
    if (existing) {
      await store.upsertPrescribedRun({
        ...existing,
        status: 'completed',
        activityLogId,
        completedAs,
        updatedAt: new Date().toISOString(),
        syncStatus: 'pending',
      })
    }
    await store.queueMutation({
      userId: userId!,
      domain: 'prescribed_run',
      date: today,
      payload: { id: prescribedRunId, status: 'completed', activityLogId, completedAs },
    })
    await invalidateRunningPlan()
    return
  }
  await fetch(`/api/running-plan/runs/${prescribedRunId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'completed', activityLogId, completedAs }),
  }).catch(() => {})
  await invalidateRunningPlan()
}

/** What an activity type satisfied the prescription as. Only run counts as a run (LB-179). */
export function completedAsFor(activityType: string | null): 'run' | 'walk' {
  return activityType === 'run' ? 'run' : 'walk'
}
