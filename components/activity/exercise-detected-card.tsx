'use client'

import { useEffect } from 'react'
import { useAutoDetectionStore } from '@/lib/stores/auto-detection-store'
import { useCachedValue } from '@/lib/hooks/use-cached-value'
import { invalidateOuraWorkoutReview } from '@/lib/cache-groups'
import { TTL_MEDIUM } from '@trainingai/shared/cache-ttl'

function formatTime(ms: number): string {
  const d = new Date(ms)
  const h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, '0')
  const ampm = h >= 12 ? 'pm' : 'am'
  return `${h % 12 || 12}:${m}${ampm}`
}

interface Props {
  onReview: (sessionId: string) => void
}

export function ExerciseDetectedCard({ onReview }: Props) {
  const pendingSessions = useAutoDetectionStore(s => s.pendingSessions)
  const dismissSession = useAutoDetectionStore(s => s.dismissSession)
  const addOuraSession = useAutoDetectionStore(s => s.addOuraSession)

  const detected = useCachedValue<Array<{
    id: string; activity: string; startDatetime: string; endDatetime: string;
    distanceM: number | null;
  }>>('oura-unreviewed-workouts', '/api/oura/workouts?unreviewed=true', TTL_MEDIUM)

  useEffect(() => {
    if (!detected) return
    const currentSessions = useAutoDetectionStore.getState().pendingSessions
    for (const w of detected) {
      const startMs = new Date(w.startDatetime).getTime()
      const endMs = new Date(w.endDatetime).getTime()
      const alreadyCovered = currentSessions.some(
        p => (p.source === 'oura' && p.ouraWorkoutId === w.id)
          || (p.source === 'phone' && p.startMs < endMs && p.endMs > startMs)
      )
      if (alreadyCovered) continue
      addOuraSession({
        startMs,
        endMs,
        routePolyline: '',
        distanceKm: w.distanceM ? w.distanceM / 1000 : 0,
        durationMin: (endMs - startMs) / 60000,
        activityType: w.activity.toLowerCase().includes('run') ? 'run' : 'walk',
        source: 'oura',
        ouraWorkoutId: w.id,
      })
    }
  }, [detected, addOuraSession])

  if (!pendingSessions.length) return null

  const session = [...pendingSessions].sort((a, b) => b.startMs - a.startMs)[0]
  const extras = pendingSessions.length - 1

  function markReviewedOnServer(s: (typeof pendingSessions)[number]): boolean {
    if (s.source !== 'oura' || !s.ouraWorkoutId) return false
    fetch('/api/oura/workouts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: s.ouraWorkoutId }),
    }).catch(() => {})
    return true
  }

  // Dismissing an Oura-detected workout must mark it reviewed server-side AND bust the
  // cached unreviewed list — otherwise the next mount re-ingests it from the stale entry
  // (the workout is no longer in pendingSessions, so ingestWorkouts' alreadyCovered check
  // passes and the card reappears). Matches the review sheet's save/dismiss paths.
  function dismissOne(s: (typeof pendingSessions)[number]) {
    const marked = markReviewedOnServer(s)
    dismissSession(s.id)
    if (marked) void invalidateOuraWorkoutReview()
  }

  function dismissAll() {
    let markedReviewed = false
    for (const s of pendingSessions) {
      if (markReviewedOnServer(s)) markedReviewed = true
      dismissSession(s.id)
    }
    if (markedReviewed) void invalidateOuraWorkoutReview()
  }

  return (
    <div className="mb-4 overflow-hidden rounded-2xl border border-brand/30 bg-brand/10">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold capitalize">
            {session.activityType === 'run' ? 'Run' : 'Walk'} detected
          </p>
          <p className="text-xs text-muted-foreground">
            {formatTime(session.startMs)} · {Math.round(session.durationMin)} min{session.distanceKm > 0 ? ` · ${session.distanceKm.toFixed(2)} km` : ''}
            {extras > 0 && ` · +${extras} more`}
          </p>
        </div>
        <div className="ml-3 flex shrink-0 gap-2">
          {extras > 0 ? (
            <button
              onClick={dismissAll}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-muted-foreground"
            >
              Dismiss all
            </button>
          ) : (
            <button
              onClick={() => dismissOne(session)}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-muted-foreground"
            >
              Dismiss
            </button>
          )}
          <button
            onClick={() => onReview(session.id)}
            className="rounded-lg px-3 py-1.5 text-xs font-bold text-brand-foreground"
            style={{ background: 'var(--color-brand)' }}
          >
            Review
          </button>
        </div>
      </div>
    </div>
  )
}
