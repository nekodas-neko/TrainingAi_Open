'use client'

import { useMemo } from 'react'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  type ChartData,
} from 'chart.js'
import { resolveColor } from '@trainingai/shared/chart-colors'
import type { EfficiencyPoint } from '@trainingai/shared/health/cardio-trends'

ChartJS.register(LineElement, PointElement, CategoryScale, LinearScale, Tooltip)

interface Props {
  points: EfficiencyPoint[]
}

export function EfficiencyChart({ points }: Props) {
  const data = useMemo<ChartData<'line'>>(() => ({
    labels: points.map((p) => p.date.slice(5)),
    datasets: [
      {
        label: 'Avg HR',
        data: points.map((p) => p.avgHr),
        borderColor: 'rgba(239, 68, 68, 0.85)',
        backgroundColor: 'transparent',
        yAxisID: 'y',
        pointRadius: 2,
        tension: 0.3,
      },
      {
        label: 'Avg pace (sec/km)',
        data: points.map((p) => p.avgPaceSecPerKm),
        borderColor: resolveColor('var(--color-brand)'),
        backgroundColor: 'transparent',
        yAxisID: 'y1',
        pointRadius: 2,
        tension: 0.3,
      },
    ],
  }), [points])

  if (points.length === 0) return null

  return (
    <div className="h-40 w-full">
      <Line
        data={data}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: { legend: { display: false }, tooltip: { enabled: true, mode: 'index', intersect: false } },
          scales: {
            x: { ticks: { color: resolveColor('var(--muted-foreground)'), font: { size: 9 } }, grid: { display: false } },
            y: { position: 'left', ticks: { color: 'rgba(239, 68, 68, 0.85)', font: { size: 9 }, maxTicksLimit: 4 }, grid: { display: false } },
            y1: {
              position: 'right',
              reverse: true, // faster pace (lower sec/km) reads as "up", matching the pace bar chart's convention
              ticks: { color: resolveColor('var(--color-brand)'), font: { size: 9 }, maxTicksLimit: 4 },
              grid: { color: resolveColor('var(--border)') },
            },
          },
        }}
      />
      <p className="mt-1 text-center text-[10px] text-muted-foreground">
        Falling HR at a similar (or faster) pace over time means better aerobic efficiency.
      </p>
    </div>
  )
}
