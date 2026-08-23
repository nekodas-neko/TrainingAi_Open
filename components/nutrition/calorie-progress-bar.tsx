'use client'

import { memo } from 'react'
import { barProgress } from '@trainingai/shared/nutrition/calorie-balance'

/**
 * The day's calories as a bar you walk to the end of (Q-323).
 *
 * Replaces the five-band gauge with a marker. The track ramps red → amber → green → amber → red
 * with the green at the goal notch and a short tail past it; the fill is that same gradient clipped
 * to today's intake, so it "takes the colour of the band it currently ends in" without a second
 * colour decision that could disagree with the zone label beside it.
 *
 * Scalar props on purpose (Q-490): `memo` compares shallowly and this renders inside Home's card
 * switch, where an object literal would defeat it silently.
 */
export const CalorieProgressBar = memo(function CalorieProgressBar({
  intakeKcal, budgetKcal, height = 'h-2',
}: {
  intakeKcal: number
  budgetKcal: number
  /** Tailwind height class — Home's cards are denser than the Nutrition tab's. */
  height?: string
}) {
  const { fillPct, notchPct, stops } = barProgress({ intakeKcal, budgetKcal })
  const gradient = `linear-gradient(to right, ${stops.map(s => `${s.color} ${(s.pct * 100).toFixed(2)}%`).join(', ')})`
  const fillWidth = fillPct * 100

  return (
    <div
      className={`relative w-full overflow-hidden rounded-full ${height}`}
      role="presentation"
      // Geometry, not pixels: a spec can pin what the bar MEANS without pinning how it looks.
      data-calorie-bar
      data-fill-pct={fillWidth.toFixed(2)}
      data-notch-pct={(notchPct * 100).toFixed(2)}
    >
      {/* The road ahead: a neutral base so an empty bar reads as empty, with the ramp faint on top
          so you can see where green is before you get there. At the 0.28 it started on, an empty
          bar read as a FULL pink one — the track has to stay quieter than the fill. */}
      <div className="absolute inset-0 bg-muted" />
      <div className="absolute inset-0" style={{ backgroundImage: gradient, opacity: 0.16 }} />
      {/* The same ramp at full strength, clipped to today's intake. `backgroundSize` keeps the
          gradient spanning the WHOLE track rather than being squeezed into the fill, which is what
          makes the fill's leading edge the true colour for that position. */}
      {fillWidth > 0 && (
        <div
          className="absolute inset-y-0 left-0 transition-[width] duration-500 ease-out motion-reduce:transition-none"
          style={{
            width: `${fillWidth}%`,
            backgroundImage: gradient,
            backgroundSize: `${(100 / fillPct).toFixed(2)}% 100%`,
            backgroundRepeat: 'no-repeat',
          }}
        />
      )}
      {/* The goal. A notch rather than a label: the number it stands for is already printed above. */}
      <div
        className="absolute inset-y-0 w-px"
        style={{ left: `${(notchPct * 100).toFixed(2)}%`, backgroundColor: 'var(--foreground)', opacity: 0.55 }}
      />
    </div>
  )
})
