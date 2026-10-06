'use client'

import { memo, useEffect, useState } from 'react'
import { TriangleAlertIcon } from 'lucide-react'
import { TTL_MEDIUM } from '@trainingai/shared/cache-ttl'
import { todayInTz } from '@trainingai/shared/date-utils'
import type { Injury } from '@trainingai/shared/types/injury'
import { activeInjuries, describeInjury } from '@trainingai/shared/workout/injury-context'
import { useCachedValue } from '@/lib/hooks/use-cached-value'
import { getLocalStore } from '@/lib/local-store/index'
import { useUserTimezone } from '@/components/shell/user-timezone-provider'

/**
 * #2415 — the generator drops exercises for an active injury and nothing in the wizard said so.
 *
 * `/api/generate-program` and `/api/builder-chat` filter the candidate list with
 * `excludeInjuredExercises`, so a movement the owner expected is simply absent and logging an
 * injury looks like it does nothing. This names what the builder is avoiding, in the words
 * `formatInjuryContext` hands the model (`describeInjury` is that wording for a person), and links
 * to where the injury is managed.
 *
 * Reads the way the rest of the app reads injuries: the shared `injuries` cache key first (seeded
 * synchronously, so a repeat visit never flashes), then the on-device store, which is the source of
 * truth and holds an injury logged offline that has not synced yet. No new fetch — `useCachedValue`
 * shares the Health tab's key, URL and TTL, and a write there invalidates it.
 *
 * Renders nothing when nothing is active: an empty notice explaining itself is furniture.
 */
export const InjuryAvoidanceNotice = memo(function InjuryAvoidanceNotice({
  userId, onOpenHealth,
}: {
  userId?: string
  onOpenHealth: () => void
}) {
  const tz = useUserTimezone()
  const served = useCachedValue<Injury[]>('injuries', '/api/injuries', TTL_MEDIUM, { onError: () => {} })
  const [local, setLocal] = useState<Injury[] | null>(null)

  useEffect(() => {
    const store = userId ? getLocalStore(userId) : null
    if (!store) return
    let cancelled = false
    store.getInjuries().then(rows => {
      // Same rule as Health and the workout screen: the store wins once it has rows.
      if (cancelled || rows.length === 0) return
      setLocal(rows.map(r => ({
        id: r.id, userId: userId!, muscleName: r.muscleName, notes: r.notes,
        severity: r.severity, startedDate: r.startedDate,
        resolvedDate: r.resolvedDate, createdAt: r.createdAt, updatedAt: r.updatedAt,
      })))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [userId])

  const source = local ?? (Array.isArray(served) ? served : [])
  const active = activeInjuries(source)
  if (active.length === 0) return null

  const today = todayInTz(tz)
  return (
    <div role="note" className="rounded-xl bg-muted px-3 py-2.5 space-y-1">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <TriangleAlertIcon className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
        Avoiding exercises that load your injured {active.length === 1 ? 'muscle' : 'muscles'}
      </p>
      <ul className="space-y-0.5">
        {active.map(i => (
          <li key={i.id} className="text-xs text-muted-foreground">
            {describeInjury(i, today)}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onOpenHealth}
        className="tap-dense tap-target-44 text-xs font-semibold text-brand"
      >
        Manage in Health → Injuries
      </button>
    </div>
  )
})
