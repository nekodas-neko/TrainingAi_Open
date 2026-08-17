'use client'

import { useEffect } from 'react'
import { useTransitionRouter } from "@/lib/view-transition";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ActivityTypeGrid } from '@/components/activity/activity-type-grid'
import { useActivityStore } from '@/lib/stores/activity-store'
import type { ActivityType } from '@trainingai/shared/types'

interface LogActivitySheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function LogActivitySheet({ open, onOpenChange }: LogActivitySheetProps) {
  const router = useTransitionRouter()
  const startActivity = useActivityStore(s => s.startActivity)

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

        <ActivityTypeGrid enabled={open} onSelect={selectType} />
      </SheetContent>
    </Sheet>
  )
}
