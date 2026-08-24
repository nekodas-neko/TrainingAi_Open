'use client'

import { useCallback, useEffect, useState } from 'react'
import { useUserTimezone } from "@/components/shell/user-timezone-provider";
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { Copy, Loader2, ChevronDown, ChevronRight, ChevronLeft, ChevronRight as ChevronRightIcon, AlertTriangle } from 'lucide-react'
import { todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'
import type { DayAudit, PillarAudit, AuditContributor } from '@trainingai/shared/health/score-audit/types'
import SleepFeelCalibrationCard from '@/components/admin/sleep-feel-calibration-card'
import BatteryRecoveryCalibrationCard from '@/components/admin/battery-recovery-calibration-card'

// Admin day-review. Pick a day, get every input behind each scored pillar plus the model constants
// that shaped it — on screen for a quick read, and as one copyable JSON blob for a deeper review.

export default function DayReviewTab() {
  const tz = useUserTimezone();
  const [date, setDate] = useState(() => todayInTz(tz))
  const [audit, setAudit] = useState<DayAudit | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(async (d: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/day-review?date=${encodeURIComponent(d)}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body?.detail ?? body?.error ?? `HTTP ${res.status}`)
      setAudit(body as DayAudit)
    } catch (e) {
      setAudit(null)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(date) }, [date, load])

  const copy = useCallback(async () => {
    if (!audit) return
    const json = JSON.stringify(audit, null, 2)
    try {
      await navigator.clipboard.writeText(json)
      toast.success(`Day audit for ${audit.date} copied (${Math.round(json.length / 1024)} KB)`)
    } catch {
      toast.error('Clipboard unavailable — select the JSON below and copy manually')
    }
  }, [audit])

  return (
    <div className="space-y-4">
      <SleepFeelCalibrationCard />
      <BatteryRecoveryCalibrationCard />

      <div className="rounded-xl border border-border p-4 space-y-3">
        <p className="text-xs text-muted-foreground">
          Every signal behind each scored pillar for one day, with the model constants that shaped it.
          Use it when a score doesn&apos;t match how the day actually felt — copy the JSON and review the
          contributor weights against the raw inputs.
        </p>
        {/* Two rows, not one: the date input carries `w-full min-w-0`, so on a 412px-wide phone a
            single row shrinks it to a few pixels. */}
        <div className="flex items-center gap-2">
          <Button variant="outline" className="h-11 w-11 shrink-0 p-0" aria-label="Previous day"
            onClick={() => setDate(d => shiftDateStr(d, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Input
            type="date"
            value={date}
            aria-label="Day to review"
            onChange={e => e.target.value && setDate(e.target.value)}
            className="h-11 min-w-0 flex-1"
          />
          <Button variant="outline" className="h-11 w-11 shrink-0 p-0" aria-label="Next day"
            onClick={() => setDate(d => shiftDateStr(d, 1))}>
            <ChevronRightIcon className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="h-11 flex-1" onClick={() => setDate(todayInTz(tz))}>Today</Button>
          <Button className="h-11 flex-1" onClick={copy} disabled={!audit}>
            <Copy className="mr-1 h-3.5 w-3.5" /> Copy JSON
          </Button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-8 justify-center text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Assembling {date}…
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <p className="font-medium text-destructive">Could not build the audit</p>
          <p className="mt-1 text-xs text-muted-foreground break-words">{error}</p>
        </div>
      )}

      {audit && !loading && (
        <>
          {audit.warnings.length > 0 && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 space-y-1">
              {audit.warnings.map((w, i) => (
                <p key={i} className="text-xs text-amber-700 dark:text-amber-400">{w}</p>
              ))}
            </div>
          )}

          {audit.pillars.map(p => (
            <PillarCard
              key={p.pillar}
              pillar={p}
              expanded={open === p.pillar}
              onToggle={() => setOpen(o => (o === p.pillar ? null : p.pillar))}
            />
          ))}

          <DataQualityCard audit={audit} />

          <details className="rounded-xl border border-border">
            <summary className="cursor-pointer p-4 text-sm font-medium">Full JSON</summary>
            <pre className="max-h-96 overflow-auto border-t border-border p-3 text-[10px] leading-tight">
              {JSON.stringify(audit, null, 2)}
            </pre>
          </details>
        </>
      )}
    </div>
  )
}

function PillarCard({ pillar, expanded, onToggle }: { pillar: PillarAudit; expanded: boolean; onToggle: () => void }) {
  const drifted = pillar.storedMatchesRecompute === false

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 p-4 text-left"
      >
        {expanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{pillar.label}</p>
          <p className="text-[11px] text-muted-foreground truncate">{pillar.source}</p>
        </div>
        {drifted && <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" aria-label="stored score differs" />}
        <span className="shrink-0 text-2xl font-bold tabular-nums">
          {pillar.score ?? '—'}
        </span>
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-border p-4">
          {pillar.contributors.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Contributors</p>
              {pillar.contributors.map(c => <ContributorRow key={c.key} c={c} />)}
            </div>
          )}

          {pillar.gaps.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Missing inputs</p>
              {pillar.gaps.map((g, i) => (
                <p key={i} className="text-[11px] text-amber-700 dark:text-amber-400">• {g}</p>
              ))}
            </div>
          )}

          {pillar.notes.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Notes</p>
              {pillar.notes.map((n, i) => <p key={i} className="text-[11px] text-muted-foreground">• {n}</p>)}
            </div>
          )}

          <div className="space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Raw inputs</p>
            <div className="grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
              {Object.entries(pillar.inputs).map(([k, s]) => (
                <div key={k} className="flex items-baseline gap-2 text-[11px]">
                  <span className="text-muted-foreground shrink-0">{k}</span>
                  <span className="ml-auto font-medium tabular-nums text-right break-all" title={s.note ?? s.source ?? ''}>
                    {s.value === null ? '—' : String(s.value)}{s.unit ? ` ${s.unit}` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="text-[11px] text-muted-foreground">
            Stored for this day: <span className="font-medium">{pillar.stored.score ?? '—'}</span>
            {pillar.stored.source ? ` (${pillar.stored.source})` : ''}
            {drifted && <span className="ml-1 text-amber-600 dark:text-amber-400">— differs from this recompute</span>}
          </div>
        </div>
      )}
    </div>
  )
}

function ContributorRow({ c }: { c: AuditContributor }) {
  const pct = c.effectiveWeight != null ? Math.round(c.effectiveWeight * 100) : 0
  const excluded = c.subScore == null

  return (
    <div className={excluded ? 'opacity-50' : undefined}>
      <div className="flex items-baseline gap-2 text-[11px]">
        <span className="min-w-0 flex-1 truncate">
          {c.label}
          {c.provisional && <span className="ml-1 text-[9px] uppercase tracking-wide text-amber-600 dark:text-amber-400">neutral</span>}
        </span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {c.input.value === null ? '—' : String(c.input.value)}{c.input.unit ? ` ${c.input.unit}` : ''}
        </span>
        <span className="w-10 shrink-0 text-right font-medium tabular-nums">{c.subScore ?? '—'}</span>
        <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">{excluded ? '—' : `${pct}%`}</span>
        <span className="w-12 shrink-0 text-right tabular-nums font-medium">{c.contribution ?? '—'}</span>
      </div>
      {excluded && c.excludedReason && (
        <p className="text-[10px] text-muted-foreground pl-2">excluded — {c.excludedReason}</p>
      )}
    </div>
  )
}

function DataQualityCard({ audit }: { audit: DayAudit }) {
  return (
    <div className="rounded-xl border border-border p-4 space-y-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Data quality</p>
      <div className="grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
        {Object.entries(audit.context.dataQuality).map(([k, s]) => (
          <div key={k} className="flex items-baseline gap-2 text-[11px]">
            <span className="text-muted-foreground shrink-0">{k}</span>
            <span className="ml-auto font-medium tabular-nums" title={s.note ?? ''}>
              {s.value === null ? '—' : String(s.value)}{s.unit ? ` ${s.unit}` : ''}
            </span>
          </div>
        ))}
      </div>
      <div className="pt-2 text-[11px] text-muted-foreground">
        {audit.context.workouts.length} workout(s) · {audit.context.activities.length} activity log(s) ·
        {audit.context.checkin ? ` check-in: ${String((audit.context.checkin as { energyLevel?: string }).energyLevel ?? '—')}` : ' no check-in'}
        {audit.context.nutrition ? ` · ${Math.round(Number((audit.context.nutrition as { calories?: number }).calories ?? 0))} kcal logged` : ''}
      </div>
    </div>
  )
}
