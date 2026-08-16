'use client'

import { useEffect } from 'react'
import { startNavTimingRecorder } from '@/lib/perf/nav-timing-recorder'

// Mounts the navigation-timing recorder for the whole app. It has to be always-on
// rather than something the admin console switches on, because the measurement is of
// ordinary navigation — an instrument you have to remember to arm first records nothing
// but the run where you remembered. Read the results in More → Admin → Device data capture.
export function NavTimingProbe() {
  useEffect(() => startNavTimingRecorder(), [])
  return null
}
