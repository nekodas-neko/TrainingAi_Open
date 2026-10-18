'use client'

import { InfoIcon } from 'lucide-react'
import { labelFor } from '@trainingai/shared/health/contributor-labels'
import { limitedInputsNote } from '@trainingai/shared/health/readiness-input-labels'
import { scoreBand } from '@trainingai/shared/health/score-band'
import { isLearningContributor } from '@trainingai/shared/health/score-gap-copy'
import { READINESS_WEIGHTS } from '@trainingai/shared/health/readiness-composite'
import { FactorBar } from '@/components/health/contributor-chart'
import { ContributorDetails } from '@/components/health/contributor-details'
import type { ReadinessScoreResponse } from '@/app/api/readiness-score/route'

/**
 * "What goes into this score": the weighted factors of the app's own readiness composite. Shared by
 * the Readiness detail screen and the Home readiness card.
 *
 * This used to have a second shape keyed on `ouraScore`, which showed Oura's readiness as the
 * "Baseline" and ours as an adjustment on top of it. Oura's top-level scores are never ours (scoring
 * doc rule 5, #3000), so the composite is the only shape.
 */
export function ReadinessBreakdown({ readiness }: { readiness: ReadinessScoreResponse }) {
  if (readiness.readinessDisplayScore == null) return null
  return <CompositeBreakdown readiness={readiness} />
}

/**
 * Says which inputs today's score is missing, so a partial score reads as partial instead of as a
 * confident number. Text + icon, never colour alone — and it names the missing signals rather than
 * any device, since which device supplies them is not the user's problem.
 */
function LimitedInputsNote({ readiness }: { readiness: ReadinessScoreResponse }) {
  if (!readiness.limited) return null
  const note = limitedInputsNote(readiness.inputsMissing)
  if (!note) return null
  return (
    <p className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
      <InfoIcon className="mt-[1px] h-3 w-3 shrink-0" aria-hidden />
      <span>{note}</span>
    </p>
  )
}

function CompositeBreakdown({ readiness }: { readiness: ReadinessScoreResponse }) {
  const contributors = readiness.readinessCompositeContributors
  const hasScores = contributors != null
  const anyLearning = contributors != null && Object.values(contributors).some(c => c != null && isLearningContributor(c))
  // Sort worst-scoring first (surface the weak spots). A learning factor's `score` is the neutral 50
  // placeholder, not a measurement, so it must not sort as one — learning factors go last, ordered by
  // weight, rather than interleaving at 50 among real scores. A provisional factor with a real score
  // (`gap: null`) is measured and sorts with the rest (#3029).
  const scoreOf = (k: keyof typeof READINESS_WEIGHTS) => {
    const c = contributors?.[k]
    return c != null && !isLearningContributor(c) ? c.score : null
  }
  const keys = (Object.keys(READINESS_WEIGHTS) as (keyof typeof READINESS_WEIGHTS)[]).sort((a, b) => {
    const sa = scoreOf(a)
    const sb = scoreOf(b)
    if (sa != null && sb != null) return sa - sb
    if (sa != null) return -1
    if (sb != null) return 1
    return READINESS_WEIGHTS[b] - READINESS_WEIGHTS[a]
  })

  return (
    <>
      <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          What goes into this score
        </p>
        <p className="text-[11px] leading-snug text-muted-foreground">
          {hasScores
            ? 'Each factor scored against your own baselines. Tap one to jump to what it means and how to move it.'
            : 'Computed from your own baselines, weighted by how much each factor moves recovery. Scroll down for what each one means.'}
        </p>
        <LimitedInputsNote readiness={readiness} />
        <div className="space-y-2.5 pt-0.5">
          {keys.map(key => {
            const weightPct = Math.round(READINESS_WEIGHTS[key] * 100)
            const c = contributors?.[key] ?? null
            const score = c?.score ?? null
            const learning = c != null && isLearningContributor(c)
            const band = score != null && !learning ? scoreBand(score) : null
            // With a real sub-score, colour by band and fill to the score. Without one, show the
            // factor's WEIGHT — bar and label both — in neutral brand colour. Previously the bar
            // filled to `weightPct / 0.17` and the trailing slot showed that bare number, which
            // reads as a sub-score: "Resting heart rate 88" for a user with no resting-HR data at
            // all (Q-45). Bar and label must agree, or a near-full grey bar still reads as "good".
            const color = band ? band.color : 'var(--color-brand)'
            const scored = score != null && !learning
            return (
              <FactorBar
                key={key}
                contributorKey={key}
                label={labelFor(key)}
                value={scored ? score : weightPct}
                valueLabel={scored ? undefined : `${weightPct}%`}
                muted={!scored}
                color={color}
                linked
              />
            )
          })}
        </div>
        {anyLearning && (
          <p className="text-[10px] leading-snug text-muted-foreground/70">
            Factors still learning your baseline show how much they count (%) instead of a score.
          </p>
        )}
      </div>

      <ContributorDetails
        factors={keys.map(key => {
          const c = contributors?.[key] ?? null
          return {
            key,
            label: labelFor(key),
            score: c?.score ?? null,
            provisional: c?.provisional ?? false,
            gap: c?.gap,
            scale: c?.scale,
            extra: extraFor(key, readiness),
            // Body temperature is a true golden-zone metric — at baseline is ideal, and both a rise
            // and a drop are worse. Drive a centered gauge from the actual °C deviation (±1.5°C span)
            // so the marker shows *which side* you're off, not just "off".
            gauge: key === 'temperature' && readiness.temperatureDeviation != null
              ? {
                  pct: Math.max(0, Math.min(100, ((readiness.temperatureDeviation + 1.5) / 3) * 100)),
                  lowLabel: 'Below',
                  midLabel: 'Baseline',
                  highLabel: 'Elevated',
                }
              : undefined,
            footer: (
              <p className="mt-2 text-[10px] text-muted-foreground/70">
                Weighted {Math.round(READINESS_WEIGHTS[key] * 100)}% of your readiness score.
              </p>
            ),
          }
        })}
      />
    </>
  )
}

// Real physiological values to show above the interpretation, where the readiness response
// carries them (HRV averages, temperature deviation). Other factors fall back to the guide only.
function extraFor(key: keyof typeof READINESS_WEIGHTS, r: ReadinessScoreResponse) {
  if (key === 'hrvBalance' && (r.recentHrv != null || r.baselineHrv != null)) {
    return (
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Your values</p>
        <p className="mt-0.5 text-muted-foreground tabular-nums">
          {r.recentHrv != null && <>Recent 7-day HRV {Math.round(r.recentHrv)} ms</>}
          {r.recentHrv != null && r.baselineHrv != null && ' · '}
          {r.baselineHrv != null && <>baseline {Math.round(r.baselineHrv)} ms</>}
        </p>
      </div>
    )
  }
  if (key === 'temperature' && r.temperatureDeviation != null) {
    return (
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Your value</p>
        <p className="mt-0.5 text-muted-foreground tabular-nums">
          {r.temperatureDeviation > 0 ? '+' : ''}{r.temperatureDeviation.toFixed(1)}°C vs your baseline
        </p>
      </div>
    )
  }
  return null
}
