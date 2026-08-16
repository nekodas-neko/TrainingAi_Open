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
} from 'chart.js'
import { resolveColor } from '@trainingai/shared/chart-colors'
import type { CadenceTrendPoint } from '@trainingai/shared/health/cardio-trends'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip)

interface Props {
  points: CadenceTrendPoint[]
}

export function CadenceTrendChart({ points }: Props) {
  const data = useMemo<ChartData<'bar'>>(() => ({
    labels: points.map((p) => p.date.slice(5)),
    datasets: [{
      data: points.map((p) => p.cadenceSpm),
      backgroundColor: resolveColor('var(--color-brand)'),
      borderRadius: 4,
      maxBarThickness: 18,
    }],
  }), [points])

  if (points.length === 0) return null

  return (
    <div className="h-40 w-full">
      <Bar
        data={data}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: { legend: { display: false }, tooltip: { enabled: true } },
          scales: {
            x: { ticks: { color: resolveColor('var(--muted-foreground)'), font: { size: 9 } }, grid: { display: false } },
            y: { ticks: { color: resolveColor('var(--muted-foreground)'), font: { size: 9 }, maxTicksLimit: 4 }, grid: { color: resolveColor('var(--border)') } },
          },
        }}
      />
    </div>
  )
}
