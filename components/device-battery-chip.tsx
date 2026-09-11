'use client'

import { BatteryChargingIcon, BatteryFullIcon, BatteryLowIcon, BatteryMediumIcon } from 'lucide-react'

/**
 * Every device's battery, as ONE Home-header chip (Q-111, reshaped by BF-139).
 *
 * Presentational and scalar-only: the call site's readings differ entirely in where they come from
 * — the ring's from an API, the strap's from a native plugin plus a last-seen store — and nothing
 * about that belongs here.
 *
 * **One pill for all devices, not one per device, and the reason is arithmetic.** Measured at
 * 412 dp, the header's left column is **224 px**. Two separate pills cost **150 px** of it, which
 * with the weather chip's daytime `· UV n` form (**113 px**) totals **279 px** — 55 px past the
 * column, which is the clipping the owner reported. Merging them into one pill removes a gap and a
 * pair of horizontal paddings; dropping the drawn `%` removes 12 px per reading. Together they take
 * the worst case to **~213 px**, which fits with room left for a short date.
 *
 * **BF-139's own suggested lever was measured and is not enough on its own.** Trimming `px-2.5` to
 * `px-2` saves 4 px a pill, 12 px across three — it clears the reported night case (227 → 215) and
 * leaves the daytime case 43 px over. The padding trim is kept because it is free and the owner
 * asked for smaller pills, but it is not what makes this fit.
 *
 * **A stale reading is shown, not hidden, and says so.** The owner asked for
 * *live-when-connected, last-seen-when-disconnected*: a reading that vanishes when a device
 * disconnects reads as "no device" rather than "not connected right now", which is the more common
 * state for a chest strap. Staleness dims that device's own segment rather than the whole pill —
 * with two devices sharing a pill, dimming all of it would misreport the fresh one.
 *
 * **The `%` lives in the accessible name, not on the glass.** A number beside a battery icon is
 * already read as a percentage, and the header row has room for a number and not for a sentence.
 * Colour still never carries the state alone: the digits are beside the icon and the accessible
 * name spells the level out.
 */

/** Past this, a reading is last-seen rather than current. Matches the ring section's own 3h rule. */
export const STALE_AFTER_MINUTES = 180

export interface DeviceBattery {
  /** What the reading is about — 'Ring', 'Strap'. Used in the accessible name, not drawn. */
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

function describe({ label, percent, charging, ageMinutes }: DeviceBattery): string {
  if (ageMinutes > STALE_AFTER_MINUTES) return `${label} battery ${percent}%, last seen ${ageText(ageMinutes)}`
  return `${label} battery ${percent}%${charging ? ', charging' : ''}`
}

export function DeviceBatteryChip({ devices }: { devices: DeviceBattery[] }) {
  if (devices.length === 0) return null

  return (
    <div
      className="flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-full bg-muted/60 px-2 py-1 text-xs font-semibold"
      aria-label={devices.map(describe).join('. ')}
    >
      {devices.map(device => {
        const { label, percent, charging = false, ageMinutes } = device
        const stale = ageMinutes > STALE_AFTER_MINUTES
        const Icon = charging
          ? BatteryChargingIcon
          : percent >= 60 ? BatteryFullIcon : percent >= 25 ? BatteryMediumIcon : BatteryLowIcon
        const tone = charging || percent >= 60 ? 'text-green-400' : percent >= 25 ? 'text-amber-400' : 'text-red-400'

        return (
          <span key={label} className={`flex items-center gap-1 ${stale ? 'opacity-50' : ''}`}>
            <Icon className={`h-3.5 w-3.5 ${stale ? 'text-muted-foreground' : tone}`} aria-hidden="true" />
            <span className="tabular-nums">{percent}</span>
          </span>
        )
      })}
    </div>
  )
}
