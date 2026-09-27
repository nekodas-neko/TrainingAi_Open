'use client'

import { useEffect } from 'react'
import { useTransitionRouter } from "@/lib/view-transition";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ActivityTypeGrid } from '@/components/activity/activity-type-grid'
import { useActivityStore } from '@/lib/stores/activity-store'
import { releaseTopSurfaceEntry } from '@/lib/hooks/sheet-back-stack'
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

  // BF-165 — the owner's *"when I try click the treadmill; or any Other activity nothing actually
  // happens"*. The push always happened and was then undone: this sheet's own history entry was popped
  // by its close **7 ms after** the navigation on the S25, so `/cardio` came straight back, scrolled
  // to the top because its scroller is a nested div no restoration covers. See
  // `releaseTopSurfaceEntry` for the three cheaper fixes that were built and failed.
  function selectType(type: ActivityType) {
    startActivity(type.id, type.label, type.icon, type.isDistanceBased)
    // Before `onOpenChange`, and before the navigation: the release has to happen while this sheet is
    // still the top of the stack, and the close is what would otherwise pop it.
    const tookSheetEntry = releaseTopSurfaceEntry()
    onOpenChange(false)
    // `replace` when the entry was ours, because the current entry IS that sheet entry and the
    // navigation should overwrite it. A `push` here would leave a dead entry at `/cardio` underneath
    // `/activity`, so backing out of the activity screen would take two presses with the first one
    // visibly doing nothing.
    if (tookSheetEntry) router.replace('/activity')
    else router.push('/activity')
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
