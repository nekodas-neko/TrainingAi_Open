"use client"

import { MoreSubScreen } from '@/components/more/sub-screen'
import AiUsageTab from '@/components/admin/ai-usage-tab'

export function DevToolContent() {
  return (
    <MoreSubScreen title="AI usage">
      <AiUsageTab />
    </MoreSubScreen>
  )
}
