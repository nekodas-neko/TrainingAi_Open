'use client'

import type { ReactNode } from 'react'
import { guideFor } from '@trainingai/shared/health/contributor-guide'
import { scoreBand } from '@trainingai/shared/health/score-band'

/**
 * The tap-to-expand deep-dive shown under a contributor bar: what it measures, what it's
 * measured against, what your current score means, and how to move it. Driven by the shared
 * contributor-guide so every health pillar reads the same way. `extra` lets a caller inject
 * real physiological values (e.g. HRV ms, temperature °C) above the interpretation.
 */
export function ContributorDetail({
  contributorKey,
  score,
  provisional,
  extra,
  hideScoreBadge,
}: {
  contributorKey: string
  score?: number | null
  provisional?: boolean
  extra?: ReactNode
  /** Suppress the inline band badge (the caller already shows the score in its header). */
  hideScoreBadge?: boolean
}) {
  const guide = guideFor(contributorKey)
  if (!guide) return null

  const band = score != null ? scoreBand(score) : null
  const meaning = score != null && score < 50 ? guide.low : guide.high

  return (
    <div className="space-y-2.5 pt-2 text-[11px] leading-snug">
      <Field label="What it measures">{guide.measures}</Field>
      <Field label="Measured against">{guide.against}</Field>

      {extra}

      {score != null && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            What your score means
          </p>
          {!hideScoreBadge && band && (
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-foreground">
              <span
                className="rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                style={{ background: `${band.color}22`, color: band.color }}
              >
                {provisional ? 'Learning' : `${band.label} · ${score}/100`}
              </span>
            </p>
          )}
          <p className="mt-1 text-muted-foreground">
            {provisional
              ? 'Still learning your personal baseline — this factor stays neutral until enough nights of ring data accrue, then it scores against your own normal.'
              : meaning}
          </p>
        </div>
      )}
      {score == null && <p className="text-muted-foreground">{meaning}</p>}

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">How to improve it</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
          {guide.remediate.map((tip, i) => (
            <li key={i}>{tip}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-muted-foreground">{children}</p>
    </div>
  )
}
