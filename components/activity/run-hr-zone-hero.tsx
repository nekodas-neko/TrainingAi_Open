'use client'

import { memo, useEffect, useState } from 'react'
import { HeartPulseIcon } from 'lucide-react'
import { useLiveHr } from '@/lib/live-hr/use-live-hr'
import { computeHrZones, zoneForBpm } from '@trainingai/shared/health/hr-zones'
import { cachedFetch, readCacheSync } from '@/lib/sqlite/cache'
import { HR_PROFILE_TTL } from '@trainingai/shared/cache-ttl'
import type { HrProfileResponse } from '@/app/api/hr-profile/route'

interface Props {
  /** Target zone ids from today's prescription, if this run has one — highlights the
   *  reading when the current zone is one of these; shows the target otherwise. */
  targetZoneIds?: number[]
}

function RunHrZoneHeroImpl({ targetZoneIds }: Props) {
  const { bpm, live, stale } = useLiveHr()
  const [profile, setProfile] = useState<HrProfileResponse | null>(null)

  useEffect(() => {
    const seed = readCacheSync<HrProfileResponse>('hr-profile')
    if (seed) setProfile(seed)
    cachedFetch<HrProfileResponse>('hr-profile', '/api/hr-profile', HR_PROFILE_TTL, setProfile).catch(() => {})
  }, [])

  const zones = profile ? computeHrZones(profile) : null
  const zone = zones && bpm != null ? zoneForBpm(bpm, zones) : null
  const onTarget = zone != null && targetZoneIds != null && targetZoneIds.includes(zone.id)
  const accent = zone?.color ?? 'var(--color-brand)'

  return (
    <div
      className={`flex w-full max-w-xs flex-col items-center gap-1 rounded-2xl border border-border bg-muted/40 px-4 py-3 transition-opacity ${stale ? 'opacity-70' : ''}`}
    >
      <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        <HeartPulseIcon className={`h-3.5 w-3.5 ${live ? 'animate-pulse' : ''}`} style={{ color: accent }} /> Heart rate
      </span>
      <span className="flex items-baseline gap-1.5">
        <span className="text-4xl font-bold leading-none tabular-nums" style={{ color: accent }}>
          {bpm ?? '—'}
        </span>
        <span className="text-xs font-medium text-muted-foreground">bpm</span>
      </span>
      {zone && (
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
          style={{ color: accent, background: `color-mix(in oklch, ${accent} ${onTarget ? 20 : 12}%, transparent)` }}
        >
          Zone {zone.id} · {zone.name}
          {targetZoneIds != null && (onTarget ? ' · on target' : ` · target Z${targetZoneIds.join('-')}`)}
        </span>
      )}
    </div>
  )
}

export const RunHrZoneHero = memo(RunHrZoneHeroImpl)
