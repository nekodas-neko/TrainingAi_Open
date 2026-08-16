'use client'

import { memo, useEffect, useState } from 'react'
import { ActivityIcon } from 'lucide-react'
import { cachedFetchToday, readTodayCacheSync } from '@/lib/sqlite/cache'
import { TRAINING_STRESS_TTL } from '@trainingai/shared/cache-ttl'
import type { TrainingStressResponse } from '@/app/api/training-stress/route'

// Daily Training Stress Score readout beside the done-screen energy line. Self-hides when
// the value is gated (readiness still learning, no profile, not enough MET) — no skeleton,
// no fabricated number, mirroring how the readiness chip hides itself.
export const TrainingStressBadge = memo(function TrainingStressBadge({ date }: { date: string }) {
  const [data, setData] = useState<TrainingStressResponse | null>(null)

  useEffect(() => {
    const seed = readTodayCacheSync<TrainingStressResponse>('training-stress')
    if (seed) setData(seed)
    void cachedFetchToday<TrainingStressResponse>(
      'training-stress', `/api/training-stress?date=${date}`, TRAINING_STRESS_TTL,
      d => { if (d) setData(d) },
    )
  }, [date])

  if (!data || data.status !== 'ok') return null

  return (
    <span className="flex items-center gap-1">
      <ActivityIcon className="h-3 w-3 flex-none" style={{ color: 'var(--accent-amber)' }} />
      <span className="tabular-nums font-semibold">{data.ots.toFixed(1)}</span>
      <span>training stress{data.high ? ' · high load' : ''}</span>
    </span>
  )
})
