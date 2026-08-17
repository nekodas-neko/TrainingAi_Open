'use client'

import { useEffect, useState } from 'react'
import { cachedFetch, readCacheSync } from '@/lib/sqlite/cache'
import { TTL_LONG } from '@trainingai/shared/cache-ttl'
import { getActivityIcon } from '@trainingai/shared/constants/activity-icons'
import type { ActivityType } from '@trainingai/shared/types'

/**
 * The activity-type picker grid, shared by the Log Activity sheet and the `/activity` entry guard
 * (Q-450). Both hand the chosen type to `startActivity`, so extracting it is what stops the two
 * from drifting into different type lists.
 *
 * `enabled` exists for the sheet: it stays mounted while closed, and fetching a list nobody is
 * looking at on every parent render is the behaviour it already deliberately avoided.
 */
export function ActivityTypeGrid({
  enabled = true,
  onSelect,
}: {
  enabled?: boolean
  onSelect: (type: ActivityType) => void
}) {
  const [activityTypes, setActivityTypes] = useState<ActivityType[]>([])

  useEffect(() => {
    if (!enabled) return
    const seeded = readCacheSync<{ activityTypes: ActivityType[] }>('activity-types')
    if (seeded?.activityTypes) setActivityTypes(seeded.activityTypes)
    cachedFetch<{ activityTypes: ActivityType[] }>(
      'activity-types', '/api/activity-types', TTL_LONG,
      d => setActivityTypes(d?.activityTypes ?? []),
      { freshWithinTtl: true },
    ).catch(() => {})
  }, [enabled])

  return (
    <div className="grid grid-cols-5 gap-2 pb-4">
      {activityTypes.map(type => {
        const Icon = getActivityIcon(type.icon)
        return (
          <button
            key={type.id}
            type="button"
            onClick={() => onSelect(type)}
            className="flex flex-col items-center gap-1 rounded-xl border py-2.5 transition-all active:scale-95"
          >
            <Icon size={22} weight="regular" />
            <span className="text-[9px] font-medium leading-tight text-center">{type.label}</span>
          </button>
        )
      })}
    </div>
  )
}
