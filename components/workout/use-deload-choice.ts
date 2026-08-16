'use client'

import { useEffect, useState } from 'react'
import { readTodayCacheSync } from '@/lib/sqlite/cache'

/**
 * Today's intensity choice (Q-109-followup).
 *
 * Deload used to be a third button on Home that navigated to `?aiDeload=1`, so the flag was a fixed
 * URL param for the life of the screen. It now lives on the pre-workout screen, which means it has
 * to be live state — flipping it re-keys the workout-data cache and refetches, exactly as the old
 * navigation did, but without leaving the screen.
 *
 * `recommended` only labels the toggle; it never gates the choice. It is read from the same
 * `next-session` seed Home paints from rather than fetched, so a cache miss means no label, never
 * a wrong one.
 */
export function useDeloadChoice(seedFromUrl: boolean) {
  const [deload, setDeload] = useState(seedFromUrl)
  const [recommended, setRecommended] = useState(false)

  useEffect(() => {
    const rec = readTodayCacheSync<{ deloadOrRestRecommended?: boolean }>('next-session')
    if (rec?.deloadOrRestRecommended) setRecommended(true)
  }, [])

  return { deload, setDeload, recommended }
}
