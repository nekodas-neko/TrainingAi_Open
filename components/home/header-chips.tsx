'use client'

import { WeatherChip } from '@/components/weather-chip'
import { DeviceBatteryChip } from '@/components/device-battery-chip'
import { useStrapBattery } from '@/lib/hooks/use-strap-battery'
import { useCachedValue } from '@/lib/hooks/use-cached-value'
import { TTL_MEDIUM } from '@trainingai/shared/cache-ttl'

/**
 * The Home header's chip row: weather, then whichever devices have a battery reading (Q-111).
 *
 * **It exists as one component so the header does not grow.** `session-select-content.tsx` is a
 * shrink-only hotspot in `check-component-size.js`, and the rule there is to extract rather than
 * append. Rendering the weather chip from here keeps the header at exactly the two lines it had —
 * one dynamic import, one usage — while the row gains two chips.
 *
 * **The scale has no chip and that is not an omission.** No battery capability exists for it
 * anywhere, not even a one-shot native read; the owner flagged it as a stretch item. A chip that
 * could never have a value would be worse than its absence.
 */

interface RingBattery {
  percent: number
  charging: boolean | null
  ageMinutes: number
}

export function HeaderChips() {
  // The same key, endpoint, variant and TTL the Health section already uses. A second key for one
  // endpoint is what causes stale and blank first paints, and a divergent TTL fails
  // `check-cache-ttl-divergence`.
  //
  // **`useCachedValue`, not a `useEffect(…, [])`.** This row lives in the Home header, which is in
  // the persistent tab shell and never unmounts — a fetch-once effect there holds its first payload
  // until the app is killed, which is Q-402 exactly. `today: true` because the existing site calls
  // `cachedFetchToday`, and the variant is a property of the key rather than of the call site.
  const ring = useCachedValue<{ latest: RingBattery | null }>(
    'oura-ble-battery-latest', '/api/oura-ble/battery-latest', TTL_MEDIUM, { today: true },
  )?.latest ?? null
  const strap = useStrapBattery()

  return (
    <>
      <WeatherChip />
      {ring != null && (
        <DeviceBatteryChip label="Ring" percent={ring.percent} charging={ring.charging ?? false} ageMinutes={ring.ageMinutes} />
      )}
      {strap != null && (
        <DeviceBatteryChip label="Strap" percent={strap.percent} ageMinutes={strap.ageMinutes} />
      )}
    </>
  )
}
