'use client'

import { useActivityStore } from '@/lib/stores/activity-store'
import { PreActivityScreen } from './pre-activity-screen'
import { ActiveActivityScreen } from './active-activity-screen'
import { RunActiveScreen } from './run-active-screen'
import { DoneActivityScreen } from './done-activity-screen'

export function ActivityScreen({ userId }: { userId?: string }) {
  const mode = useActivityStore(s => s.mode)
  const activityType = useActivityStore(s => s.activityType)

  if (mode === 'active') return activityType === 'run' ? <RunActiveScreen /> : <ActiveActivityScreen />
  if (mode === 'done') return <DoneActivityScreen userId={userId} />
  return <PreActivityScreen />
}
