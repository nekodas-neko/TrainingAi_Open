'use client'

import { memo, useMemo } from 'react'
import { buildEnergyTimeline, type HrBucket, type IntakeEvent } from './energy-timeline'

/**
 * Q-414 — energy in against energy out, across the day.
 *
 * Inline SVG rather than chart.js, for two reasons that are both rules here. Canvas paint APIs
 * cannot resolve `var(--x)` and silently render black — that has shipped twice — whereas SVG
 * `stroke`/`fill` take a CSS variable directly, so the chart is theme-aware for free. And chart.js
 * is heavy enough that the repo's own guidance keeps it off screens that matter.
 *
 * The arithmetic lives in `./energy-timeline.ts` where it can be unit-tested; this file only draws.
 */

interface Props {
  dayStartMs: number
  restingHr: number | null
  restingBaseKcal: number
  activeKcal: number
  hr: HrBucket[]
  intake: IntakeEvent[]
}

const W = 100
const H = 46

export const EnergyTimelineChart = memo(function EnergyTimelineChart(
  { dayStartMs, restingHr, restingBaseKcal, activeKcal, hr, intake }: Props,
) {
  const timeline = useMemo(
    () => buildEnergyTimeline({
      dayStartMs,
      // Without a profile there is no elevation to measure against, so the day flattens to BMR
      // shape rather than inventing one.
      restingHr: restingHr ?? Number.POSITIVE_INFINITY,
      restingBaseKcal,
      activeKcal,
      hr,
      intake,
    }),
    [dayStartMs, restingHr, restingBaseKcal, activeKcal, hr, intake],
  )

  const { buckets, totals, hrGapBuckets } = timeline
  const peak = Math.max(totals.intakeKcal, totals.burnKcal, 1)
  const x = (i: number) => (i / (buckets.length - 1)) * W
  const y = (kcal: number) => H - (kcal / peak) * H

  const burnPath = buckets.map((b, i) => `${x(i).toFixed(2)},${y(b.burnCumKcal).toFixed(2)}`).join(' ')
  const intakePath = buckets.map((b, i) => `${x(i).toFixed(2)},${y(b.intakeCumKcal).toFixed(2)}`).join(' ')

  // Bars are the discrete eating events. A line through four meal points would claim the user was
  // eating at 10:30 because the segment passes through it; bars say "here, this much, then nothing".
  const barW = W / buckets.length
  const barPeak = Math.max(...buckets.map(b => b.intakeKcal), 1)

  const eaten = Math.round(totals.intakeKcal)
  const burned = Math.round(totals.burnKcal)
  const net = eaten - burned

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`} width="100%" height={H * 2.2} preserveAspectRatio="none"
        className="block overflow-visible"
        role="img"
        aria-label={`Energy across the day: ${eaten.toLocaleString()} kcal eaten against ${burned.toLocaleString()} burned`}
      >
        {buckets.map((b, i) => b.intakeKcal > 0 && (
          <rect
            key={i}
            x={x(i) - barW / 2} width={barW * 0.8}
            y={H - (b.intakeKcal / barPeak) * H * 0.45}
            height={(b.intakeKcal / barPeak) * H * 0.45}
            fill="var(--accent-green)" opacity={0.55}
          />
        ))}
        <polyline points={burnPath} fill="none" stroke="var(--accent-amber)" strokeWidth={1.4}
          strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={intakePath} fill="none" stroke="var(--accent-green)" strokeWidth={1.4}
          strokeLinejoin="round" strokeLinecap="round" />
      </svg>

      <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
        <span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>12am</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        <Key colour="var(--accent-green)" label={`Eaten ${eaten.toLocaleString()}`} />
        <Key colour="var(--accent-amber)" label={`Burned ${burned.toLocaleString()}`} />
        <span className="text-muted-foreground">
          {net >= 0 ? `+${net.toLocaleString()} surplus` : `${net.toLocaleString()} deficit`}
        </span>
      </div>

      {/*
        The claim this chart is entitled to make, stated rather than implied. The day's totals come
        from the app's one expenditure model; only the *shape* comes from heart rate, and heart rate
        rises for reasons that are not metabolic. Saying so is the difference between a proxy and a
        measurement — and per the repo's colour rule, the two series are told apart by their labels
        above, not by colour alone.
      */}
      <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
        Totals are the day&apos;s figures; the shape comes from your heart rate, which rises for
        reasons other than movement — so treat the timing as an estimate.
        {hrGapBuckets > 0 && ` No heart-rate data for ${hrGapBuckets} ${hrGapBuckets === 1 ? 'hour' : 'hours'}.`}
      </p>
    </div>
  )
})

function Key({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="flex items-center gap-1 text-muted-foreground">
      <span className="h-0.5 w-3 rounded-full" style={{ background: colour }} aria-hidden />
      {label}
    </span>
  )
}
