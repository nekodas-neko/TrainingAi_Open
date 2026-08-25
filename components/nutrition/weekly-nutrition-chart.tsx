'use client'

import { useMemo, useState } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import { EmptyState } from '@/components/ui/empty-state'
import { resolveColor } from '@trainingai/shared/chart-colors'
import { MACRO_COLORS } from '@trainingai/shared/nutrition/macro-colors'
import { useTheme } from 'next-themes'
import type { NutritionAdherenceResponse } from '@/app/api/nutrition/adherence/route'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip)

interface DaySummary {
  date: string
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
}

interface Props {
  data: DaySummary[]
  calorieTarget?: number | null
  adherence?: NutritionAdherenceResponse | null
  /** Drawn as one row of a grouped section rather than as its own card (Q-395b). */
  grouped?: boolean
}

type Metric = 'calories' | 'proteinG' | 'carbsG' | 'fatG'

// Same palette used everywhere else a macro needs a colour (macro-ring, meal-card) —
// calories isn't a macro so it takes the brand/accent token instead of a fourth hex literal.
const METRIC_CONFIG: Record<Metric, { label: string; color: string; unit: string }> = {
  calories: { label: 'Calories', color: 'var(--brand)', unit: 'kcal' },
  proteinG: { label: 'Protein',  color: MACRO_COLORS.protein, unit: 'g' },
  carbsG:   { label: 'Carbs',    color: MACRO_COLORS.carbs, unit: 'g' },
  fatG:     { label: 'Fat',      color: MACRO_COLORS.fat, unit: 'g' },
}

function fmtDayLabel(date: string) {
  const d = new Date(date + 'T12:00:00')
  return d.toLocaleDateString('en-AU', { weekday: 'short' })
}

export function WeeklyNutritionChart({ data, calorieTarget, adherence , grouped}: Props) {
  const [metric, setMetric] = useState<Metric>('calories')
  const { resolvedTheme } = useTheme()
  const cfg = METRIC_CONFIG[metric]

  const labels = data.map(d => fmtDayLabel(d.date))
  const values = data.map(d => d[metric])

  const chartData = useMemo(() => {
    const resolved = resolveColor(cfg.color)
    return {
      labels,
      datasets: [
        {
          label: `${cfg.label} (${cfg.unit})`,
          data: values,
          backgroundColor: values.map((v, i) => {
            if (metric === 'calories' && calorieTarget && i === data.length - 1) {
              return v > calorieTarget ? 'rgba(249,115,22,0.7)' : resolved
            }
            return `${resolved}99`
          }),
          borderColor: resolved,
          borderWidth: 1,
          borderRadius: 6,
        },
      ],
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labels.join(','), values.join(','), metric, calorieTarget, data.length, resolvedTheme])

  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          label: (ctx: any) => `${Math.round(ctx.parsed.y)}${cfg.unit}`,
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: resolveColor('var(--muted-foreground)'), font: { size: 11 } } },
      y: {
        grid: { color: resolveColor('var(--border)') },
        ticks: { color: resolveColor('var(--muted-foreground)'), font: { size: 11 }, maxTicksLimit: 5 },
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [cfg.unit, resolvedTheme])

  return (
    <div className={grouped ? 'p-4' : 'rounded-2xl border border-border p-4'}>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground whitespace-nowrap">7-day nutrition</h3>
        <div className="flex gap-1">
          {(Object.keys(METRIC_CONFIG) as Metric[]).map(m => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={`px-2.5 py-2 min-h-[48px] rounded-full text-xs font-semibold transition-colors ${
                metric === m ? 'font-semibold' : 'bg-muted/50 text-muted-foreground'
              }`}
              // Explicit dark foreground (not a token) — these pill fills are all bright/mid-tone
              // in both themes, matching the R7 amber-CTA precedent for the same contrast reason.
              style={metric === m ? { backgroundColor: METRIC_CONFIG[m].color, color: '#0a0a0a' } : {}}
            >
              {METRIC_CONFIG[m].label}
            </button>
          ))}
        </div>
      </div>
      <div className="h-40">
        {data.length === 0 ? (
          <EmptyState title="No data yet" className="h-full justify-center py-0" />
        ) : (
          <Bar data={chartData} options={options} />
        )}
      </div>
      {metric === 'calories' && calorieTarget && data.length > 0 && (
        <p className="text-[10px] text-muted-foreground mt-2 text-center">
          Target: {calorieTarget} kcal/day · 7-day avg: {Math.round(data.reduce((s, d) => s + d.calories, 0) / data.length)} kcal
        </p>
      )}
      {adherence && adherence.requiredMealTypeCount > 0 && (
        <div className="mt-3 pt-3 border-t border-border/40 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Adherence · last 7 days</span>
            <span className="font-semibold tabular-nums">
              {adherence.adherence7d != null ? `${Math.round(adherence.adherence7d * 100)}%` : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Adherence · last 28 days</span>
            <span className="font-semibold tabular-nums">
              {adherence.adherence28d != null ? `${Math.round(adherence.adherence28d * 100)}%` : '—'}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground">
            % of days every required meal ({adherence.requiredMealTypeCount}) was logged
          </p>
        </div>
      )}
    </div>
  )
}
