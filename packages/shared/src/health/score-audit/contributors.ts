import type { AuditContributor, AuditSignal } from './types'

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp

export interface ContributorSpec {
  key: string
  label: string
  input: AuditSignal
  /** Why this contributor has no sub-score, when it doesn't. */
  excludedReason?: string
  provisional?: boolean
}

/**
 * Build contributor rows for a *renormalising* weighted-mean model (Sleep, Activity): the score
 * module returns sub-scores only for the contributors it actually included, and the weight of every
 * excluded one is redistributed across the rest. `weights` is the model's own exported table, so
 * the effective weights here are the ones the score really used — not a re-derivation.
 *
 * Fidelity note: these modules expose sub-scores already rounded to integers, while the score itself
 * is the weighted mean of the *unrounded* values. Summing the contributions below can therefore land
 * up to a point off the reported score. {@link contributionSum} surfaces that gap explicitly rather
 * than leaving it to be mistaken for a weighting bug.
 */
export function renormalisedContributors(
  specs: ContributorSpec[],
  components: Record<string, number> | null,
  weights: Record<string, number>,
): AuditContributor[] {
  const totalWeight = specs.reduce(
    (sum, spec) => sum + (components?.[spec.key] != null ? weights[spec.key] ?? 0 : 0),
    0,
  )

  return specs.map(spec => {
    const weight = weights[spec.key] ?? 0
    const subScore = components?.[spec.key] ?? null
    const effectiveWeight = subScore != null && totalWeight > 0 ? weight / totalWeight : null
    return {
      key: spec.key,
      label: spec.label,
      input: spec.input,
      subScore,
      weight,
      effectiveWeight: effectiveWeight != null ? round(effectiveWeight, 4) : null,
      contribution: subScore != null && effectiveWeight != null ? round(subScore * effectiveWeight, 2) : null,
      provisional: spec.provisional ?? false,
      excludedReason: subScore == null ? spec.excludedReason ?? 'no input available for this day' : null,
    }
  })
}

/**
 * Sum of the contributions in `rows` — the score rebuilt from its parts. Compare against the
 * model's own score to confirm nothing is unaccounted for; a gap of ≤1 is the rounding described
 * on {@link renormalisedContributors}, anything larger is a real discrepancy.
 */
export function contributionSum(rows: AuditContributor[]): number {
  return round(rows.reduce((s, r) => s + (r.contribution ?? 0), 0), 2)
}

/**
 * Build contributor rows for a *fixed-weight* model (Readiness): every contributor always scores —
 * a missing signal falls back to neutral rather than dropping out — so the weights are already
 * absolute and need no renormalisation.
 */
export function fixedWeightContributors(
  specs: (ContributorSpec & { subScore: number; provisional: boolean })[],
  weights: Record<string, number>,
): AuditContributor[] {
  return specs.map(spec => {
    const weight = weights[spec.key] ?? 0
    return {
      key: spec.key,
      label: spec.label,
      input: spec.input,
      subScore: spec.subScore,
      weight,
      effectiveWeight: weight,
      contribution: round(spec.subScore * weight, 2),
      provisional: spec.provisional,
      excludedReason: spec.provisional ? spec.excludedReason ?? null : null,
    }
  })
}
