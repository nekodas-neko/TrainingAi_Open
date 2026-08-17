'use client'

import { useActivityStore } from '@/lib/stores/activity-store'
import { PreActivityScreen } from './pre-activity-screen'
import { ActiveActivityScreen } from './active-activity-screen'
import { RunActiveScreen } from './run-active-screen'
import { DoneActivityScreen } from './done-activity-screen'
import { SelectActivityTypeScreen } from './select-activity-type-screen'

export function ActivityScreen({ userId }: { userId?: string }) {
  const mode = useActivityStore(s => s.mode)
  const activityType = useActivityStore(s => s.activityType)

  if (mode === 'active') return activityType === 'run' ? <RunActiveScreen /> : <ActiveActivityScreen />
  if (mode === 'done') return <DoneActivityScreen userId={userId} />
  // A typeless store is where this sits between activities, and the Pre screen it used to fall
  // through to could record an activity that Save then silently discarded (Q-450). The guard is
  // only on 'pre' deliberately — an in-flight session with a missing type must keep its own screen
  // rather than be thrown back to a picker that would drop it.
  if (!activityType) return <SelectActivityTypeScreen />
  return <PreActivityScreen />
}
