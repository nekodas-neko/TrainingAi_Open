'use client'

import { useEffect, useState } from 'react'
import { ActivityIcon } from 'lucide-react'
import { cachedFetchToday, readTodayCacheSync } from '@/lib/sqlite/cache'
import { TRAINING_STRESS_TTL } from '@trainingai/shared/cache-ttl'
import { todayInTz } from '@trainingai/shared/date-utils'
import type { TrainingStressResponse } from '@/app/api/training-stress/route'

// Daily Training Stress Score line on the health Training-Load card. Reuses the same
// `training-stress` cache key as the done-screen badge (one key per endpoint). Self-hides
// when gated (readiness learning / no profile / not enough MET).
export function TrainingStressLine() {
  const [data, setData] = useState<TrainingStressResponse | null>(null)

  useEffect(() => {
    const seed = readTodayCacheSync<TrainingStressResponse>('training-stress')
    if (seed) setData(seed)
    const today = todayInTz()
    void cachedFetchToday<TrainingStressResponse>(
      'training-stress', `/api/training-stress?date=${today}`, TRAINING_STRESS_TTL,
      d => { if (d) setData(d) },
    )
  }, [])

  if (!data || data.status !== 'ok') return null

  return (
    <div className="mt-2 flex items-center gap-2 text-sm">
      <ActivityIcon className="h-3.5 w-3.5 flex-none" style={{ color: '#f59e0b' }} />
      <span className="text-muted-foreground">Training stress (today)</span>
      <span className="font-semibold tabular-nums" style={{ color: '#f59e0b' }}>{data.ots.toFixed(1)}</span>
      {data.high && <span className="text-[11px] text-muted-foreground">· high load</span>}
    </div>
  )
}
