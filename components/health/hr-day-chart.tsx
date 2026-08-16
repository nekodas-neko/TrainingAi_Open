'use client'

import { useRef, useMemo } from 'react'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  LinearScale,
  Filler,
  Tooltip,
  type ChartData,
  type ChartOptions,
  type Plugin,
} from 'chart.js'
import { useHeroColorScheme } from './detail-hero'
import type { HrSleepWindow } from '@trainingai/shared/health/hr-sleep-band'
import { bucketAverage } from '@trainingai/shared/health/hr-smoothing'
import { withGapBreaks, interpolateGaps } from './hr-day-chart-gaps'

export { withGapBreaks }

ChartJS.register(LineElement, PointElement, LinearScale, Filler, Tooltip)

interface Reading {
  timestamp: string
  bpm: number
  source: string | null
}

interface TimeWindow { start: number; end: number }

interface WorkoutSession { sessionName: string; startedAt: string; completedAt: string | null }

interface Props {
  readings: Reading[]
  date: string  // YYYY-MM-DD in user's tz
  workoutSessions?: WorkoutSession[]
  compact?: boolean
  showLegend?: boolean
  lineColor?: string
  sleepWindow?: HrSleepWindow | null  // primary sleep interval (minutes-of-day); overrides the source heuristic
  bucketMinutes?: number  // bucket width for smoothing; larger = smoother/less granular line
  showBackfill?: boolean  // opt-in: draw a dashed, clearly-labeled estimated line across real coverage gaps
}

function toMinutes(timestamp: string, midnightMs: number): number {
  return (new Date(timestamp).getTime() - midnightMs) / 60_000
}

// Average readings into N-minute buckets for a smooth line
function toBuckets(readings: Reading[], midnightMs: number, bucketMin = 10): { x: number; y: number }[] {
  return bucketAverage(readings.map(r => ({ x: toMinutes(r.timestamp, midnightMs), bpm: r.bpm })), bucketMin)
}

// Find contiguous source windows (sleep/rest from Oura source field)
// Oura tags individual "rest" readings even for brief stillness, so require
// at least 20 minutes to avoid phantom bands from a few scattered readings.
function findSourceWindows(readings: Reading[], midnightMs: number, sources: string[]): TimeWindow[] {
  const MIN_DURATION = 20
  const result: TimeWindow[] = []
  let start: number | null = null
  let last: number | null = null

  for (const r of readings) {
    const min = toMinutes(r.timestamp, midnightMs)
    const match = r.source != null && sources.includes(r.source)

    if (match) {
      if (start === null) start = min
      last = min
    } else if (start !== null && last !== null && min - last > 15) {
      if (last - start >= MIN_DURATION) result.push({ start, end: last })
      start = null; last = null
    }
  }
  if (start !== null && last !== null && last - start >= MIN_DURATION) result.push({ start, end: last })
  return result
}

// Convert logged workout sessions to minute-offset windows with names
function workoutWindows(sessions: WorkoutSession[], midnightMs: number): (TimeWindow & { name: string })[] {
  return sessions
    .filter(s => s.completedAt != null)
    .map(s => ({
      name:  s.sessionName,
      start: (new Date(s.startedAt).getTime() - midnightMs) / 60_000,
      end:   (new Date(s.completedAt!).getTime() - midnightMs) / 60_000,
    }))
    .filter(w => w.end > w.start)
}


const HOUR_LABELS: Record<number, string> = {
  0: '12am', 360: '6am', 720: '12pm', 1080: '6pm', 1440: '12am',
}

interface WindowDef { window: TimeWindow; fill: string; stroke: string; label: string; name: string }

export function HrDayChart({ readings, date, workoutSessions = [], compact = false, showLegend, lineColor, sleepWindow, bucketMinutes, showBackfill }: Props) {
  const scheme = useHeroColorScheme()
  const isLight = scheme === 'light'
  const windowDefsRef = useRef<WindowDef[]>([])
  const shadingPlugin = useMemo((): Plugin<'line'> => ({
    id: 'windowShading',
    beforeDatasetsDraw(chart) {
      const { ctx, scales } = chart
      const xScale = scales['x'], yScale = scales['y']
      if (!xScale || !yScale) return

      for (const { window: { start, end }, fill } of windowDefsRef.current) {
        const x1 = xScale.getPixelForValue(start)
        const x2 = xScale.getPixelForValue(end)
        ctx.save()
        ctx.fillStyle = fill
        ctx.fillRect(x1, yScale.top, x2 - x1, yScale.bottom - yScale.top)
        ctx.restore()
      }
    },
  }), [])

  if (readings.length === 0) return null

  const [y, m, d] = date.split('-').map(Number)
  const midnightMs = new Date(y, m - 1, d, 0, 0, 0).getTime()

  const smoothed     = toBuckets(readings, midnightMs, bucketMinutes)
  const backfill     = showBackfill ? interpolateGaps(smoothed) : []
  // Prefer the real sleep-session interval (one contiguous overnight block, present
  // whenever the ring recorded sleep). Fall back to the per-reading `source` heuristic
  // only when no sleep session was returned — kept at ['sleep'] (never 'rest') so PR
  // #185's no-daytime-phantom fix is preserved.
  const sleepWindows: TimeWindow[] = sleepWindow
    ? [{ start: sleepWindow.startMin, end: sleepWindow.endMin }]
    : findSourceWindows(readings, midnightMs, ['sleep'])
  const gymWindows   = workoutWindows(workoutSessions, midnightMs)

  const windowDefs: WindowDef[] = [
    ...sleepWindows.map(w => ({ window: w, fill: 'rgba(99,102,241,0.14)', stroke: 'rgba(99,102,241,0.6)', label: 'Sleep',   name: 'Sleep' })),
    ...gymWindows.map(w   => ({ window: w, fill: 'rgba(249,115,22,0.22)', stroke: 'rgba(249,115,22,0.7)', label: 'Workout', name: `Workout: ${w.name}` })),
  ]

  // Keep ref current so the stable plugin always reads the latest windowDefs.
  // react-chartjs-2 only registers plugins at chart creation, not on re-renders.
  windowDefsRef.current = windowDefs

  const resolvedLineColor = lineColor ?? (isLight ? 'rgba(30, 41, 59, 0.7)' : 'rgba(255, 255, 255, 0.75)')
  const backfillColor = isLight ? 'rgba(13, 148, 136, 0.6)' : 'rgba(45, 212, 191, 0.6)'
  // The ring's power-gating leaves real gaps in coverage — render them as visible
  // breaks in the line instead of a fake straight interpolation across missing data.
  const data: ChartData<'line'> = {
    datasets: [
      {
        data:            withGapBreaks(smoothed),
        borderColor:     resolvedLineColor,
        backgroundColor: 'rgba(99, 102, 241, 0.07)',
        pointRadius:     0,
        fill:            true,
        tension:         0.4,
        borderWidth:     2,
        spanGaps:        false,
      },
      // Opt-in estimated backfill — a separate, visually distinct dataset (dashed,
      // straight segments, no fill) so it can never be mistaken for real data.
      ...(backfill.length > 0 ? [{
        data:        backfill,
        borderColor: backfillColor,
        pointRadius: 0,
        fill:        false,
        tension:     0,
        borderWidth: 2,
        borderDash:  [4, 4],
        spanGaps:    false,
      }] : []),
    ],
  }

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: { tooltip: { enabled: false }, legend: { display: false } },
    scales: {
      x: {
        type: 'linear',
        min:  0,
        max:  1440,
        ticks: {
          maxTicksLimit: 6,
          color: isLight ? 'rgb(107 114 128)' : 'rgb(156 163 175)',
          font:  { size: 9 },
          callback: (v) => HOUR_LABELS[Number(v)] ?? '',
          stepSize: 360,
        },
        grid: { color: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)' },
      },
      y: {
        min: smoothed.length > 0 ? Math.max(0, Math.min(...smoothed.map(p => p.y)) - 10) : undefined,
        max: smoothed.length > 0 ? Math.max(...smoothed.map(p => p.y)) + 10 : undefined,
        ticks: { color: isLight ? 'rgb(107 114 128)' : 'rgb(156 163 175)', font: { size: 9 }, maxTicksLimit: 4 },
        grid:  { color: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)' },
      },
    },
  }

  const hasSleep    = sleepWindows.length > 0
  const hasWorkout  = gymWindows.length > 0
  const hasBackfill = backfill.length > 0
  const legendVisible = (showLegend ?? !compact) && (hasSleep || hasWorkout || hasBackfill)

  // compact + legend: flex column so legend sits below chart without overflowing
  const rootClass = compact
    ? legendVisible ? "flex flex-col h-full w-full" : "h-full w-full"
    : "space-y-2"
  const chartClass = compact
    ? legendVisible ? "flex-1 min-h-0" : "h-full w-full"
    : "h-40 w-full"

  return (
    <div className={rootClass}>
      <div className={chartClass}>
        <Line key={gymWindows.length > 0 ? 1 : 0} data={data} options={options} plugins={[shadingPlugin]} />
      </div>
      {legendVisible && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 shrink-0 pt-1">
          {hasSleep && (
            <div className="flex items-center gap-1">
              <div className="w-3 h-2.5 rounded-sm" style={{ background: 'rgba(99,102,241,0.6)' }} />
              <span className="text-[10px] text-muted-foreground">Sleep</span>
            </div>
          )}
          {gymWindows.map((w, i) => (
            <div key={i} className="flex items-center gap-1">
              <div className="w-3 h-2.5 rounded-sm" style={{ background: 'rgba(249,115,22,0.7)' }} />
              <span className="text-[10px] text-muted-foreground">Workout: {w.name}</span>
            </div>
          ))}
          <div className="flex items-center gap-1">
            <div className="w-3 h-0.5 rounded-full" style={{ background: resolvedLineColor }} />
            <span className="text-[10px] text-muted-foreground">Heart Rate</span>
          </div>
          {hasBackfill && (
            <div className="flex items-center gap-1">
              <div className="w-3 h-0.5 rounded-full border-t-2 border-dashed" style={{ borderColor: backfillColor }} />
              <span className="text-[10px] text-muted-foreground">Estimated</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
