'use client'

import { useEffect, useState } from 'react'
import { getPolarBle } from '@/lib/polar-ble/plugin'
import { readStrapBattery, writeStrapBattery, type StrapBatteryReading } from '@/lib/stores/strap-battery'

/**
 * The chest strap's battery — live from the native service when it is running, and the last-seen
 * value from this device otherwise (Q-111).
 *
 * **The seed is synchronous and the subscription is not.** `readStrapBattery` runs in an effect
 * rather than a `useState` initializer: a `localStorage` read in an initializer executes on the
 * server too and is the documented hydration-mismatch pattern this repo has been bitten by.
 *
 * **`getPolarBle()` returns null off-device**, which is most of where this code runs — the web
 * build and every e2e. The hook then reports the stored value alone, which is the correct answer
 * rather than a degraded one: the last reading is still the last reading.
 */
export function useStrapBattery(): { percent: number; ageMinutes: number } | null {
  const [reading, setReading] = useState<StrapBatteryReading | null>(null)

  useEffect(() => {
    setReading(readStrapBattery())

    let cancelled = false
    let handle: { remove: () => Promise<void> } | null = null

    const record = (percent: number | null | undefined) => {
      // Written before it is rendered, so a value seen once survives the strap disconnecting — and
      // so both writers land in one place rather than two numbers in two screens.
      writeStrapBattery(percent)
      const stored = readStrapBattery()
      if (!cancelled && stored) setReading(stored)
    }

    void (async () => {
      const native = await getPolarBle()
      if (!native || cancelled) return
      try {
        handle = await native.plugin.addListener('polarStatus', s => record(s.battery))
        if (cancelled) return
        record((await native.plugin.getStatus()).battery)
      } catch {
        // A plugin that is present but not started is not an error state for a chip.
      }
    })()

    return () => {
      cancelled = true
      void handle?.remove()
    }
  }, [])

  if (reading == null) return null
  return { percent: reading.percent, ageMinutes: Math.max(0, (Date.now() - reading.at) / 60_000) }
}
