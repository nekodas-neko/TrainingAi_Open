'use client'

import { CircleDotIcon, ZapIcon, ThermometerIcon, HistoryIcon, InfoIcon } from 'lucide-react'
import type { ReadinessInputKey } from '@/lib/health/score-availability'
import { cn } from '@trainingai/shared/utils'
import { scoreBand } from '@trainingai/shared/health/score-band'
import { READINESS_WEIGHTS } from '@trainingai/shared/health/readiness-composite'
import { FactorBar } from '@/components/health/contributor-chart'
import { ContributorDetails } from '@/components/health/contributor-details'
import type { ReadinessScoreResponse } from '@/app/api/readiness-score/route'

// Human labels for the composite weight keys (camelCase, distinct from Oura's snake_case).
const WEIGHT_LABELS: Record<keyof typeof READINESS_WEIGHTS, string> = {
  restingHeartRate: 'Resting heart rate',
  previousNight: 'Previous night',
  hrvBalance: 'HRV balance',
  temperature: 'Body temperature',
  sleepBalance: 'Sleep balance',
  prevDayActivity: 'Previous day activity',
  recoveryIndex: 'Recovery index',
  activityBalance: 'Activity balance',
  checkin: 'Morning check-in',
}

/**
 * "What the score is built on." Two shapes:
 * - Oura path (ouraScore != null): the base → load(ACWR) → temp → final adjustment chain.
 * - Composite path (ouraScore == null): the weighted factors the app's own readiness composite
 *   is built from, since Oura's Cloud score is frozen post-BLE-re-key.
 * Shared by the Readiness detail screen and the Home readiness card.
 */
export function ReadinessBreakdown({ readiness }: { readiness: ReadinessScoreResponse }) {
  const displayScore = readiness.readinessDisplayScore
  if (displayScore == null) return null
  // Q-281: the band's WORD ships with its colour. `scoreBand()` colour without `scoreBand()`'s
  // label is a CLAUDE.md violation outright, and this row is the one place the composite branch
  // does not cover with a legend — a bare amber 62 says nothing to anyone who cannot see amber.
  const { color, label: bandLabel } = scoreBand(displayScore)

  if (readiness.ouraScore != null) {
    const adj = displayScore - readiness.ouraScore
    const tempDev = readiness.temperatureDeviation
    return (
      <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          How this score is built
        </p>
        <div className="space-y-0.5">
          <Row icon={<CircleDotIcon className="h-3.5 w-3.5" />} label="Baseline">
            <span className="font-semibold tabular-nums">{readiness.ouraScore}</span>
          </Row>
          {adj !== 0 && (
            <Row
              icon={<ZapIcon className="h-3.5 w-3.5" />}
              label={readiness.source === 'oura+acwr' ? 'Training load (ACWR)' : 'Adjustment'}
            >
              <span className={cn('font-semibold tabular-nums', adj < 0 ? 'text-amber-500 dark:text-amber-400' : 'text-green-600 dark:text-green-400')}>
                {adj > 0 ? '+' : ''}{adj}
              </span>
            </Row>
          )}
          {tempDev != null && Math.abs(tempDev) > 0.3 && (
            <Row
              icon={<ThermometerIcon className="h-3.5 w-3.5" />}
              label="Body-temperature penalty"
              badge={readiness.temperatureDeviationSource === 'cloud' ? 'Pre-re-key' : undefined}
            >
              <span className="font-semibold tabular-nums text-amber-500 dark:text-amber-400">
                {tempDev > 0 ? '+' : ''}{tempDev.toFixed(1)}°C
              </span>
            </Row>
          )}
          <div className="flex items-center justify-between text-sm border-t border-border/50 pt-1.5 mt-1">
            <span className="text-muted-foreground font-medium">Final readiness</span>
            <span className="flex items-baseline gap-1.5">
              <span className="text-[11px] text-muted-foreground">{bandLabel}</span>
              <span className="font-bold tabular-nums" style={{ color }}>{displayScore}</span>
            </span>
          </div>
        </div>
      </div>
    )
  }

  // Composite path — Oura's Cloud score is unavailable, so show the app's own baseline-relative
  // composite. Each factor shows its actual sub-score (when the composite has produced one) and
  // its weight, and taps open a deep-dive (what it measures / against / means / how to improve).
  return <CompositeBreakdown readiness={readiness} />
}

const INPUT_LABELS: Record<ReadinessInputKey, string> = {
  sleep: 'sleep stages',
  hrv: 'overnight HRV',
  restingHeartRate: 'resting heart rate',
  temperature: 'body temperature',
  activity: 'daily activity',
  checkin: 'your morning check-in',
}

/**
 * Says which inputs today's score is missing, so a partial score reads as partial instead of as a
 * confident number. Text + icon, never colour alone — and it names the missing signals rather than
 * any device, since which device supplies them is not the user's problem.
 */
function LimitedInputsNote({ readiness }: { readiness: ReadinessScoreResponse }) {
  if (!readiness.limited) return null
  const missing = readiness.inputsMissing.filter(k => k !== 'checkin')
  if (missing.length === 0) return null
  const names = missing.map(k => INPUT_LABELS[k])
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return (
    <p className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
      <InfoIcon className="mt-[1px] h-3 w-3 shrink-0" aria-hidden />
      <span>Based on part of the usual picture — no {list} today, so those factors sit at neutral.</span>
    </p>
  )
}

function CompositeBreakdown({ readiness }: { readiness: ReadinessScoreResponse }) {
  const contributors = readiness.readinessCompositeContributors
  const hasScores = contributors != null
  const anyProvisional = contributors != null && Object.values(contributors).some(c => c?.provisional)
  // Sort worst-scoring first (surface the weak spots). A provisional factor's `score` is the
  // neutral 50 placeholder, not a measurement, so it must not sort as one — provisional factors go
  // last, ordered by weight, rather than interleaving at 50 among real scores.
  const scoreOf = (k: keyof typeof READINESS_WEIGHTS) => {
    const c = contributors?.[k]
    return c != null && !c.provisional ? c.score : null
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
            const provisional = c?.provisional ?? false
            const band = score != null && !provisional ? scoreBand(score) : null
            // With a real sub-score, colour by band and fill to the score. Without one, show the
            // factor's WEIGHT — bar and label both — in neutral brand colour. Previously the bar
            // filled to `weightPct / 0.17` and the trailing slot showed that bare number, which
            // reads as a sub-score: "Resting heart rate 88" for a user with no resting-HR data at
            // all (Q-45). Bar and label must agree, or a near-full grey bar still reads as "good".
            const color = band ? band.color : 'var(--color-brand)'
            const scored = score != null && !provisional
            return (
              <FactorBar
                key={key}
                contributorKey={key}
                label={WEIGHT_LABELS[key]}
                value={scored ? score : weightPct}
                valueLabel={scored ? undefined : `${weightPct}%`}
                muted={!scored}
                color={color}
                linked
              />
            )
          })}
        </div>
        {anyProvisional && (
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
            label: WEIGHT_LABELS[key],
            score: c?.score ?? null,
            provisional: c?.provisional ?? false,
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

function Row({ icon, label, badge, children }: { icon: React.ReactNode; label: string; badge?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <div className="flex items-center gap-1.5 text-muted-foreground min-w-0">
        <span className="flex-none">{icon}</span>
        <span className="truncate">{label}</span>
        {badge && (
          <span
            className="flex items-center gap-0.5 text-[9px] text-muted-foreground/70 flex-none"
            title="Frozen Cloud value from before the direct-BLE re-key — not last night's reading"
          >
            <HistoryIcon className="h-2.5 w-2.5" />
            {badge}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}
