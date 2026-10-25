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
  // Recorded intake alone is enough for "left": the device's food store may not have loaded yet
  // while the server's logged figure and the counted plan meals already have.
  const eaten = total?.calories ?? input.recordedIntake ?? null;
  return {
    total,
    goal,
    remaining: eaten != null && goal != null ? goal - eaten : null,
    targets: input.scaledTargets ?? input.targets,
  };
}

/**
 * The model for the cards that take the energy balance's budget alone as the goal and never fall
 * back to the calorie target: Home's donut and energy-balance widget, the Body tab's Energy Balance
 * and End of Day's totals. The current app's equivalents show nothing (or "kcal" with no
 * denominator) when there is no budget, so these match it (#3282).
 */
export function budgetEnergyModel(input: {
  totals: Totals | null | undefined;
  recordedIntake: number | null | undefined;
  budgetKcal: number | null | undefined;
}): EnergyModel {
  return nutritionEnergyModel({
    ...input,
    targetCalories: null,
    targets: {},
    scaledTargets: null,
  });
}

/** The card's figure and its word: "1,240" and "kcal left", or "kcal over". */
export function remainingText(remaining: number): { value: string; label: string } {
  return {
    value: Math.round(Math.abs(remaining)).toLocaleString(),
    label: `kcal ${remaining < 0 ? 'over' : 'left'}`,
  };
}
