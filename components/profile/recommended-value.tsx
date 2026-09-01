'use client'

import { Check } from 'lucide-react'

interface RecommendedValueProps {
  /** The deterministic baseline for this field, or `null` when the profile can't produce one. */
  recommended: number | null
  /** What the field holds right now, parsed. `null` for an empty field. */
  current: number | null
  unit?: string
  /** One short phrase naming where the number comes from, e.g. "33 ml/kg + your activity bump". */
  why: string
  onApply: (value: number) => void
}

/**
 * BF-101. A per-field "Recommended" affordance on the goals form, computed rather than generated.
 *
 * It renders in two states on purpose, and the matching state is the half that earns its place:
 * the owner's steps goal was 7,000 (the *sedentary* number) while his activity level said Moderate
 * (10,000), and his water goal tracked its own formula correctly — one field following the
 * recommendation and another not, with nothing on screen saying which. A button that only ever
 * offered a value would show both fields identically.
 *
 * Equality is exact. A tolerance would let "matches" cover a number the formula did not produce,
 * which is the claim this control exists to make honestly.
 */
export function RecommendedValue({ recommended, current, unit, why, onApply }: RecommendedValueProps) {
  if (recommended == null) return null
  const label = `${recommended.toLocaleString()}${unit ? ` ${unit}` : ''}`

  if (current === recommended) {
    return (
      <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <Check className="h-3 w-3 shrink-0" />
        <span>Matches the recommended {label} — {why}</span>
      </p>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onApply(recommended)}
      className="w-full rounded-xl border border-border px-3 py-2 text-left transition hover:bg-muted"
    >
      <span className="text-[11px] font-medium">Use recommended: {label}</span>
      <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">{why}</span>
    </button>
  )
}
