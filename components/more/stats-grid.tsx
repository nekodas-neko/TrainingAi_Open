"use client"

import { AlertTriangle, CalendarDays, Dumbbell, Flame, ListChecks, MapPin, Weight } from 'lucide-react'
import type { User } from '@trainingai/shared/types/user'
import { formatInTimeZone } from 'date-fns-tz'
import { useUserTimezone } from '@/components/shell/user-timezone-provider'

interface ProgramWeeks {
  mode: 'cycle' | 'tenure' | null
  weeksRunning?: number
  cycleCurrent?: number
  cycleTotal?: number
  phaseName?: string
  blockComplete?: boolean
  programName: string | null
}

interface StatsGridProps {
  totalSessions: number
  totalSets: number
  totalVolumeKg: number
  bestStreak: number
  totalDistanceKm: number
  programWeeks: ProgramWeeks | null
  user: User | null
}

function formatVolume(kg: number): string {
  const tons = kg / 1000
  if (tons >= 1000) return `${(tons / 1000).toFixed(1)}kT`
  if (tons >= 1) return `${tons.toFixed(1)}T`
  return `${Math.round(kg)}kg`
}

function formatDistance(km: number): string {
  if (km <= 0) return '—'
  if (km >= 100) return `${Math.round(km)} km`
  return `${km.toFixed(1)} km`
}

export function StatsGrid({ totalSessions, totalSets, totalVolumeKg, bestStreak, totalDistanceKm, programWeeks, user }: StatsGridProps) {
  const userTz = useUserTimezone()
  return (
    <div className="max-w-xs mx-auto grid grid-cols-3 gap-2">
      <div className="rounded-2xl bg-muted/40 border border-border p-2.5 flex flex-col items-center gap-1 text-center">
        <Dumbbell className="h-4 w-4" style={{ color: 'var(--color-brand)' }} />
        <p className="text-base font-bold tabular-nums" style={{ color: 'var(--color-brand)' }}>{totalSessions}</p>
        <p className="text-[9px] text-muted-foreground leading-tight">Sessions</p>
      </div>
      <div className="rounded-2xl bg-muted/40 border border-border p-2.5 flex flex-col items-center gap-1 text-center">
        <ListChecks className="h-4 w-4" style={{ color: 'var(--accent-green)' }} />
        <p className="text-base font-bold tabular-nums" style={{ color: 'var(--accent-green)' }}>{totalSets.toLocaleString()}</p>
        <p className="text-[9px] text-muted-foreground leading-tight">Sets</p>
      </div>
      <div className="rounded-2xl bg-muted/40 border border-border p-2.5 flex flex-col items-center gap-1 text-center">
        <Weight className="h-4 w-4" style={{ color: '#ff6a1a' }} />
        <p className="text-base font-bold tabular-nums" style={{ color: '#ff6a1a' }}>{formatVolume(totalVolumeKg)}</p>
        <p className="text-[9px] text-muted-foreground leading-tight">Volume</p>
      </div>
      <div className="rounded-2xl bg-muted/40 border border-border p-2.5 flex flex-col items-center gap-1 text-center">
        <Flame className="h-4 w-4" style={{ color: 'var(--accent-amber)' }} />
        <p className="text-base font-bold tabular-nums" style={{ color: 'var(--accent-amber)' }}>{bestStreak}</p>
        <p className="text-[9px] text-muted-foreground leading-tight">Best streak</p>
      </div>
      <div className="rounded-2xl bg-muted/40 border border-border p-2.5 flex flex-col items-center gap-1 text-center">
        <MapPin className="h-4 w-4" style={{ color: 'var(--accent-cyan)' }} />
        <p className="text-base font-bold tabular-nums" style={{ color: 'var(--accent-cyan)' }}>{formatDistance(totalDistanceKm)}</p>
        <p className="text-[9px] text-muted-foreground leading-tight">Distance</p>
      </div>
      {programWeeks?.mode === 'cycle' ? (
        <div className="rounded-2xl bg-muted/40 border border-border p-2.5 flex flex-col items-center gap-1 text-center">
          <CalendarDays className="h-4 w-4" style={{ color: 'var(--color-brand)' }} />
          <p className="text-base font-bold tabular-nums" style={{ color: 'var(--color-brand)' }}>
            {programWeeks.cycleCurrent}/{programWeeks.cycleTotal}
          </p>
          <p className="text-[9px] text-muted-foreground leading-tight truncate w-full">
            {programWeeks.blockComplete
              ? <span className="inline-flex items-center gap-0.5"><AlertTriangle className="h-2.5 w-2.5 flex-none" aria-hidden />New block?</span>
              : programWeeks.phaseName}
          </p>
        </div>
      ) : programWeeks?.mode === 'tenure' && programWeeks.weeksRunning != null ? (
        <div className="rounded-2xl bg-muted/40 border border-border p-2.5 flex flex-col items-center gap-1 text-center">
          <CalendarDays className="h-4 w-4" style={{ color: 'var(--color-brand)' }} />
          <p className="text-base font-bold tabular-nums" style={{ color: 'var(--color-brand)' }}>{programWeeks.weeksRunning}w</p>
          <p className="text-[9px] text-muted-foreground leading-tight">
            {programWeeks.weeksRunning >= 12
              ? <span className="inline-flex items-center gap-0.5"><AlertTriangle className="h-2.5 w-2.5 flex-none" aria-hidden />Review?</span>
              : 'On program'}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl bg-muted/40 border border-border p-2.5 flex flex-col items-center gap-1 text-center">
          <CalendarDays className="h-4 w-4" style={{ color: 'var(--color-brand)' }} />
          <p className="text-base font-bold tabular-nums" style={{ color: 'var(--color-brand)' }}>
            {user?.createdAt ? formatInTimeZone(new Date(user.createdAt), userTz, 'MMM yy') : '—'}
          </p>
          <p className="text-[9px] text-muted-foreground leading-tight">Member since</p>
        </div>
      )}
    </div>
  )
}
