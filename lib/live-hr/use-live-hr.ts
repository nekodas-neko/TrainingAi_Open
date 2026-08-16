// lib/live-hr/use-live-hr.ts
'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getLiveHrManager } from '@/lib/live-hr/manager'
import type { LiveHrDiagnostics, LiveHrSourceId } from '@/lib/live-hr/types'

const STALE_MS = 8_000

export interface UseLiveHr {
  /** Last-seen bpm — HELD across stale gaps (was: blanked to null once stale). null only
   *  before the first sample arrives. Use `live`/`stale` to decide how to present it. */
  bpm: number | null
  at: number | null
  sourceId: LiveHrSourceId | null
  /** True once we've received at least one sample and it isn't stale. */
  live: boolean
  /** True when we have a bpm but the last sample is older than STALE_MS (hold + dim it). */
  stale: boolean
  /** Pull the current diagnostics snapshot. Call only when a diagnostic panel is
   *  open — cheap, but pointless work otherwise. Stable identity across renders. */
  getDiagnostics: () => LiveHrDiagnostics | null
  /** Force an immediate reading (user tapped "Measure"). Stable identity. */
  measureNow: () => Promise<void>
}

/**
 * Read-only view of the live-HR stream. Does NOT start/stop the manager — the
 * workout/activity screen owns that lifecycle. Recomputes staleness on a 1 Hz
 * tick; safe to call in a leaf component (this hook IS the leaf's only timer).
 */
export function useLiveHr(): UseLiveHr {
  const [bpm, setBpm] = useState<number | null>(null)
  const [at, setAt] = useState<number | null>(null)
  const [sourceId, setSourceId] = useState<LiveHrSourceId | null>(null)
  const [now, setNow] = useState<number>(() => Date.now())
  const atRef = useRef<number | null>(null)

  useEffect(() => {
    const mgr = getLiveHrManager()
    const seed = mgr.getCurrent()
    setBpm(seed.bpm); setAt(seed.at); setSourceId(seed.sourceId); atRef.current = seed.at
    const unsub = mgr.subscribe(s => {
      setBpm(s.bpm); setAt(s.at); setSourceId(s.sourceId); atRef.current = s.at
    })
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => { unsub(); clearInterval(tick) }
  }, [])

  const getDiagnostics = useCallback(() => getLiveHrManager().getDiagnostics(), [])
  const measureNow = useCallback(() => getLiveHrManager().measureNow(), [])

  const live = bpm != null && at != null && now - at < STALE_MS
  const stale = bpm != null && !live
  return { bpm, at, sourceId, live, stale, getDiagnostics, measureNow }
}
