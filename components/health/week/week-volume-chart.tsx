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

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

interface Props {
  /** Seven entries, recap-week Monday first — `metrics.training.byDay`. */
  byDay: { date: string; volumeKg: number; sessions: number }[]
}

/**
 * The week's tonnage, one bar per day (BF-5).
 *
 * The digest already says *"5 sessions, 21,354 kg, +21% on 17,719 kg"*; what it cannot say is which
 * days carried it. That is the owner's *"so it can visually compare the week based on the metrics
 * its talking about"* — the same numbers, drawn.
 *
 * A rest day is a real zero rather than a gap, so the bars are not filtered: the shape of a training
 * week is partly where the gaps fall.
 */
export function WeekVolumeChart({ byDay }: Props) {
  const data = useMemo<ChartData<'bar'>>(() => ({
    labels: DAY_LABELS,
    datasets: [{
      data: byDay.map(d => d.volumeKg),
      backgroundColor: resolveColor('var(--color-brand)'),
      borderRadius: 4,
      maxBarThickness: 28,
    }],
  }), [byDay])

  const options = useMemo<ChartOptions<'bar'>>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        displayColors: false,
        callbacks: {
          // The bar labels are single letters, so the tooltip is where the day is actually named.
          title: (items) => byDay[items[0].dataIndex]?.date ?? '',
          label: (item) => {
            const d = byDay[item.dataIndex]
            if (!d) return ''
            const sets = `${d.sessions} session${d.sessions === 1 ? '' : 's'}`
            return d.volumeKg > 0 ? `${Math.round(d.volumeKg).toLocaleString()} kg · ${sets}` : 'Rest day'
          },
        },
      },
    },
    scales: {
      x: { ticks: { color: resolveColor('var(--muted-foreground)'), font: { size: 10 } }, grid: { display: false } },
      y: {
        beginAtZero: true,
        ticks: {
          color: resolveColor('var(--muted-foreground)'),
          font: { size: 9 },
          maxTicksLimit: 4,
          callback: v => `${Math.round(Number(v) / 1000)}k`,
        },
        grid: { color: resolveColor('var(--border)') },
      },
    },
  }), [byDay])

  return (
    <div className="h-32 w-full">
      <Bar data={data} options={options} />
    </div>
  )
}
