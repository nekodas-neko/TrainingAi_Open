'use client'
import { useEffect, useState } from 'react'
import { useGuidedWalkStore } from '@/lib/stores/guided-walk-store'
import { WalkConfig } from './walk-config'
import { WalkActive, type WalkHrSample } from './walk-active'
import type { CadenceSummary } from '@trainingai/shared/health/cadence'
import { WalkSummary } from './walk-summary'

interface UserProfile { age: number | null; restingHr: number; hrMax: number }

export function GuidedWalkContent({ userId, profile }: { userId?: string; profile: UserProfile }) {
  const mode = useGuidedWalkStore(s => s.mode)
  const config = useGuidedWalkStore(s => s.config)
  const startedAtMs = useGuidedWalkStore(s => s.startedAtMs)
  const start = useGuidedWalkStore(s => s.start)
  const finish = useGuidedWalkStore(s => s.finish)
  const reset = useGuidedWalkStore(s => s.reset)
  const [samples, setSamples] = useState<WalkHrSample[]>([])
  const [cadence, setCadence] = useState<CadenceSummary | null>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, []) // avoid persisted-store hydration mismatch

  if (!mounted) return null

  if (mode === 'active' && startedAtMs != null) {
    return <WalkActive userProfile={profile} onFinish={(s, c) => { setSamples(s); setCadence(c); finish() }} />
  }
  if (mode === 'done' && startedAtMs != null) {
    return <WalkSummary config={config} samples={samples} cadence={cadence} startedAtMs={startedAtMs} userId={userId} onDone={reset} />
  }
  return <WalkConfig onStart={() => start(Date.now())} />
}
