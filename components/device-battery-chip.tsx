'use client'

import { BatteryChargingIcon, BatteryFullIcon, BatteryLowIcon, BatteryMediumIcon } from 'lucide-react'

/**
 * One device's battery, as a Home-header chip (Q-111).
 *
 * Presentational and scalar-only: the two call sites differ entirely in where their number comes
 * from — the ring's from an API, the strap's from a native plugin plus a last-seen store — and
 * nothing about that belongs here.
 *
 * **A stale reading is shown, not hidden, and says so.** The owner asked for
 * *live-when-connected, last-seen-when-disconnected*: a chip that vanishes when a device
 * disconnects reads as "no device" rather than "not connected right now", which is the more common
 * state for a chest strap. Age is carried in the accessible name rather than the pill, because the
 * header row has room for a number and not for a sentence — and it is muted, so the difference is
 * visible without reading it.
 */

/** Past this, a reading is last-seen rather than current. Matches the ring section's own 3h rule. */
export const STALE_AFTER_MINUTES = 180

interface Props {
  /** What the chip is about — 'Ring', 'Strap'. Used in the accessible name, not drawn. */
  label: string
  percent: number
  charging?: boolean
  /** How old the reading is. 0 for a live one. */
  ageMinutes: number
}

function ageText(ageMinutes: number): string {
  if (ageMinutes < 60) return `${Math.max(1, Math.round(ageMinutes))}m ago`
  const hours = ageMinutes / 60
  return hours < 48 ? `${Math.round(hours)}h ago` : `${Math.round(hours / 24)}d ago`
}

export function DeviceBatteryChip({ label, percent, charging = false, ageMinutes }: Props) {
  const stale = ageMinutes > STALE_AFTER_MINUTES
  const Icon = charging
    ? BatteryChargingIcon
    : percent >= 60 ? BatteryFullIcon : percent >= 25 ? BatteryMediumIcon : BatteryLowIcon

  // Colour never carries the state on its own — the percentage is beside it and the accessible name
  // spells the level out, which is what the colour-only-state rule asks for.
  const tone = charging ? 'text-green-400' : percent >= 60 ? 'text-green-400' : percent >= 25 ? 'text-amber-400' : 'text-red-400'

  return (
    <div
      className={`flex items-center gap-1 whitespace-nowrap shrink-0 rounded-full bg-muted/60 px-2.5 py-1 text-xs font-semibold ${stale ? 'opacity-50' : ''}`}
      aria-label={
        stale
          ? `${label} battery ${percent}%, last seen ${ageText(ageMinutes)}`
          : `${label} battery ${percent}%${charging ? ', charging' : ''}`
      }
    >
      <Icon className={`h-3.5 w-3.5 ${stale ? 'text-muted-foreground' : tone}`} aria-hidden="true" />
      <span className="tabular-nums">{percent}%</span>
    </div>
  )
}
