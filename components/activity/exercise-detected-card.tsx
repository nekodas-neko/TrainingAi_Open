'use client'

import { useAutoDetectionStore } from '@/lib/stores/auto-detection-store'
import { useReportBannerPresence } from '@/components/home/home-banner-presence'
import { formatTimeOfDay } from '@trainingai/shared/date-utils'
import { useUserTimezone } from '@/components/shell/user-timezone-provider'

interface Props {
  onReview: (sessionId: string) => void
}

/**
 * The confirm card for a detected walk or run.
 *
 * **Q-231 removed the Oura half, not this card.** It used to ingest `/api/oura/workouts?unreviewed=true`
 * into `pendingSessions` as well, and the entry's scope said to retire the card outright on the grounds
 * that *"retiring this card removes nothing he currently sees working"*. That was measured and is not so:
 * `pendingSessions` has a second writer, the **live phone-GPS detector** — `AutoDetectionProvider` is
 * mounted in `app/layout.tsx` and calls `startAutoDetection()` unconditionally on native, `endSession()`
 * turns a qualifying walk into a pending session, and **this card is the only surface that renders one**
 * (the review sheet resolves a session by an id only this card supplies). Removing it would have orphaned
 * that pipeline silently.
 *
 * So what went is the Cloud plumbing the owner actually asked about — the unreviewed fetch, the ingest,
 * and the server-side mark-reviewed PATCH. Dismissal is now purely local, which is all a phone session
 * ever needed.
 */
export function ExerciseDetectedCard({ onReview }: Props) {
  const tz = useUserTimezone()
  const pendingSessions = useAutoDetectionStore(s => s.pendingSessions)
  const dismissSession = useAutoDetectionStore(s => s.dismissSession)

  // RV-119 — above the early return, because a hook cannot be skipped. Outside Home's provider this
  // is a no-op, so the card still works wherever else it is rendered.
  useReportBannerPresence('exerciseDetected', pendingSessions.length > 0)

  if (!pendingSessions.length) return null

  const session = [...pendingSessions].sort((a, b) => b.startMs - a.startMs)[0]
  const extras = pendingSessions.length - 1

  function dismissAll() {
    for (const s of pendingSessions) dismissSession(s.id)
  }

  return (
    <div className="mb-4 overflow-hidden rounded-2xl border border-brand/30 bg-brand/10">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold capitalize">
            {session.activityType === 'run' ? 'Run' : 'Walk'} detected
          </p>
          <p className="text-xs text-muted-foreground">
            {formatTimeOfDay(session.startMs, tz)} · {Math.round(session.durationMin)} min{session.distanceKm > 0 ? ` · ${session.distanceKm.toFixed(2)} km` : ''}
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
              onClick={() => dismissSession(session.id)}
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
