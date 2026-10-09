'use client'

import { formatInTimeZone } from 'date-fns-tz'
import dynamic from 'next/dynamic'

/** Lazy exactly as it was when the page owned this row: the chips fetch, the date does not, so the
 *  date must paint immediately and the chips may arrive after. */
const HeaderChips = dynamic(() => import('@/components/home/header-chips').then(m => m.HeaderChips), { ssr: false })

/**
 * Home's header meta rows: the chips on one line, today's date on its own line below them.
 *
 * **It is a component because the header could not grow.** `session-select-content.tsx` is a
 * shrink-only hotspot, and the rule there is to extract rather than append — the same reason
 * `HeaderChips` exists.
 *
 * **#2174: the date and the chips no longer share a row.** At 412 dp the row is 224 px and the
 * daytime chips take 200–209 of it, so the date had 7–16 px left — not two characters. BF-96 and
 * BF-116 each shipped a width fix and each re-broke on a sunny day, because the slack they spent was
 * the date's. The owner chose (2026-09-26) to give the date its own line: the chips keep the header
 * row and the date moves below it (placement A in `docs/design/2026-09-29-home-header-date-line.html`).
 * That costs one ~18 px line of Home once, and the date's width stops depending on the weather chip.
 *
 * **Every chip stays `shrink-0`.** BF-96 gave the weather chip `whitespace-nowrap shrink-0`; dropping
 * it restores the two-line wrap it fixed. `overflow-hidden` on the chip row is the floor for a future
 * fourth chip — clipped inside the row rather than spilling across the action buttons.
 *
 * **#2361: the chip row wraps instead of clipping.** The row is 196 px at 384 dp and the sunny-day
 * chips measure 200–209 px (`UV 11` is 208.6), so the last chip lost up to 13 px and its right border.
 * `flex-wrap` lets a chip that does not fit drop to a second line, whole. On every day the chips fit,
 * nothing wraps and the row is unchanged, so this is invisible until the row would otherwise clip —
 * and it holds for any width the weather chip takes, because nothing here is sized to it.
 * `overflow-hidden` stays as the floor for a single chip wider than the column.
 *
 * **The date still truncates**, but now only against the full column, which `EEEE d MMMM` (at most
 * 158.7 px) fits with room to spare.
 */
export function HeaderMetaRow({ tz }: { tz: string }) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0 overflow-hidden">
        <HeaderChips />
      </div>
      <p className="mt-[3px] text-xs text-muted-foreground truncate">
        {formatInTimeZone(new Date(), tz, 'EEEE d MMMM')}
      </p>
    </div>
  )
}
