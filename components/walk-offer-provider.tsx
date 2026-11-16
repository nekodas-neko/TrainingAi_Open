'use client'

import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { offerRingWalks } from '@/lib/activity/ring-walks'
import { flushDetectionEvents } from '@/lib/activity/detection-events'
import { OURA_DATA_CHANGED_EVENT } from '@/lib/oura-data-changed'

/**
 * Offers the walks the server finds in the day's movement data (#2471) on the "detected" card.
 *
 * #3844 (owner, 16 Nov): this used to start the phone's live GPS and motion detector as well. Since
 * the ring moved to Oura Cloud that detector logged hundreds of candidates and saved none, so it was
 * removed; walks now come from the movement data and the workouts the source records itself.
 */
export function WalkOfferProvider() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    // The offer's funnel events wait in an outbox when a post fails; the detector used to retry them
    // when it started, so the retry moves here.
    void flushDetectionEvents()
    // Whenever new Oura data reaches the app (a sync pull carrying Oura's rows, #3077), and once now
    // for anything since the last time the app was open.
    void offerRingWalks()
    const onSynced = () => { void offerRingWalks() }
    window.addEventListener(OURA_DATA_CHANGED_EVENT, onSynced)
    return () => window.removeEventListener(OURA_DATA_CHANGED_EVENT, onSynced)
  }, [])

  return null
}
