"use client"

import { MoreSubScreen } from '@/components/more/sub-screen'
import DayReviewTab from '@/components/admin/day-review-tab'

export function DevToolContent() {
  return (
    <MoreSubScreen title="Day review">
      <DayReviewTab />
    </MoreSubScreen>
  )
}
