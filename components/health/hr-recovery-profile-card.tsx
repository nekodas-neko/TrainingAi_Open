'use client'

import { useState } from 'react'
import { HeartPulse, Info, TriangleAlert } from 'lucide-react'
import { useCachedValue } from '@/lib/hooks/use-cached-value'
import { HR_RECOVERY_PROFILE_TTL } from '@trainingai/shared/cache-ttl'
import { formatHrChange } from '@trainingai/shared/health/hr-change-display'
import { Sparkline } from '@/components/ui/sparkline'
import type { HrRecoveryProfile } from '@trainingai/shared/health/hr-recovery-profile'
import type { BandTrend } from '@trainingai/shared/health/hr-recovery-trend'

// HR Recovery Profile card (plan 2026-07-22-hr-recovery-profile.md, HRP-1/2/3) — recovery rate
// bucketed by the HR being recovered FROM, across between-set rests AND completed-workout cooldowns
// (e.g. runs), plus a month-over-month trend per band. Distinct from the per-exercise Heart &
// Recovery card: that one compares sets of the SAME lift over time, this one is intensity-normalised
// and cross-modal — "from 150 bpm you shed ~20 bpm/min" — the more comparable fitness signal.
// Self-fetching, cache-seeded (no skeleton), renders nothing until there's at least one band of data.
//
// IMPORTANT (spec §6, load-bearing): cardiovascular recovery only, not CNS/muscular readiness — same
// disclaimer as the per-exercise card. ALSO: what you do during rest changes the rate (standing
// between sets vs. a run's cool-down) — a band's `bySource` breakdown is shown whenever it mixes
// sources, so that confound is visible rather than silently averaged away.

type HrRecoveryProfileResponse = HrRecoveryProfile & { trend: BandTrend[] }

const RATE_UNIT = 'bpm/min'

const SOURCE_LABEL: Record<string, string> = {
  set_rest: 'lifting', run_cooldown: 'workout', interval: 'interval', ambient: 'ambient',
}

function sourceMixLabel(bySource: Record<string, number | undefined>): string | null {
  const entries = Object.entries(bySource).filter(([, n]) => (n ?? 0) > 0)
  if (entries.length < 2) return null // pure single-source band — nothing to disclose
  return entries.map(([source, n]) => `${n} ${SOURCE_LABEL[source] ?? source}`).join(', ')
}

export function HrRecoveryProfileCard() {
  const [error, setError] = useState(false)
  const profile = useCachedValue<HrRecoveryProfileResponse>(
    'hr-recovery-profile', '/api/health/hr-recovery-profile', HR_RECOVERY_PROFILE_TTL,
    { onError: () => setError(true) },
  )

  if (error && !profile) {
    return (
      <div className="rounded-2xl bg-muted/30 border border-border/50 p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
          Couldn&rsquo;t load your HR recovery profile — pull to refresh.
        </div>
      </div>
    )
  }
  if (!profile || profile.bands.length === 0) return null

  // Only bands with a real trajectory (≥2 months of data) are worth a sparkline.
  const trendBands = (profile.trend ?? []).filter(t => t.points.length >= 2)

  return (
    <div className="rounded-2xl bg-muted/30 border border-border/50 p-4 space-y-3">
      <div className="flex items-center gap-1.5">
        <HeartPulse className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">HR Recovery Profile</p>
      </div>
      <p className="text-xs text-muted-foreground">
        How fast your heart rate settles, grouped by how hard you were working. A bigger drop/min means faster recovery — generally a sign of better cardio fitness.
      </p>

      <div className="rounded-xl bg-muted/40 border border-border overflow-hidden">
        <div className="grid grid-cols-[76px_1fr_44px] px-3 py-2 border-b border-border/60">
          {['Peak HR', 'Recovery rate', 'n'].map(h => (
            <p key={h} className="text-[9px] text-muted-foreground">{h}</p>
          ))}
        </div>
        {profile.bands.map(b => {
          const rate = formatHrChange(b.medianRateBpmMin)
          const mix = sourceMixLabel(b.bySource)
          return (
            <div
              key={b.label}
              className="grid grid-cols-[76px_1fr_44px] px-3 py-2 border-b border-border/30 last:border-0"
              style={b.lowSignal ? { opacity: 0.55 } : undefined}
            >
              <p className="text-xs font-medium tabular-nums">{b.label}</p>
              <div>
                <p className="text-xs tabular-nums" style={rate.color ? { color: rate.color } : undefined}>
                  {rate.text}
                  {b.medianRateBpmMin != null && <span className="text-[9px] ml-1 text-muted-foreground">{RATE_UNIT}</span>}
                  {b.recoveredPct != null && (
                    <span className="text-[9px] ml-1.5 text-muted-foreground">· {b.recoveredPct}% fully recovered</span>
                  )}
                </p>
                {mix && <p className="text-[9px] text-muted-foreground mt-0.5">Mixed: {mix}</p>}
              </div>
              <p className="text-xs text-muted-foreground tabular-nums text-right">×{b.n}</p>
            </div>
          )
        })}
      </div>

      {profile.bands.some(b => b.lowSignal) && (
        <p className="text-[9px] text-muted-foreground">Dimmed band: HR barely elevated — recovery there is mostly noise, not signal.</p>
      )}

      {trendBands.length > 0 && (
        <div>
          <p className="text-[9px] text-muted-foreground mb-1">Recovery rate over time — rising means faster recovery (fitter)</p>
          <div className="grid grid-cols-2 gap-2">
            {trendBands.map(t => {
              const values = t.points.map(p => p.medianRateBpmMin).filter((v): v is number => v != null)
              if (values.length < 2) return null
              return (
                <div key={t.label} className="rounded-xl bg-muted/40 border border-border p-3">
                  <p className="text-[9px] text-muted-foreground mb-1">{t.label} bpm</p>
                  <Sparkline values={values} responsive fill color="var(--accent-cyan)" height={32} />
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="flex items-start gap-1">
        <Info className="h-2.5 w-2.5 text-muted-foreground mt-0.5 flex-none" />
        <p className="text-[9px] text-muted-foreground leading-tight">
          Cardiovascular recovery only — not CNS or muscular readiness. Built from weight-training rests
          and workout cooldowns (e.g. runs). A &ldquo;Mixed&rdquo; band combines sources that may
          recover at different rates for reasons other than fitness — worth reading with that in mind.
        </p>
      </div>
    </div>
  )
}
