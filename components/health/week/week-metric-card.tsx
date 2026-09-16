'use client'

import { useMemo } from 'react'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from 'chart.js'
import { resolveColor } from '@trainingai/shared/chart-colors'
import type { WeekOverWeek } from '@trainingai/shared/health/weekly-digest-metrics'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip)

interface Props {
  label: string
  metric: WeekOverWeek
  unit?: string
  /** Digits after the point for the headline figure. Sleep hours want one; a score wants none. */
  decimals?: number
  /** Whether a RISE is the good direction. Stress is the one that is not. */
  higherIsBetter?: boolean
  /** Shown under the label when the value's provenance matters — HRV's instrument, for instance. */
  note?: string | null
}

function fmt(v: number | null, decimals: number): string {
  return v == null ? '—' : v.toFixed(decimals)
}

/**
 * One metric's week, against the week before it (BF-5).
 *
 * The headline pair is the comparison the digest makes in prose (*"readiness 66/100 down from 71"*);
 * the line under it is the seven days that average to it, which is the part a paragraph cannot
 * carry. `byDay` values are nullable — an unmeasured day is a gap, not a zero, so the line spans it
 * rather than diving to the axis and inventing a bad night.
 *
 * **The delta is not coloured on its own.** A change carries an arrow and a word, because direction
 * as colour alone is not state (CLAUDE.md), and because `higherIsBetter` is false for stress: the
 * same green for "up" would read as good on the one metric where it is not.
 */
export function WeekMetricCard({ label, metric, unit = '', decimals = 0, higherIsBetter = true, note }: Props) {
  const points = metric.byDay
  const values = points.map(p => p.value)
  const hasAny = values.some(v => v != null)

  const data = useMemo<ChartData<'line'>>(() => ({
    labels: points.map(p => p.date.slice(5)),
    datasets: [{
      data: values as (number | null)[],
      borderColor: resolveColor('var(--color-brand)'),
      backgroundColor: resolveColor('var(--color-brand)'),
      borderWidth: 2,
      pointRadius: 2,
      tension: 0.3,
      spanGaps: true,
    }],
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [points])

  const options = useMemo<ChartOptions<'line'>>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        displayColors: false,
        callbacks: {
          title: items => points[items[0].dataIndex]?.date ?? '',
          label: item => (item.parsed.y == null ? 'No reading' : `${item.parsed.y}${unit}`),
        },
      },
    },
    scales: { x: { display: false }, y: { display: false } },
  }), [points, unit])

  const { week, priorWeek } = metric
  const delta = week != null && priorWeek != null ? week - priorWeek : null
  const rose = delta != null && delta > 0
  const flat = delta != null && Math.abs(delta) < Number.EPSILON
  const good = delta == null || flat ? null : rose === higherIsBetter

  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {note && <p className="text-[10px] text-muted-foreground/80">{note}</p>}
      <p className="mt-0.5 text-xl font-bold tabular-nums">
        {fmt(week, decimals)}
        {week != null && unit && <span className="ml-0.5 text-xs font-normal text-muted-foreground">{unit}</span>}
      </p>
      {delta == null ? (
        <p className="text-[11px] text-muted-foreground">
          {priorWeek == null ? 'No week before this one' : 'Not measured this week'}
        </p>
      ) : (
        <p
          className={`text-[11px] tabular-nums ${good === null ? 'text-muted-foreground' : good ? 'text-green-500' : 'text-amber-500'}`}
        >
          {flat ? 'Level with' : `${rose ? '↑' : '↓'} ${Math.abs(delta).toFixed(decimals)}${unit} on`} {fmt(priorWeek, decimals)}
        </p>
      )}
      {hasAny && (
        <div className="mt-2 h-10 w-full">
          <Line data={data} options={options} />
        </div>
      )}
    </div>
  )
}
