'use client'

import { useEffect, useState } from 'react'
import { useTransitionRouter } from "@/lib/view-transition";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cachedFetch, readCacheSync } from '@/lib/sqlite/cache'
import { TTL_LONG } from '@trainingai/shared/cache-ttl'
import { getActivityIcon } from '@trainingai/shared/constants/activity-icons'
import { useActivityStore } from '@/lib/stores/activity-store'
import type { ActivityType } from '@trainingai/shared/types'

interface LogActivitySheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function LogActivitySheet({ open, onOpenChange }: LogActivitySheetProps) {
  const [activityTypes, setActivityTypes] = useState<ActivityType[]>([])
  const router = useTransitionRouter()
  const startActivity = useActivityStore(s => s.startActivity)

  useEffect(() => {
    if (!open) return
    const seeded = readCacheSync<{ activityTypes: ActivityType[] }>('activity-types')
    if (seeded?.activityTypes) setActivityTypes(seeded.activityTypes)
    cachedFetch<{ activityTypes: ActivityType[] }>(
      'activity-types', '/api/activity-types', TTL_LONG,
      d => setActivityTypes(d?.activityTypes ?? []),
      { freshWithinTtl: true },
    ).catch(() => {})
  }, [open])

  // The only exit from this sheet is /activity, and it only mounts on open — so the warm
  // is both timely and never speculative. Button pushes get no automatic prefetch the way
  // <Link> does (#919).
  useEffect(() => {
    if (!open) return
    router.prefetch('/activity')
  }, [open, router])

  function selectType(type: ActivityType) {
    startActivity(type.id, type.label, type.icon, type.isDistanceBased)
    onOpenChange(false)
    router.push('/activity')
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="px-5">
        <SheetHeader className="mb-2">
          <SheetTitle className="text-left">Log Activity</SheetTitle>
        </SheetHeader>

        <div className="grid grid-cols-5 gap-2 pb-4">
          {activityTypes.map(type => {
            const Icon = getActivityIcon(type.icon)
            return (
              <button
                key={type.id}
                type="button"
                onClick={() => selectType(type)}
                className="flex flex-col items-center gap-1 rounded-xl border py-2.5 transition-all active:scale-95"
              >
                <Icon size={22} weight="regular" />
                <span className="text-[9px] font-medium leading-tight text-center">{type.label}</span>
              </button>
            )
          })}
        </div>
      </SheetContent>
    </Sheet>
  )
}
