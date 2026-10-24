// Today's calories against the budget, as the Nutrition energy card shows them. The card and the
// home-screen widget snapshot both read this, so "kcal left" is worked out in one place.

type Totals = { calories: number; proteinG: number; carbsG: number; fatG: number };
type MacroTargets = { proteinG?: number | null; carbsG?: number | null; fatG?: number | null };

export type EnergyInput = {
  totals: Totals | null | undefined;
  /** useRecordedIntake's figure, which wins over the logged total when present. */
  recordedIntake: number | null | undefined;
  /** The energy balance's budget, which wins over the calorie target. */
  budgetKcal: number | null | undefined;
  targetCalories: number | null | undefined;
  targets: MacroTargets;
  /** The balance's activity-scaled macro targets, which win over the stored ones. */
  scaledTargets: MacroTargets | null | undefined;
};

export type EnergyModel = {
  total: Totals | null;
  goal: number | null;
  /** Negative when over; null without a goal. */
  remaining: number | null;
  targets: MacroTargets;
};

export function nutritionEnergyModel(input: EnergyInput): EnergyModel {
  const total =
    input.totals && input.recordedIntake != null
      ? { ...input.totals, calories: input.recordedIntake }
      : (input.totals ?? null);
  const goal = input.budgetKcal ?? input.targetCalories ?? null;
  return {
    total,
    goal,
    remaining: total && goal != null ? goal - total.calories : null,
    targets: input.scaledTargets ?? input.targets,
  };
}

/** The card's figure and its word: "1,240" and "kcal left", or "kcal over". */
export function remainingText(remaining: number): { value: string; label: string } {
  return {
    value: Math.round(Math.abs(remaining)).toLocaleString(),
    label: `kcal ${remaining < 0 ? 'over' : 'left'}`,
  };
}
