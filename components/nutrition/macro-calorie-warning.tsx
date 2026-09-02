'use client'

import { TriangleAlert } from 'lucide-react'
import { macroCalorieDisagreement, MACRO_MISMATCH_VISIBLE_LIMIT } from '@trainingai/shared/nutrition/scan-totals'

/**
 * The stated calories do not match the stated macros (BF-109).
 *
 * The owner scanned a barcode and got **173 kcal** beside 45.7 P / 52.1 C / 13.6 F — macros that
 * come to **514** by Atwater. The screen was right and the row was wrong: Open Food Facts is filled
 * in field by field by different contributors, and that product's energy is simply wrong at source
 * (its per-100g figure is derived from the same bad number, so there is nothing to fall back to).
 *
 * **The check already existed and the barcode path was the one surface without it.** The OFF
 * text-search list has surfaced `macroCalorieDisagreement` since it was written; `/api/nutrition/scan`
 * and `/api/nutrition/food-items` run `sanitiseNutrition`. `/api/nutrition/barcode` does neither, and
 * `logFoodEntries` deliberately does not sanitise — so this was a sibling-surface gap rather than a
 * new problem.
 *
 * **It warns and offers; it never rewrites on its own.** Review exists for the user to decide, and a
 * screen showing one number while the store keeps another is a worse bug than the one being fixed.
 * It would also destroy the legitimate case: fibre and alcohol put some real foods 10–20% out.
 */
interface Props {
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  /** Applies the Atwater figure. The user's tap, never automatic. */
  onUseMacroCalories: (calories: number) => void
}

export function MacroCalorieWarning({ calories, proteinG, carbsG, fatG, onUseMacroCalories }: Props) {
  const off = macroCalorieDisagreement({ calories, proteinG, carbsG, fatG })
  if (off == null || off <= MACRO_MISMATCH_VISIBLE_LIMIT) return null

  const fromMacros = Math.round(proteinG * 4 + carbsG * 4 + fatG * 9)

  return (
    <div
      className="rounded-xl border p-3"
      style={{
        borderColor: 'color-mix(in oklch, var(--accent-amber) 40%, transparent)',
        background: 'color-mix(in oklch, var(--accent-amber) 10%, transparent)',
      }}
    >
      {/* An icon and words, never colour alone — the amber tint is the least of what says this. */}
      <p className="flex items-start gap-1.5 text-xs font-medium">
        <TriangleAlert
          className="mt-0.5 h-3.5 w-3.5 shrink-0"
          style={{ color: 'var(--accent-amber)' }}
          aria-hidden="true"
        />
        <span>
          These macros come to {fromMacros.toLocaleString()} kcal, not {Math.round(calories).toLocaleString()}.
        </span>
      </p>
      <p className="mt-0.5 pl-5 text-[11px] leading-snug text-muted-foreground">
        Food databases are filled in field by field, so one number can be wrong while the rest are
        right. Check the label — high-fibre foods are legitimately a little out.
      </p>
      <button
        onClick={() => onUseMacroCalories(fromMacros)}
        className="mt-2 w-full min-h-[44px] rounded-xl bg-foreground text-background text-xs font-semibold"
      >
        Use {fromMacros.toLocaleString()} kcal
      </button>
    </div>
  )
}
