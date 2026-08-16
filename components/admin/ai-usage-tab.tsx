'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Repeat } from 'lucide-react'
import { readCacheSync, cachedFetch } from '@/lib/sqlite/cache'
import { AI_USAGE_TTL } from '@trainingai/shared/cache-ttl'
import type { AiCallUsageSummary } from '@/lib/data/repository'

// Gemini 3.1 Flash Lite approximate token pricing (USD per 1M tokens). Estimate
// only — surfaced so the admin can eyeball relative spend per section, not billed.
const COST_PER_1M_INPUT = 0.10
const COST_PER_1M_OUTPUT = 0.40

function estCostUsd(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * COST_PER_1M_INPUT + (outputTokens / 1_000_000) * COST_PER_1M_OUTPUT
}

function fmtUsd(v: number): string {
  return v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`
}

function fmtInt(v: number): string {
  return v.toLocaleString('en-AU')
}

const WINDOWS: { label: string; hours: number }[] = [
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
  { label: '30d', hours: 720 },
]

export default function AiUsageTab() {
  const [windowHours, setWindowHours] = useState(168)
  const [summary, setSummary] = useState<AiCallUsageSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    const key = `admin-ai-usage:${windowHours}`
    const seed = readCacheSync<AiCallUsageSummary>(key)
    if (seed) { setSummary(seed); setLoading(false) }
    setError(false)
    cachedFetch<AiCallUsageSummary>(
      key,
      `/api/admin/ai-usage?sinceHours=${windowHours}`,
      AI_USAGE_TTL,
      d => { setSummary(d); setLoading(false) },
      { onError: () => { setError(true); setLoading(false) } },
    ).catch(() => { setError(true); setLoading(false) })
  }, [windowHours])

  const totalCost = summary
    ? summary.sections.reduce((a, s) => a + estCostUsd(s.inputTokens, s.outputTokens), 0)
    : 0
  const maxBucketCalls = summary && summary.timeline.length
    ? Math.max(...summary.timeline.map(b => b.calls))
    : 0

  return (
    <div className="space-y-4">
      {/* window selector */}
      <div className="flex items-center gap-1.5">
        {WINDOWS.map(w => (
          <button
            key={w.hours}
            type="button"
            onClick={() => setWindowHours(w.hours)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
              windowHours === w.hours ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {w.label}
          </button>
        ))}
      </div>

      {loading && !summary && (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}
        </div>
      )}

      {error && !summary && (
        <div className="rounded-xl border border-border bg-muted/20 p-4">
          <p className="text-xs text-muted-foreground">Couldn&apos;t load AI usage.</p>
        </div>
      )}

      {summary && (
        <>
          {/* summary tiles */}
          <div className="grid grid-cols-3 gap-2">
            <SummaryTile label="Calls" value={fmtInt(summary.totalCalls)} />
            <SummaryTile label="Tokens" value={fmtInt(summary.totalTokens)} />
            <SummaryTile label="Est. cost" value={fmtUsd(totalCost)} />
          </div>
          {summary.totalErrors > 0 && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5" style={{ color: 'var(--destructive)' }} />
              {fmtInt(summary.totalErrors)} failed call{summary.totalErrors === 1 ? '' : 's'} in this window
            </p>
          )}

          {/* double-trip detection */}
          {summary.doubleTrips.length > 0 && (
            <div className="rounded-xl border border-border overflow-hidden"
              style={{ background: 'color-mix(in oklch, var(--accent-amber) 8%, transparent)' }}>
              <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-border/50">
                <Repeat className="h-4 w-4" style={{ color: 'var(--accent-amber)' }} />
                <span className="text-sm font-medium">Double-trips</span>
                <span className="text-[10px] text-muted-foreground">same call fired again within {summary.windowSeconds}s</span>
              </div>
              <div className="divide-y divide-border/40">
                {summary.doubleTrips.map(d => (
                  <div key={d.section} className="flex items-center justify-between px-4 py-2 text-xs">
                    <span className="font-medium">{d.section}</span>
                    <span className="text-muted-foreground">
                      {fmtInt(d.redundantCalls)} redundant · {fmtInt(d.affectedFingerprints)} distinct
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* calls over time (CSS bars — no chart.js to keep the admin bundle light) */}
          {summary.timeline.length > 0 && (
            <div className="rounded-xl border border-border p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Calls over time</p>
              <div className="flex items-end gap-1 h-20">
                {[...summary.timeline].reverse().map(b => (
                  // h-full is load-bearing: a percentage bar height resolves against the
                  // COLUMN's height, so the column must fill the row (h-20) — without it the
                  // bars collapse to 0px and the chart renders blank.
                  <div key={b.bucket} className="flex-1 h-full flex flex-col justify-end" title={`${b.bucket}: ${b.calls} calls, ${fmtInt(b.totalTokens)} tokens`}>
                    <div
                      className="w-full rounded-t"
                      style={{
                        height: `${maxBucketCalls ? Math.max(4, (b.calls / maxBucketCalls) * 100) : 0}%`,
                        background: 'var(--color-brand)',
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* per-section table, worst-first */}
          {summary.sections.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No AI calls recorded in this window.</p>
          ) : (
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground text-left">
                      <th className="px-3 py-2 font-medium">Section</th>
                      <th className="px-3 py-2 font-medium text-right">Calls</th>
                      <th className="px-3 py-2 font-medium text-right">Tokens</th>
                      <th className="px-3 py-2 font-medium text-right">Est. cost</th>
                      <th className="px-3 py-2 font-medium text-right">Avg ms</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {summary.sections.map(s => (
                      <tr key={s.section}>
                        <td className="px-3 py-2 font-medium">
                          {s.section}
                          {s.errors > 0 && (
                            <span className="ml-1.5 text-[10px]" style={{ color: 'var(--destructive)' }}>
                              {s.errors} err
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtInt(s.calls)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtInt(s.totalTokens)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtUsd(estCostUsd(s.inputTokens, s.outputTokens))}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtInt(s.avgLatencyMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums mt-0.5">{value}</p>
    </div>
  )
}
