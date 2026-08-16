'use client'

import { useMemo } from 'react'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from 'chart.js'
import { resolveColor } from '@trainingai/shared/chart-colors'
import type { ElevationPoint } from '@/lib/activity/activity-metrics'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip)

interface Props {
  profile: ElevationPoint[]
}

export function ElevationProfileChart({ profile }: Props) {
  const chartData = useMemo<ChartData<'line'>>(() => ({
    labels: profile.map(p => p.distKm.toFixed(1)),
    datasets: [{
      data: profile.map(p => p.eleM),
      borderColor: resolveColor('var(--color-brand)'),
      backgroundColor: resolveColor('var(--color-brand)'),
      fill: true,
      pointRadius: 0,
      borderWidth: 1.75,
      tension: 0.3,
    }],
  }), [profile])

  if (profile.length < 2) return null

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    scales: {
      x: {
        ticks: { color: resolveColor('var(--muted-foreground)'), font: { size: 9 }, maxTicksLimit: 5 },
        grid: { display: false },
      },
      y: {
        ticks: {
          color: resolveColor('var(--muted-foreground)'),
          font: { size: 9 },
          maxTicksLimit: 4,
          callback: v => `${v}m`,
        },
        grid: { color: resolveColor('var(--border)') },
      },
    },
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Elevation</p>
      <div className="h-28 w-full">
        <Line data={chartData} options={options} />
      </div>
    </div>
  )
}
