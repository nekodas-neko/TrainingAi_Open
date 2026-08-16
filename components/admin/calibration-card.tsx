'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import type { ModelReportCalibration } from '@trainingai/shared/health/model-report-calibration'

// One presentational card for every "does this model agree with what the owner reported?" surface.
// Built for the Sleep Score calibration (Q-16) and generalised when Body Battery vs perceived
// recovery needed the identical panel (Q-79) — the alternative was a second 190-line copy whose
// stat labels and thresholds would drift from this one's.
//
// Read-only calibration evidence. Nothing rendered here is ever a model input.

export interface CalibrationView extends ModelReportCalibration {
  timezone: string
  generatedAt: string
}

const WINDOWS = [30, 60, 90] as const

/** Colour for a stored 1–5 rating, best → worst. Always rendered with its label, never alone. */
const RATING_COLOR = ['#22c55e', '#84cc16', '#f59e0b', '#f97316', '#ef4444']

export interface CalibrationCardProps {
  title: string
  /** Why this panel exists and why the rating is not an input. */
  blurb: string
  /** Admin endpoint taking `?days=`. */
  endpoint: string
  /** What the model produces — "Sleep Score", "end-of-day Battery". */
  modelLabel: string
  /** Observation noun, e.g. `{ one: 'night', many: 'nights' }`. */
  unit: { one: string; many: string }
  /**
   * Maps the endpoint's payload into the engine shape. Identity for routes that return it directly;
   * the sleep route keeps its own `feel`/`nights` vocabulary and passes a mapper.
   */
  normalize?: (raw: unknown) => CalibrationView
}

export default function CalibrationCard({
  title, blurb, endpoint, modelLabel, unit, normalize,
}: CalibrationCardProps) {
  const [days, setDays] = useState<number>(60)
  const [data, setData] = useState<CalibrationView | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showRows, setShowRows] = useState(false)

  const load = useCallback(async (n: number) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${endpoint}?days=${n}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body?.detail ?? body?.error ?? `HTTP ${res.status}`)
      setData(normalize ? normalize(body) : (body as CalibrationView))
    } catch (e) {
      setData(null)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [endpoint, normalize])

  useEffect(() => { load(days) }, [days, load])

  return (
    <div className="rounded-xl border border-border p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{blurb}</p>
      </div>

      <div className="flex items-center gap-2">
        {WINDOWS.map(n => (
          <Button
            key={n}
            variant={days === n ? 'default' : 'outline'}
            className="h-10 flex-1"
            onClick={() => setDays(n)}
          >
            {n}d
          </Button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-6 justify-center text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Reading {days} days…
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs">
          <p className="font-medium text-destructive">Could not build the calibration</p>
          <p className="mt-1 text-muted-foreground break-words">{error}</p>
        </div>
      )}

      {data && !loading && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label={`${cap(unit.many)} paired`} value={String(data.paired)} />
            <Stat
              label="Agreement"
              value={data.spearman == null ? '—' : (data.spearman > 0 ? '+' : '') + data.spearman.toFixed(2)}
              hint="rank correlation"
            />
            <Stat
              label="Model spread"
              value={data.modelRange ? `${data.modelRange.min}–${data.modelRange.max}` : '—'}
              hint={data.ratingRange ? `you used ${data.ratingRange.spread}` : undefined}
            />
          </div>

          {/* Mean model value per rating — the clearest read on whether the model orders days the
              way the owner does. A bar taller than the one above it is out of order. */}
          <div className="rounded-lg border border-border p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Mean {modelLabel} by your rating
            </p>
            <div className="space-y-1.5">
              {data.buckets.map(b => (
                <div key={b.rating} className="flex items-center gap-2">
                  <span className="w-16 flex-none text-[11px] font-medium" style={{ color: RATING_COLOR[b.rating - 1] }}>
                    {b.label}
                  </span>
                  <div className="flex-1 h-4 rounded bg-muted overflow-hidden">
                    {b.meanModelScore != null && (
                      <div
                        className="h-full rounded"
                        style={{ width: `${b.meanModelScore}%`, background: RATING_COLOR[b.rating - 1] }}
                      />
                    )}
                  </div>
                  <span className="w-24 flex-none text-right text-[11px] tabular-nums text-muted-foreground">
                    {b.count === 0 ? '—' : `${b.meanModelScore} · ${b.count}n`}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {data.notes.length > 0 && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-1">
              {data.notes.map((n, i) => (
                <p key={i} className="text-xs text-amber-700 dark:text-amber-400">{n}</p>
              ))}
            </div>
          )}

          {data.worstDisagreements.length > 0 && (
            <div className="rounded-lg border border-border p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Biggest disagreements
              </p>
              {data.worstDisagreements.map(r => (
                <div key={r.date} className="flex items-center justify-between py-1 text-xs border-b border-border/30 last:border-0">
                  <span className="tabular-nums text-muted-foreground">{r.date.slice(5)}</span>
                  <span className="tabular-nums">
                    model <strong>{r.modelScore}</strong>
                    <span className="text-muted-foreground"> · you said </span>
                    <strong style={{ color: RATING_COLOR[(r.rating ?? 1) - 1] }}>{r.ratingLabel}</strong>
                  </span>
                  <span className="tabular-nums text-muted-foreground">{r.rankGapPct}pp</span>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowRows(s => !s)}
            aria-expanded={showRows}
            className="flex w-full items-center gap-1.5 rounded-lg border border-border px-3 py-2.5 text-xs font-medium"
          >
            {showRows ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            Every {unit.one} ({data.rows.length})
          </button>

          {showRows && (
            <div className="rounded-lg border border-border overflow-hidden">
              {data.rows.map(r => (
                <div key={r.date} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 px-3 py-1.5 text-xs border-b border-border/30 last:border-0">
                  <span className="tabular-nums text-muted-foreground">{r.date}</span>
                  <span className="tabular-nums w-10 text-right">{r.modelScore ?? '—'}</span>
                  <span className="w-20 text-right" style={r.rating != null ? { color: RATING_COLOR[r.rating - 1] } : undefined}>
                    {r.ratingLabel ?? '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-muted/60 p-2">
      <p className="text-base font-bold tabular-nums leading-tight">{value}</p>
      <p className="text-[10px] text-muted-foreground leading-tight">{label}</p>
      {hint && <p className="text-[9px] text-muted-foreground/70 leading-tight">{hint}</p>}
    </div>
  )
}
