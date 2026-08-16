'use client'

import { memo, useEffect, useRef, useState } from 'react'
import { cachedFetch, readCacheSync } from '@/lib/sqlite/cache'
import { TTL_MEDIUM, TTL_LONG } from '@trainingai/shared/cache-ttl'
import { getActivityIcon } from '@trainingai/shared/constants/activity-icons'
import dynamic from 'next/dynamic'
import { formatTime12h, startOfWeekInTz } from '@trainingai/shared/date-utils'
import { getLocalStore } from '@/lib/local-store'
import type { LocalActivityLog } from '@/lib/local-store/types'
import type { ActivityLog, ActivityType } from '@trainingai/shared/types'

// Dynamic, matching how health-content.tsx imports the same sheet. The static import here was
// the chain Q-127 identified as defeating that wrapper. No `loading:` skeleton — the sheet
// renders nothing until opened, so there is no first paint to hold.
const ActivityDetailSheet = dynamic(
  () => import('@/components/activity/activity-detail-sheet').then(m => m.ActivityDetailSheet),
  { ssr: false },
)

function localToActivityLog(l: LocalActivityLog): ActivityLog {
  return {
    id: l.id, userId: '', date: l.date, activityType: l.activityType, title: l.title,
    startTime: l.startTime ?? undefined,
    endTime: l.endTime ?? undefined,
    durationMin: l.durationMin ?? undefined,
    distanceKm: l.distanceKm ?? undefined,
    caloriesBurned: l.caloriesBurned ?? undefined,
    avgHr: l.avgHr ?? undefined,
    maxHr: l.maxHr ?? undefined,
    steps: l.steps ?? undefined,
    notes: l.notes ?? undefined,
    routePolyline: l.routePolyline ?? undefined,
    splits: l.splits ?? undefined,
    bestEfforts: l.bestEfforts ?? undefined,
    paceSeries: l.paceSeries ?? undefined,
    avgPaceSecPerKm: l.avgPaceSecPerKm ?? undefined,
    elevationGainM: l.elevationGainM ?? undefined,
    elevationLossM: l.elevationLossM ?? undefined,
    elevationProfile: l.elevationProfile ?? undefined,
    cadenceSpm: l.cadenceSpm ?? undefined,
    cadenceSeries: l.cadenceSeries ?? undefined,
    cadenceSource: l.cadenceSource ?? undefined,
    segments: l.segments ?? undefined,
    createdAt: new Date(),
  }
}

function formatActivityTitle(title: string): string {
  if (!title.startsWith('EXERCISE_TYPE_')) return title
  return title
    .replace('EXERCISE_TYPE_', '')
    .split('_')
    .map(w => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ')
    .replace('Treadmill', '(Treadmill)')
    .replace('Pool', '(Pool)')
    .replace('Open Water', '(Open Water)')
    .replace('Stationary', '(Stationary)')
}

export const ActivityHistoryCard = memo(function ActivityHistoryCard({ userId }: { userId?: string }) {
  const [logs, setLogs] = useState<ActivityLog[]>([])
  const [types, setTypes] = useState<ActivityType[]>([])
  const [selected, setSelected] = useState<ActivityLog | null>(null)
  // D-4: activity writes are local+outbox, so an offline/unsynced activity lives only
  // in the local store. The server list must be UNION'd with those pending rows, not
  // replace them — otherwise the walk the user just logged vanishes when the server
  // response lands (the "my data disappeared" repaint).
  const pendingLocalRef = useRef<ActivityLog[]>([])

  useEffect(() => {
    // Seed from the cache mirror so the card paints from the last response
    // before the network resolves. Done here, not in a useState lazy
    // initializer, because this component is server-rendered — reading the
    // client-only cache during render would cause a hydration mismatch.
    const seedTypes = readCacheSync<{ activityTypes: ActivityType[] }>('activity-types')?.activityTypes
    if (seedTypes?.length) setTypes(seedTypes)
    const seedLogs = readCacheSync<{ activityLogs: ActivityLog[] }>('activity-logs')?.activityLogs
    if (seedLogs?.length) setLogs(seedLogs)
    cachedFetch<{ activityTypes: ActivityType[] }>(
      'activity-types', '/api/activity-types', TTL_LONG,
      d => setTypes(d?.activityTypes ?? []),
      { freshWithinTtl: true },
    ).catch(() => {})
    // Local-first: the on-device store is the source of truth, so an activity
    // logged offline shows here immediately. The server fetch stays authoritative
    // (it also carries server-computed calories) and overwrites when it lands.
    const store = userId ? getLocalStore(userId) : null
    if (store) {
      store.getActivityLogs(startOfWeekInTz())
        .then(local => {
          pendingLocalRef.current = local.filter(l => l.syncStatus === 'pending').map(localToActivityLog)
          if (local.length) setLogs(local.map(localToActivityLog))
        })
        .catch(() => {})
    }
    cachedFetch<{ activityLogs: ActivityLog[] }>(
      'activity-logs', '/api/activity-logs?days=7', TTL_MEDIUM,
      d => {
        const server = d?.activityLogs ?? []
        const serverIds = new Set(server.map(s => s.id))
        // Retain any local pending row the server hasn't yet acknowledged.
        setLogs([...server, ...pendingLocalRef.current.filter(p => !serverIds.has(p.id))])
      },
    ).catch(() => {})
  }, [userId])

  const weekStart = startOfWeekInTz()
  const weekLogs = logs.filter(l => l.date >= weekStart)

  const iconByType = new Map(types.map(t => [t.id, t.icon]))

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-brand)' }}>
          Activities This Week
        </span>
        {weekLogs.length > 0 && (
          <span className="text-[10px] text-muted-foreground">{weekLogs.length} session{weekLogs.length !== 1 ? 's' : ''}</span>
        )}
      </div>
      {weekLogs.length === 0 ? (
        <p className="px-4 py-4 text-center text-xs text-muted-foreground">No activities this week</p>
      ) : (
        <div className="divide-y divide-border/50">
          {weekLogs.map(log => {
            const Icon = getActivityIcon(iconByType.get(log.activityType) ?? 'DotsThreeCircle')
            return (
              <button
                key={log.id}
                type="button"
                onClick={() => setSelected(log)}
                className="w-full px-4 py-3 text-left"
              >
                <div className="flex items-center gap-3">
                  <Icon size={20} className="flex-none text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{formatActivityTitle(log.title)}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {log.date}
                      {log.startTime ? ` · ${formatTime12h(log.startTime)}` : ''}
                      {log.durationMin ? ` · ${Math.round(log.durationMin)} min` : ''}
                    </p>
                  </div>
                  <div className="text-right text-xs text-muted-foreground flex-none">
                    {log.distanceKm != null && <div>{Number(log.distanceKm).toFixed(2)} km</div>}
                    {log.caloriesBurned != null && <div>{Math.round(log.caloriesBurned)} kcal</div>}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      <ActivityDetailSheet
        log={selected}
        icon={iconByType.get(selected?.activityType ?? '') ?? 'DotsThreeCircle'}
        onOpenChange={open => { if (!open) setSelected(null); }}
      />
    </div>
  )
})
