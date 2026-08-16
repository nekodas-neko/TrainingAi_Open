'use client'

import { useMemo } from 'react'
import { Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from 'chart.js'
import { resolveColor } from '@trainingai/shared/chart-colors'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip)

interface Split {
  km: number
  paceSec: number
}

interface Props {
  splits: Split[]
  bestEfforts?: Record<string, number>
}

function formatPace(secPerKm: number): string {
  return `${Math.floor(secPerKm / 60)}:${String(Math.round(secPerKm % 60)).padStart(2, '0')}`
}

const BEST_EFFORT_LABELS: Record<string, string> = { '1km': 'Fastest 1km', '5km': 'Fastest 5km' }

export function PaceBarChart({ splits, bestEfforts }: Props) {
  const chartData = useMemo<ChartData<'bar'>>(() => ({
    labels: splits.map(s => `${s.km}`),
    datasets: [{
      data: splits.map(s => s.paceSec),
      backgroundColor: resolveColor('var(--color-brand)'),
      borderRadius: 4,
    }],
  }), [splits])

  if (splits.length === 0) return null

  const options: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    scales: {
      x: {
        ticks: { color: resolveColor('var(--muted-foreground)'), font: { size: 9 } },
        grid: { display: false },
      },
      y: {
        reverse: true, // faster pace (lower sec/km) reads as a taller bar
        ticks: {
          color: resolveColor('var(--muted-foreground)'),
          font: { size: 9 },
          maxTicksLimit: 4,
          callback: v => formatPace(Number(v)),
        },
        grid: { color: resolveColor('var(--border)') },
      },
    },
  }

  const efforts = Object.entries(bestEfforts ?? {})

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pace per km</p>
      <div className="h-28 w-full">
        <Bar data={chartData} options={options} />
      </div>
      {efforts.length > 0 && (
        <div className="grid grid-cols-2 gap-2 text-center">
          {efforts.map(([key, paceSec]) => (
            <div key={key} className="rounded-xl bg-muted px-2 py-2">
              <p className="text-sm font-bold tabular-nums">{formatPace(paceSec)} /km</p>
              <p className="text-[10px] text-muted-foreground">{BEST_EFFORT_LABELS[key] ?? key}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
