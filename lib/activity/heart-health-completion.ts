'use client'

import { useEffect, useRef } from 'react'
import { heartHealthRescore, type HeartHealthActivity } from '@trainingai/shared/running/heart-health'
import { linkPrescribedRun } from './link-prescribed-run'

/** The slice of a measured day (`HeartHealthDay` on the running-plan payload) this needs. */
export interface MeasuredDay {
  date: string
  runId: string
  status: string
  targetMin: number | null
  countedMin: number
  met: boolean
  creditedId: string | null
  activities: HeartHealthActivity[]
}

/** The completions a measured week owes: each pending day that met the rule, through the same
 *  `heartHealthRescore` the admin back-fill uses, so the device and the server cannot disagree. */
export function completionsDue(days: readonly MeasuredDay[]): { date: string; runId: string; activityLogId: string; completedAs: 'run' | 'walk' }[] {
  const out: { date: string; runId: string; activityLogId: string; completedAs: 'run' | 'walk' }[] = []
  for (const d of days) {
    const credited = d.activities.find((a) => a.id === d.creditedId) ?? null
    const r = heartHealthRescore({ status: d.status }, { targetMin: d.targetMin, countedMin: d.countedMin, met: d.met, credited })
    if (r.action === 'complete') out.push({ date: d.date, runId: d.runId, activityLogId: r.activityLogId, completedAs: r.completedAs })
  }
  return out
}

/**
 * Issue 2093. Records a completion once a day's measured moderate-effort minutes meet the rule — any
 * activity, however it was started. Written through the local store and the outbox like every
 * other device write (`linkPrescribedRun`); each row is asked once per mount, and a failed write
 * is asked again on the next payload.
 */
export function useHeartHealthCompletion(userId: string | undefined, days: readonly MeasuredDay[] | undefined): void {
  const asked = useRef(new Set<string>())
  useEffect(() => {
    if (!days) return
    for (const c of completionsDue(days)) {
      if (asked.current.has(c.runId)) continue
      asked.current.add(c.runId)
      linkPrescribedRun(userId, c.runId, c.activityLogId, c.date, c.completedAs)
        .catch(() => { asked.current.delete(c.runId) })
    }
  }, [userId, days])
}
