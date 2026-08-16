'use client'

import { cn } from '@trainingai/shared/utils'

/**
 * Page indicators for a swipeable carousel.
 *
 * Extracted because three call sites had this markup byte-identical (the session carousel, the
 * guided-walk preset carousel, the run-type carousel) and all three shipped the same defect: a
 * 7×7 px tap target, because `tap-dense` opts out of the global 48px floor and nothing put a touch
 * area back.
 *
 * The dot stays 7px of ink. `tap-target-dot` gives it a 24×44 invisible box, and the row is spaced
 * so those boxes do not overlap — a hit area wider than the pitch means the sibling painted last
 * swallows taps meant for the ones before it.
 */

/** Centre-to-centre spacing. 24px so neighbouring 24px-wide hit areas meet without overlapping,
 *  which is also what WCAG 2.5.8 AA's spacing exception measures. */
export const CAROUSEL_DOT_PITCH_PX = 24

const DOT_WIDTH_PX = 7
const ACTIVE_DOT_HEIGHT_PX = 20

export interface CarouselDotsProps {
  count: number
  activeIndex: number
  onSelect: (index: number) => void
  /** Accessible name per dot — a carousel dot with no name announces as "button". */
  label: (index: number) => string
  /** Colour of the active dot. Any CSS colour; pass a theme token, never a hex literal. */
  activeColor: string
  /** Colour of an inactive dot. A function so a caller can mark one as recommended. */
  inactiveColor: (index: number) => string
  disabled?: boolean
  className?: string
}

export function CarouselDots({
  count, activeIndex, onSelect, label, activeColor, inactiveColor, disabled, className,
}: CarouselDotsProps) {
  if (count <= 0) return null
  return (
    <div
      className={cn('flex justify-center items-center', className)}
      style={{ gap: CAROUSEL_DOT_PITCH_PX - DOT_WIDTH_PX }}
    >
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          aria-label={label(i)}
          aria-pressed={i === activeIndex}
          disabled={disabled}
          onClick={() => onSelect(i)}
          // tap-dense opts out of the global 48px floor, which would inflate these into big
          // circles; tap-target-dot puts a usable touch area back without changing the ink.
          className="tap-dense tap-target-dot rounded-full transition-all duration-200"
          style={{
            width: DOT_WIDTH_PX,
            height: i === activeIndex ? ACTIVE_DOT_HEIGHT_PX : DOT_WIDTH_PX,
            background: i === activeIndex ? activeColor : inactiveColor(i),
          }}
        />
      ))}
    </div>
  )
}
