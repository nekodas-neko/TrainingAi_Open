'use client'

import { useRef } from 'react'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  LinearScale,
  Filler,
  Tooltip,
  type Plugin,
  type ChartData,
  type ChartOptions,
} from 'chart.js'
import type { HrReading, SetMarker } from '@trainingai/shared/workout/hr-analysis'
import { bucketAverage, rollingMedian } from '@trainingai/shared/health/hr-smoothing'
import { resolveColor } from '@trainingai/shared/chart-colors'

ChartJS.register(LineElement, PointElement, LinearScale, Filler, Tooltip)

const TRACE_COLORS = ['#f97316', '#3b82f6', '#a855f7', '#22c55e', '#ef4444', '#eab308']

function exerciseColor(name: string, allNames: string[]): string {
  const idx = allNames.indexOf(name)
  return TRACE_COLORS[idx % TRACE_COLORS.length]
}

interface Props {
  readings: HrReading[]
  sets: SetMarker[]
  sessionStartedAt: Date
}

export function HrRecoveryChart({ readings, sets, sessionStartedAt }: Props) {
  const chartRef = useRef<ChartJS<'line'>>(null)

  const origin = sessionStartedAt.getTime()
  const toMinutes = (d: Date) => (d.getTime() - origin) / 60_000

  const exerciseNames = [...new Set(sets.map(s => s.exerciseName))]

  // 30-second time-bucketed average, then a rolling median over the buckets — dense
  // live-workout HR is spiky (single-bucket jumps to ~130 / dips to ~55), so the median
  // pass removes those outliers while the recovery dips (which span several buckets)
  // survive. 30s buckets keep enough resolution to show each between-set recovery curve.
  const BUCKET_MIN = 0.5
  const bucketed = bucketAverage(readings.map(r => ({ x: toMinutes(r.timestamp), bpm: r.bpm })), BUCKET_MIN)
  const medianed = rollingMedian(bucketed.map(p => p.y), 5)
  const xyData = bucketed.map((p, i) => ({ x: p.x, y: medianed[i] }))

  // Working-set intervals (minutes from origin) for shading. Present only for
  // sessions logged with per-set timing; empty → no bands, just the trace + lines.
  const setBands = sets
    .filter(s => s.setStartMs != null && s.setEndMs != null && s.setEndMs! > s.setStartMs!)
    .map(s => ({
      x0: (s.setStartMs! - origin) / 60_000,
      x1: (s.setEndMs! - origin) / 60_000,
    }))

  const setBandsPlugin: Plugin<'line'> = {
    id: 'setBands',
    // Draw beneath the line/points so bands read as background context.
    beforeDatasetsDraw(chart) {
      const { ctx, scales } = chart
      for (const band of setBands) {
        const xLeft = scales.x.getPixelForValue(band.x0)
        const xRight = scales.x.getPixelForValue(band.x1)
        const clampedLeft = Math.max(xLeft, scales.x.left)
        const clampedRight = Math.min(xRight, scales.x.right)
        if (clampedRight <= clampedLeft) continue
        ctx.save()
        ctx.fillStyle = 'rgba(34, 197, 94, 0.12)'
        ctx.fillRect(clampedLeft, scales.y.top, clampedRight - clampedLeft, scales.y.bottom - scales.y.top)
        ctx.restore()
      }
    },
  }

  const setLinesPlugin: Plugin<'line'> = {
    id: 'setLines',
    afterDraw(chart) {
      const { ctx, scales } = chart
      for (const set of sets) {
        if (!set.loggedAt) continue
        const xMin = toMinutes(set.loggedAt)
        const xPixel = scales.x.getPixelForValue(xMin)
        if (xPixel < scales.x.left || xPixel > scales.x.right) continue
        const color = exerciseColor(set.exerciseName, exerciseNames)
        ctx.save()
        ctx.beginPath()
        ctx.strokeStyle = color
        ctx.lineWidth = 1.5
        ctx.setLineDash([4, 3])
        ctx.moveTo(xPixel, scales.y.top)
        ctx.lineTo(xPixel, scales.y.bottom)
        ctx.stroke()
        ctx.restore()
      }
    },
  }

  const data: ChartData<'line'> = {
    datasets: [{
      data:            xyData,
      borderColor:     'rgb(249 115 22)',
      backgroundColor: 'rgba(249, 115, 22, 0.08)',
      fill:            true,
      tension:         0.45,
      pointRadius:     0,
      borderWidth:     2,
    }],
  }

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: { tooltip: { enabled: false }, legend: { display: false } },
    scales: {
      x: {
        type:  'linear',
        ticks: {
          maxTicksLimit: 6,
          color: resolveColor('var(--color-muted-foreground)'),
          font:  { size: 9 },
          callback: (value) => `${Math.round(Number(value))}m`,
        },
        grid: { color: resolveColor('var(--color-border)') },
      },
      y: {
        grace: '8%',
        ticks: { color: resolveColor('var(--color-muted-foreground)'), font: { size: 9 }, maxTicksLimit: 5 },
        grid:  { color: resolveColor('var(--color-border)') },
      },
    },
  }

  if (readings.length === 0) {
    return (
      <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">
        No heart-rate data — will appear once your ring syncs
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="h-32 w-full">
        <Line ref={chartRef} data={data} options={options} plugins={[setBandsPlugin, setLinesPlugin]} />
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {setBands.length > 0 && (
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="h-2.5 w-4 rounded-sm flex-none" style={{ background: 'rgba(34, 197, 94, 0.35)' }} />
            <span className="text-[10px] text-muted-foreground">Working set</span>
          </div>
        )}
        {exerciseNames.map(name => (
          <div key={name} className="flex items-center gap-1.5 min-w-0">
            <div
              className="h-2.5 w-4 rounded-sm flex-none"
              style={{ background: exerciseColor(name, exerciseNames) }}
            />
            <span className="text-[10px] text-muted-foreground truncate">{name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
