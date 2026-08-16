'use client'

import type { ReactNode } from 'react'
import { scoreBand } from '@trainingai/shared/health/score-band'
import { guideFor } from '@trainingai/shared/health/contributor-guide'
import { ContributorDetail } from '@/components/health/contributor-detail'
import { ZoneGauge } from '@/components/health/zone-gauge'

export interface ContributorFactor {
  key: string
  label: string
  score?: number | null
  provisional?: boolean
  extra?: ReactNode
  footer?: ReactNode
  // A "golden zone in the middle" gauge for metrics where both ends are bad (e.g. body-temperature
  // deviation) — `pct` is the marker position 0–100, with the ideal in the centre. When absent, the
  // factor falls back to a toward-high gauge driven by its 0–100 score (high score = healthy).
  gauge?: { pct: number; lowLabel?: string; midLabel?: string; highLabel?: string }
}

// Anchor id a bar links to so tapping it scrolls to the matching detail block.
export function factorAnchorId(key: string): string {
  return `factor-${key}`
}

/**
 * The always-visible "what each factor means" section shown below a score's contributor bars.
 * One block per factor — its label, score, and the full deep-dive — so the whole picture reads
 * top-to-bottom without opening anything. Bars above link here via factorAnchorId().
 */
export function ContributorDetails({ factors, title = 'What each factor means' }: { factors: ContributorFactor[]; title?: string }) {
  const withGuide = factors.filter(f => guideFor(f.key) != null)
  if (withGuide.length === 0) return null
  return (
    <div className="space-y-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      {withGuide.map(f => {
        const band = f.score != null && !f.provisional ? scoreBand(f.score) : null
        return (
          <div key={f.key} id={factorAnchorId(f.key)} className="scroll-mt-4 rounded-xl border border-border bg-muted/20 p-4">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">{f.label}</h3>
              {band && (
                <span
                  className="flex-none rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide tabular-nums"
                  style={{ background: `${band.color}22`, color: band.color }}
                >
                  {band.label} · {f.score}
                </span>
              )}
            </div>
            {/* A golden-zone gauge (not a fill bar): shows the healthy zone and a "you are here"
                marker, so it reads as "aim for the green zone" rather than "fill it to the top".
                Centered variant for middle-optimal metrics (both ends bad, e.g. temperature). */}
            {f.gauge
              ? <ZoneGauge variant="centered" pct={f.gauge.pct} lowLabel={f.gauge.lowLabel} midLabel={f.gauge.midLabel} highLabel={f.gauge.highLabel} />
              : f.score != null && !f.provisional
                ? <ZoneGauge variant="toward-high" pct={f.score} />
                : null}
            <ContributorDetail contributorKey={f.key} score={f.score} provisional={f.provisional} extra={f.extra} hideScoreBadge />
            {f.footer}
          </div>
        )
      })}
    </div>
  )
}
