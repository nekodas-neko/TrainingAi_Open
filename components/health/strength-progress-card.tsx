'use client'

import { memo, useEffect, useState } from 'react'
import { Dumbbell } from 'lucide-react'
import { cachedFetch, readCacheSync } from '@/lib/sqlite/cache'
import { TTL_MEDIUM } from '@trainingai/shared/cache-ttl'
import { accentCardStyle } from '@trainingai/shared/utils'
import { computeBarMetric, type BarMetric, type StrengthMode } from '@trainingai/shared/health/strength-progress'
import type { ExerciseSummary } from '@/app/api/weights-summary/route'

interface SummaryData {
  exercises: ExerciseSummary[]
  phaseName: string | null
  cycleLabel: string | null
}

const PCT_MARKERS = [60, 70, 80]

// 'same' is deliberately absent — the render guards `trend !== 'same'`, so an entry here would be
// dead, and the one that used to sit here was a white literal invisible on a light background.
const TREND_COLOR: Record<string, string> = {
  up: '#22c55e',
  down: '#f87171',
}

export const StrengthProgressCard = memo(function StrengthProgressCard() {
  const [data, setData] = useState<SummaryData>({ exercises: [], phaseName: null, cycleLabel: null })
  const [mode, setMode] = useState<StrengthMode>('working')

  useEffect(() => {
    const cached = readCacheSync<SummaryData>('weights-summary')
    if (cached) setData({ exercises: cached.exercises ?? [], phaseName: cached.phaseName ?? null, cycleLabel: cached.cycleLabel ?? null })
    cachedFetch<SummaryData>(
      'weights-summary', '/api/weights-summary', TTL_MEDIUM,
      d => setData({ exercises: d?.exercises ?? [], phaseName: d?.phaseName ?? null, cycleLabel: d?.cycleLabel ?? null }),
    ).catch(() => {})
  }, [])

  const withData = data.exercises.filter(e => e.estimated1rm != null)
  if (withData.length === 0) return null

  let lastSessionName: string | null = null
  let mostRecentDate: string | null = null
  for (const ex of withData) {
    if (ex.date && (!mostRecentDate || ex.date > mostRecentDate)) {
      mostRecentDate = ex.date
      lastSessionName = ex.sessionName
    }
  }

  const sessionOrder: string[] = []
  const bySession = new Map<string, ExerciseSummary[]>()
  for (const ex of withData) {
    if (!bySession.has(ex.sessionName)) {
      bySession.set(ex.sessionName, [])
      sessionOrder.push(ex.sessionName)
    }
    bySession.get(ex.sessionName)!.push(ex)
  }

  return (
    <div className="rounded-2xl p-4" style={accentCardStyle('#bf5fff')}>
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <Dumbbell className="h-4 w-4" style={{ color: '#bf5fff' }} />
          <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Estimated 1RM</h3>
        </div>
        {/* Mode toggle */}
        <div className="flex items-center rounded-lg overflow-hidden text-[10px] font-semibold bg-muted">
          <button
            type="button"
            onClick={() => setMode('working')}
            className="px-2.5 py-1 transition"
            style={mode === 'working' ? { background: 'rgba(191,95,255,0.25)', color: '#bf5fff' } : { color: 'var(--muted-foreground)' }}
          >
            Sets
          </button>
          <button
            type="button"
            onClick={() => setMode('latest')}
            className="px-2.5 py-1 transition"
            style={mode === 'latest' ? { background: 'rgba(191,95,255,0.25)', color: '#bf5fff' } : { color: 'var(--muted-foreground)' }}
          >
            1RM
          </button>
        </div>
      </div>

      {/* Phase + last session meta */}
      <div className="flex items-center gap-2 mb-4 min-h-[18px]">
        {data.phaseName && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md" style={{ background: 'rgba(191,95,255,0.15)', color: '#bf5fff' }}>
            {data.phaseName}{data.cycleLabel ? ` · ${data.cycleLabel}` : ''}
          </span>
        )}
        {lastSessionName && (
          <span className="text-[10px] text-muted-foreground">
            Last: <span className="font-medium text-foreground/70">{lastSessionName}</span>
          </span>
        )}
      </div>

      <div className="space-y-5">
        {sessionOrder.map(sessionName => {
          const rows: { ex: ExerciseSummary; metric: BarMetric }[] = []
          for (const ex of bySession.get(sessionName)!) {
            const metric = computeBarMetric(ex, mode)
            if (metric) rows.push({ ex, metric })
          }
          if (rows.length === 0) return null

          return (
            <div key={sessionName}>
              <h3 className="text-[10px] font-semibold uppercase tracking-wide mb-3" style={{ color: '#bf5fff' }}>
                {sessionName}
              </h3>
              <div className="space-y-4">
                {rows.map(({ ex, metric }) => (
                  <div key={ex.exercise} className="flex items-center gap-3">
                    <p className="text-xs flex-1 truncate">{ex.exercise}</p>

                    {/* Bar with percentage labels + fill */}
                    <div className="relative flex-none" style={{ width: '7rem' }}>
                      {/* Percentage labels */}
                      <div className="relative" style={{ height: '11px' }}>
                        {PCT_MARKERS.map(pct => (
                          <span
                            key={pct}
                            className="absolute bottom-0 select-none"
                            style={{
                              left: `${pct}%`,
                              transform: 'translateX(-50%)',
                              fontSize: '7px',
                              lineHeight: 1,
                              color: 'var(--muted-foreground)',
                              fontWeight: 700,
                              letterSpacing: '-0.02em',
                            }}
                          >
                            {pct}
                          </span>
                        ))}
                      </div>
                      {/* Bar track */}
                      <div className="relative" style={{ height: '6px' }}>
                        {PCT_MARKERS.map(pct => (
                          <div
                            key={pct}
                            className="absolute inset-y-0 pointer-events-none"
                            style={{ left: `${pct}%`, borderLeft: '1px dashed var(--border)' }}
                          />
                        ))}
                        <div className="w-full h-full rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-300"
                            style={{ width: `${Math.max(metric.pct, 4)}%`, background: metric.color }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* 1RM value + trend delta */}
                    <div className="flex-none w-16 text-right">
                      <p className="text-xs font-bold tabular-nums leading-tight">{metric.label}</p>
                      {metric.trend != null && metric.trend !== 'same' && metric.delta != null && (
                        <p
                          className="text-[9px] font-semibold tabular-nums leading-tight"
                          style={{ color: TREND_COLOR[metric.trend] }}
                        >
                          {metric.trend === 'up' ? '+' : '-'}{metric.delta}{metric.deltaUnit === 'RM' ? ' rep' + (metric.delta === 1 ? '' : 's') : ' kg'}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
})
