'use client'

import { useMemo } from 'react'
import { useUserTimezone } from '@/components/shell/user-timezone-provider'
import { toSegments, coveredMinutes, type StressBucket } from './stress-day'

/**
 * A day's stress against a clock (TN-3b).
 *
 * The owner: *"Can we have this displayed on a widget or chart so we can see when the stress occurs.
 * I will be able to match it up based on time to what I was doing around then."* The sparkline in
 * `stress-strip.tsx` shows the shape and **cannot answer "when"**, which is the whole request — so
 * this is a time axis, not a prettier sparkline, and the two live side by side.
 *
 * **No score, no verdict, no advice, deliberately.** Q-507 — whether this metric's sign means what
 * it claims — is open, and TN-33 established there is no independent target with variance to settle
 * it against (`perceived_recovery` reads 3 on all 17 days). The owner's own recall is the ground
 * truth, so this draws the measured series and says nothing about it. A chart that makes no claim
 * cannot make a wrong one, and that is exactly what keeps it shippable while the question is open.
 * **TN-16's warning and prompt stay parked; do not grow them here.**
 *
 * **Night is shaded because it is structurally positive, not because sleep is restful.** Measured
 * over 478 buckets: 22:00–06:00 is 57% of all buckets at mean **+0.266**, against **−0.405** for
 * 07:00–21:00. Unbanded, a reader takes the nightly rise as a judgement about their sleep rather
 * than a property of the series — and it is the same asymmetry that drags the daily scalar to −0.02
 * on a day whose whole working morning ran past −0.5.
 */
const NIGHT_START_MIN = 22 * 60
const NIGHT_END_MIN = 6 * 60

/** Level ∈ [−1,+1]; the axis is drawn stress-upward, so a spike means more stress. */
const LEVEL_MAX = 1

const VIEW_W = 1440   // one unit per minute, so x IS the time
const VIEW_H = 200
const PAD_TOP = 8
const PLOT_H = VIEW_H - PAD_TOP * 2

/** Where a level sits vertically, flipped so stressed (negative level) is high on the chart. */
function y(level: number): number {
  return PAD_TOP + ((LEVEL_MAX - -level) / (LEVEL_MAX * 2)) * PLOT_H
}

const HOUR_TICKS = [0, 6, 12, 18, 24]

export function StressDayChart({ buckets }: { buckets: StressBucket[] }) {
  const tz = useUserTimezone()
  const segments = useMemo(() => toSegments(buckets, tz), [buckets, tz])
  const covered = useMemo(() => coveredMinutes(segments), [segments])

  if (segments.length === 0) return null

  const amber = 'var(--accent-amber)'
  const coveredHours = Math.round((covered / 60) * 10) / 10

  return (
    <div className="space-y-1">
      <div className="flex items-baseline gap-2">
        <p className="flex-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          When today ran stressed
        </p>
        {/* The coverage figure is not decoration. The ring stops sampling when you are still, so a
            day holds 13 hours of readings on average — printing it stops a sparse day reading as a
            complete one. */}
        <p className="text-[10px] tabular-nums text-muted-foreground">{coveredHours} h measured</p>
      </div>

      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="h-24 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Stress by time of day, ${coveredHours} hours measured`}
      >
        {/* Night, both halves — the series wraps midnight and one rect cannot span it. */}
        <rect x={0} y={0} width={NIGHT_END_MIN} height={VIEW_H} fill="var(--muted)" opacity={0.75} />
        <rect x={NIGHT_START_MIN} y={0} width={VIEW_W - NIGHT_START_MIN} height={VIEW_H} fill="var(--muted)" opacity={0.75} />

        {/* Zero, and the ±0.5 bands, so "high" is visible from the shape rather than only a label. */}
        <line x1={0} x2={VIEW_W} y1={y(0)} y2={y(0)} stroke="var(--border)" strokeWidth={2} />
        {[0.5, -0.5].map(lvl => (
          <line
            key={lvl}
            x1={0} x2={VIEW_W} y1={y(lvl)} y2={y(lvl)}
            stroke="var(--border)" strokeWidth={1} strokeDasharray="6 10" opacity={0.7}
          />
        ))}

        {/* One path per measured run. A gap is drawn by there being nothing there. */}
        {segments.map((seg, i) => (
          <polyline
            key={i}
            points={seg.map(p => `${p.x},${y(p.level)}`).join(' ')}
            fill="none"
            stroke={amber}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            // The viewBox is stretched to the container, so a plain stroke would be drawn wider
            // than it is tall. This keeps it even at any width.
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {/* A run of one has no line to draw, and dropping it would hide a real reading. */}
        {segments.filter(s => s.length === 1).map((seg, i) => (
          <circle key={`dot-${i}`} cx={seg[0].x} cy={y(seg[0].level)} r={3} fill={amber} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>

      <div className="flex justify-between text-[9px] tabular-nums text-muted-foreground">
        {/* The last tick is `24:00`, not a second `00:00` — one axis carrying the same label at
            both ends is ambiguous about which way it runs. */}
        {HOUR_TICKS.map(h => <span key={h}>{String(h).padStart(2, '0')}:00</span>)}
      </div>

      {/* **The gridlines are meaningless without this, which the screenshot is what showed.** The
          drawn chart is an amber line between three unlabelled rules: a reader can see *when*
          something happened and cannot see *what*. Naming the upper line and the shading is the
          difference between a shape and a reading.

          It stays a description of the axis, not a verdict on the day — `−0.5` is the same
          threshold the strip above already calls "High", so the two agree rather than the chart
          inventing a second vocabulary. Nothing here says whether the day was good. */}
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Higher means more stress; above the top line is what the reading above calls
        <span className="font-semibold"> High</span>. Shaded hours are overnight, which runs
        positive for everyone. Blank stretches are hours the ring did not record.
      </p>
    </div>
  )
}
