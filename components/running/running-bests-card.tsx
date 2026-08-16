'use client'

import { memo } from 'react'
import { Trophy } from 'lucide-react'
import { formatTime } from '@/components/workout/utils'
import { formatPace } from '@trainingai/shared/health/vdot'
import type { RunningBests } from '@trainingai/shared/health/cardio-trends'

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-lg font-bold tabular-nums">{value}</p>
      <p className="text-[10px] uppercase tracking-widest text-[color:var(--muted-foreground)]">{label}</p>
    </div>
  )
}

function RunningBestsCardImpl({ bests }: { bests: RunningBests }) {
  if (bests.totalRuns === 0) return null

  return (
    <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-3.5">
      <p className="mb-2.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-[color:var(--muted-foreground)]">
        <Trophy className="h-3 w-3" aria-hidden />
        Your bests
      </p>
      <div className="grid grid-cols-2 gap-3">
        {bests.best1kSec != null && <Stat label="Best 1K" value={formatTime(bests.best1kSec)} />}
        {bests.best5kSec != null && <Stat label="Best 5K" value={formatTime(bests.best5kSec)} />}
        {bests.bestAvgPaceSecPerKm != null && <Stat label="Best pace" value={formatPace(bests.bestAvgPaceSecPerKm)} />}
        {bests.longestDistanceKm != null && <Stat label="Longest run" value={`${bests.longestDistanceKm.toFixed(1)} km`} />}
      </div>
    </div>
  )
}

export const RunningBestsCard = memo(RunningBestsCardImpl)
