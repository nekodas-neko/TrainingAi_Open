/**
 * How a food's brand joins its row (RV-208 ⑤).
 *
 * **The name leads and the brand is a qualifier, everywhere.** Two of the five surfaces put the
 * brand in FRONT of the name — `Uncle Tobys — Rolled oats` in the food-database results and the
 * recents panel — while the diary, the describe-sheet matches and the quick-edit header all lead
 * with the name and demote the brand. The entry asked for one of the two; this is the one, and not
 * only for consistency: both brand-leading sites are SEARCH lists, where the user typed the food
 * name, so leading with the brand pushes the term they matched on rightward and `FoodRow`'s
 * `line-clamp-2` can truncate it away at 384 px. Sorting a list of one brand's products under a
 * word nobody is scanning for is the same defect in slow motion.
 *
 * `·` rather than `—` because that is what the three name-leading sites already use, and the
 * secondary line may carry two facts (`Uncle Tobys · 40 g serving`) where a dash reads as a range.
 */
export function foodSecondaryLine(
  brand: string | null | undefined,
  rest?: string | null,
): string | null {
  const b = brand?.trim() || null
  const r = rest?.trim() || null
  if (b && r) return `${b} · ${r}`
  return b ?? r
}
