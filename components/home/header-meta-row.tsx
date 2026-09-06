'use client'

import { formatInTimeZone } from 'date-fns-tz'
import dynamic from 'next/dynamic'

/** Lazy exactly as it was when the page owned this row: the chips fetch, the date does not, so the
 *  date must paint immediately and the chips may arrive after. */
const HeaderChips = dynamic(() => import('@/components/home/header-chips').then(m => m.HeaderChips), { ssr: false })

/**
 * Home's header meta row: today's date, then the chips.
 *
 * **It is a component because the row needed an overflow strategy and the header could not grow.**
 * `session-select-content.tsx` is a shrink-only hotspot, and the rule there is to extract rather
 * than append — the same reason `HeaderChips` exists.
 *
 * **BF-116: every item in this row is `shrink-0`.** BF-96 gave the weather chip
 * `whitespace-nowrap shrink-0` on 2026-09-01, correctly — it was the only compressible item, took
 * 100% of any shortfall, and broke `UV 5` across two lines. The device chips carry the same pair
 * (Q-111, the day after), and the date already had it. With nothing left to compress the shortfall
 * had nowhere to go, so instead of wrapping the row overflowed across the action buttons: the
 * owner's *"the grid and battery pill still intersect"*.
 *
 * **The date is what gives.** It is the longest item, the least informative, and the only one whose
 * length varies — `EEEE d MMMM` runs 12–20 characters across the year, which BF-96 had already
 * identified as the variable that runs the row out of width. `min-w-0` is what lets a flex item
 * shrink below its content at all; `truncate` supplies the ellipsis and its own `nowrap`.
 *
 * **`overflow-hidden` is the floor, not the fix.** Once the date has truncated to nothing, chips
 * alone can still outgrow the width — a third is already expected, since anything with a battery is
 * a candidate and only the scale deliberately has none. Clipping inside this row keeps that case off
 * the buttons rather than letting it spill.
 *
 * **Do not solve a future recurrence by dropping `shrink-0` from the chips.** That restores the
 * two-line wrap BF-96 fixed. This row wants an overflow strategy, not more shrinking.
 */
export function HeaderMetaRow({ tz }: { tz: string }) {
  return (
    <div className="flex items-center gap-2 min-w-0 overflow-hidden">
      <p className="text-xs text-muted-foreground truncate min-w-0">
        {formatInTimeZone(new Date(), tz, 'EEEE d MMMM')}
      </p>
      <HeaderChips />
    </div>
  )
}
