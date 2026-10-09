'use client'

import { getLocalStore } from '@/lib/local-store'
import { invalidateRunningPlan } from '@/lib/cache-groups'
import { completedAsForActivity } from '@trainingai/shared/running/heart-health'

/**
 * Mark a day's heart-health activity (the `prescribed_runs` row) done by the activity credited
 * with it.
 *
 * Issue 2093: the ONE client writer of a completion (the admin back-fill re-scores history server-side through the same rule). Saving an activity no longer completes anything by
 * itself — whether a day counted is measured from its zone 2+ minutes (`heartHealthVerdict`), and
 * `useHeartHealthCompletion` calls this once a measured day meets the rule, whatever the activity
 * was and however it was started. Before this, only an activity started from the prescription could
 * complete it (RV-166), which is why a walk logged any other way never did.
 *
 * `completedAs` is not optional on purpose. The server writes null on any status change that does
 * not say otherwise (`adapter.ts` updatePrescribedRun), and `completedAsRun()` reads null as a run —
 * so a walk that forgets the field switches off the next quality session and puts walking pace into
 * easy-run stats (LB-179).
 *
 * Fire-and-forget: a failed link leaves the row 'pending', and the next read of the measured day
 * asks again.
 */
export async function linkPrescribedRun(
  userId: string | undefined,
  prescribedRunId: string,
  activityLogId: string,
  /** The row's own local date — a past day of this week can be the one completing. */
  date: string,
  completedAs: 'run' | 'walk',
): Promise<void> {
  const store = userId ? getLocalStore(userId) : null
  if (store) {
    const runs = await store.getPrescribedRuns(date)
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
      date,
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

/** What an activity type satisfied the prescription as. Only run counts as a run (LB-179). The rule
 *  lives in shared, beside the rest of the heart-health rule; this name is kept for its callers. */
export const completedAsFor = completedAsForActivity
