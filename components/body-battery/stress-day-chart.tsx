'use client'

import { useMemo } from 'react'
import { useUserTimezone } from '@/components/shell/user-timezone-provider'
import { useStressDay } from '@/lib/hooks/use-stress-day'
import { todayInTz, msToHHMMInTz } from '@trainingai/shared/date-utils'
import { toSegments, coveredMinutes } from './stress-day'

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
 *
 * **It reads the STORED series, today included, and that is the point of LA-104.** The rollup writes
 * `oura_daytime_stress_buckets` from `latest.rhrLowBpm` + `nightHrvMs`; `/api/body-battery` computes
 * a live series of its own from `restingHr` + a 28-day HRV mean. They are not the same number —
 * measured in production over the eight days that had both, the sign differed on **6** and
 * high-stress minutes by **4–8×**. Drawing today from the live one and a past day from storage
 * would put two metrics on one axis, in exactly the dimension the owner's pass test compares:
 * *"open a past day, read a stressed window off the axis, and say whether it matches what you were
 * doing."* So every day comes from `/api/body-battery/stress-day`, one baseline.
 *
 * The cost is real and is stated on the chart rather than hidden: today's stored series ends at the
 * last rollup, not at this minute, which is what `throughMs` is printed for.
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

/**
 * @param date `YYYY-MM-DD`; omit for today. The day screen passes the day it is showing — which is
 *   what makes the entry's pass test runnable, since comparing days needs a past day to open.
 * @param className extra classes on the ROOT, so a caller can frame it as a card. It has to be on
 *   the root rather than a wrapper at the call site: this renders nothing on a day with no readings,
 *   and a wrapper would leave an empty frame behind.
 */
export function StressDayChart({ date, className }: { date?: string; className?: string } = {}) {
  const tz = useUserTimezone()
  const today = todayInTz(tz)
  const day = date ?? today
  // The key, URL and TTL moved into `useStressDay` when the HR chart became a second reader
  // (TN-3b) — three things that have to agree across call sites, now stated once.
  const { data, failed } = useStressDay(day)

  const series = data?.series
  const segments = useMemo(() => toSegments(series ?? [], tz), [series, tz])
  const covered = useMemo(() => coveredMinutes(segments), [segments])

  // `cachedFetch` swallows `!res.ok`, this route's own rate limit included — without this the chart
  // would vanish on a failed request and read as "no stress recorded".
  if (failed && !data) {
    return (
      <div className={className}>
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Couldn&apos;t load when the stress happened. Pull down to retry.
        </p>
      </div>
    )
  }
  if (segments.length === 0) return null

  const amber = 'var(--accent-amber)'
  const coveredHours = Math.round((covered / 60) * 10) / 10

  return (
    <div className={className ? `space-y-1 ${className}` : 'space-y-1'}>
      <div className="flex items-baseline gap-2">
        <p className="flex-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {day === today ? 'When today ran stressed' : 'When the day ran stressed'}
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

      {/* Where the day's data stops, so a chart that runs out at lunchtime does not read as a
          calm afternoon. 24-hour to match the axis above it. */}
      {data?.throughMs != null && (
        <p className="text-[10px] tabular-nums text-muted-foreground">
          Measured through <span className="font-semibold text-foreground">{msToHHMMInTz(data.throughMs, tz)}</span> —
          the last reading stored, not the end of your day.
        </p>
      )}

      {/* **The gridlines are meaningless without this, which the screenshot is what showed.** The
          drawn chart is an amber line between three unlabelled rules: a reader can see *when*
          something happened and cannot see *what*. Naming the upper line and the shading is the
          difference between a shape and a reading.

          It stays a description of the axis, not a verdict on the day — `−0.5` is the same
          threshold `stress-strip.tsx` calls "High", so the two agree rather than the chart
          inventing a second vocabulary. Nothing here says whether the day was good.

          It names the threshold itself rather than pointing at "the reading above": the strip is
          only above this on the Home card, and on the day screen there is nothing there. */}
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Higher means more stress; above the top line counts as
        <span className="font-semibold"> High</span>. Shaded hours are overnight, which runs
        positive for everyone. Blank stretches are hours the ring did not record.
      </p>
    </div>
  )
}
