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
import { HR_ZONE_META } from '@trainingai/shared/health/hr-zones'
import type { WeeklyZoneStack } from '@trainingai/shared/health/cardio-trends'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip)

interface Props {
  weeks: WeeklyZoneStack[]
}

export function ZoneStackChart({ weeks }: Props) {
  const data = useMemo<ChartData<'bar'>>(() => ({
    labels: weeks.map((w) => w.weekStart.slice(5)), // MM-DD
    datasets: HR_ZONE_META.map((zone) => ({
      label: `Z${zone.id} ${zone.name}`,
      data: weeks.map((w) => Math.round(w.seconds[zone.id - 1] / 60)),
      backgroundColor: zone.color,
      stack: 'zones',
    })),
  }), [weeks])

  if (weeks.length === 0) return null

  return (
    <div className="h-40 w-full">
      <Bar
        data={data}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: { legend: { display: false }, tooltip: { enabled: true, mode: 'index', intersect: false } },
          scales: {
            x: { stacked: true, ticks: { color: resolveColor('var(--muted-foreground)'), font: { size: 9 } }, grid: { display: false } },
            y: { stacked: true, ticks: { color: resolveColor('var(--muted-foreground)'), font: { size: 9 }, maxTicksLimit: 4 }, grid: { color: resolveColor('var(--border)') } },
          },
        }}
      />
    </div>
  )
}
