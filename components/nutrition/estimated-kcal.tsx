'use client'

import { memo } from 'react'
import { cn } from '@trainingai/shared/utils'

/**
 * #2072 (owner's pick, 2026-10-05: "striped"). Calories the app ASSUMED — a planned meal whose time
 * passed with nothing logged — are part of the day's total, drawn as stripes so they never read as
 * food. One pattern for the ring, the bars and the swatch, so every surface draws the same thing
 * (`docs/design/2026-10-05-estimated-meal-ring.html`).
 */
export const ESTIMATE_STRIPES = 'repeating-linear-gradient(45deg, var(--estimate) 0 2px, transparent 2px 4px)'

/**
 * The line under a calorie ring or bar: "incl. 480 estimated · lunch". Renders nothing when nothing
 * is estimated, which is every day without an active meal plan.
 *
 * `onConfirm` is the tap the design puts here; where a surface has nowhere to send it (a summary
 * card), it is left out and the line only says what is assumed.
 */
export const EstimatedKcalLine = memo(function EstimatedKcalLine({
  estimatedKcal, meals, onConfirm, className = '',
}: {
  estimatedKcal: number | null | undefined
  /** Lower-case meal-type names, already joined ("lunch", "lunch, snack"). */
  meals?: string | null
  onConfirm?: () => void
  className?: string
}) {
  if (estimatedKcal == null || !(estimatedKcal > 0)) return null
  return (
    <div className={cn('flex items-center gap-2 text-[11.5px] text-muted-foreground', className)} data-estimated-kcal={Math.round(estimatedKcal)}>
      <span aria-hidden className="h-2 w-4 flex-none rounded-[2px] opacity-85" style={{ backgroundImage: ESTIMATE_STRIPES }} />
      <span className="min-w-0 flex-1 tabular-nums">
        incl. {Math.round(estimatedKcal).toLocaleString()} estimated{meals ? ` · ${meals}` : ''}
      </span>
      {onConfirm && (
        <button
          type="button"
          onClick={onConfirm}
          className="-my-1.5 flex-none rounded-full bg-foreground/[0.07] px-2.5 py-1.5 text-[11.5px] font-semibold text-foreground"
        >
          Confirm
        </button>
      )}
    </div>
  )
})

/**
 * The ring's assumed arc: stripes between `fromDeg` and `toDeg` (0 = 12 o'clock, clockwise, the CSS
 * conic convention), inside the caller's ring mask. Two nested masks rather than one composited
 * mask: the outer element cuts the ring, the inner one the wedge, so no `mask-composite` (which the
 * Samsung WebView has handled unevenly) is needed.
 */
export const StripedRingArc = memo(function StripedRingArc({
  fromDeg, toDeg, ringMask,
}: {
  fromDeg: number
  toDeg: number
  ringMask: string
}) {
  if (!(toDeg > fromDeg)) return null
  const wedge = `conic-gradient(transparent ${fromDeg}deg, black ${fromDeg}deg ${toDeg}deg, transparent ${toDeg}deg)`
  return (
    <div className="absolute inset-0 rounded-full" style={{ WebkitMask: ringMask, mask: ringMask }} data-estimated-arc={`${fromDeg.toFixed(1)}-${toDeg.toFixed(1)}`}>
      <div className="absolute inset-0 opacity-85" style={{ backgroundImage: ESTIMATE_STRIPES, WebkitMask: wedge, mask: wedge }} />
    </div>
  )
})
