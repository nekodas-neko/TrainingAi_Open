'use client'

import { memo, useEffect, useState } from 'react'
import { HeartIcon } from '@phosphor-icons/react'
import { getLiveHrManager } from '@/lib/live-hr/manager'
import type { LiveHrSample } from '@/lib/live-hr/types'

/** Beyond this the strap has stopped reporting; say so rather than freezing on the last number. */
const STALE_MS = 8_000

/**
 * Live heart rate during a free activity (Q-418).
 *
 * The screen rendered distance, pace and cadence and **no heart rate at all**, while the same strap
 * feeding it cadence was streaming beats — the owner's mid-walk screenshot read `120 spm · strap`
 * with no bpm anywhere. The data was already being persisted afterwards (`done-activity-screen`
 * stores `avgHr`/`maxHr` from `hr-window`), so HR was recorded for these walks and invisible only
 * *while walking* — the one time it can be acted on.
 *
 * **A leaf that owns its own subscription**, like `CadenceReadout` beside it: a strap reports about
 * once a second, and putting that in the activity screen's state would re-render the route map on
 * every beat.
 *
 * **The staleness guard is copied deliberately from the guided walk** (`walk-active.tsx`). A number
 * that silently stops updating is worse than a dash, because it reads as a current reading.
 *
 * **`mgr.stop()` on unmount does not cost the screen its cadence**, which is worth stating because
 * the same strap feeds both: `ChestStrapSource.stop()` detaches the live relay and **leaves the
 * foreground service running** (its own comment says so — the service is all-day, torn down only by
 * unmounting the app or unpairing). Cadence reads the accelerometer through `getPolarBle()`
 * independently of this manager.
 */
export const HrReadout = memo(function HrReadout() {
  const [bpm, setBpm] = useState<number | null>(null)
  const [lastBeatAt, setLastBeatAt] = useState<number | null>(null)
  // Re-render on a slow tick so the reading can go stale while the strap is silent — without it
  // `Date.now()` is only consulted when a beat arrives, which is exactly when it is never stale.
  const [, setTick] = useState(0)

  useEffect(() => {
    const mgr = getLiveHrManager()
    mgr.start().catch(() => {})
    const unsub = mgr.subscribe((s: LiveHrSample) => { setBpm(s.bpm); setLastBeatAt(s.at) })
    const id = setInterval(() => setTick(t => t + 1), 2_000)
    return () => { unsub(); clearInterval(id); mgr.stop().catch(() => {}) }
  }, [])

  const live = bpm != null && lastBeatAt != null && Date.now() - lastBeatAt < STALE_MS

  return (
    <div>
      <p className="text-2xl font-bold tabular-nums">{bpm == null ? '--' : Math.round(bpm)}</p>
      <p className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
        <HeartIcon size={12} />
        bpm{bpm != null && !live ? ' (stale)' : ''}
      </p>
    </div>
  )
})
