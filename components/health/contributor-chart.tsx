'use client'

import { ChevronRightIcon } from 'lucide-react'
import { scoreBand } from '@trainingai/shared/health/score-band'
import { ScoreBandLegend } from '@/components/health/score-band-legend'
import { labelFor } from '@/lib/oura/contributors'
import { guideFor } from '@trainingai/shared/health/contributor-guide'
import { ContributorDetails, factorAnchorId } from '@/components/health/contributor-details'

/**
 * Contributor graph for a health score — one labelled, band-coloured bar per contributor,
 * sorted worst-first. The bars are a quick read; each links down to the always-visible
 * per-factor detail section rendered below (what it measures / means / how to improve).
 */
export function ContributorChart({
  title,
  contributors,
}: {
  title: string
  contributors: Record<string, number | null>
}) {
  const entries = Object.entries(contributors)
    .filter((e): e is [string, number] => e[1] != null)
    .sort(([, a], [, b]) => a - b)
  if (entries.length === 0) return null

  const worst = entries[0]

  return (
    <>
      <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
          <span className="text-[10px] text-muted-foreground">
            Weakest: <span className="font-semibold text-foreground">{labelFor(worst[0])}</span>
          </span>
        </div>

        <div className="space-y-2.5 pt-1">
          {entries.map(([key, val]) => {
            const band = scoreBand(val)
            const hasGuide = guideFor(key) != null
            return (
              <FactorBar key={key} contributorKey={key} label={labelFor(key)} value={val} color={band.color} linked={hasGuide} />
            )
          })}
        </div>

        <ScoreBandLegend />
      </div>

      <ContributorDetails
        factors={entries.map(([key, val]) => ({ key, label: labelFor(key), score: val }))}
      />
    </>
  )
}

export function FactorBar({
  contributorKey,
  label,
  value,
  color,
  linked,
  valueLabel,
  muted,
}: {
  contributorKey: string
  label: string
  /** Bar fill, 0–100. */
  value: number
  color: string
  linked: boolean
  /** Text shown after the bar. Defaults to `value`. Pass this when the fill is not a 0-100
   *  sub-score — the trailing number is read as a score, so it must never silently be something
   *  else (Q-45: a provisional factor rendered its own weight there). */
  valueLabel?: string
  /** Render the trailing text in muted foreground rather than the bar colour — the visual cue that
   *  it is not a score. */
  muted?: boolean
}) {
  const scrollToDetail = () => {
    document.getElementById(factorAnchorId(contributorKey))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const row = (
    <div className="flex items-center gap-2">
      <span className="flex w-32 flex-none items-center gap-0.5 text-[11px] leading-tight text-foreground">
        {label}
        {linked && <ChevronRightIcon className="h-3 w-3 flex-none text-muted-foreground/60" />}
      </span>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted/60">
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${value}%`, background: color }} />
      </div>
      <span
        className={`w-8 flex-none text-right text-[11px] font-semibold tabular-nums${muted ? ' text-muted-foreground' : ''}`}
        style={muted ? undefined : { color }}
      >
        {valueLabel ?? value}
      </span>
    </div>
  )
  if (!linked) return row
  return (
    <button type="button" onClick={scrollToDetail} className="w-full text-left" aria-label={`${label} — see details`}>
      {row}
    </button>
  )
}

