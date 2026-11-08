// Today's calories against the budget, as the Nutrition energy card shows them. The card and the
// home-screen widget snapshot both read this, so "kcal left" is worked out in one place.

type Totals = { calories: number; proteinG: number; carbsG: number; fatG: number };
type MacroTargets = { proteinG?: number | null; carbsG?: number | null; fatG?: number | null };

export type EnergyInput = {
  totals: Totals | null | undefined;
  /** useRecordedIntake's figure, which wins over the logged total when present. */
  recordedIntake: number | null | undefined;
  /**
   * The energy balance's budget: the only goal. With none, there is no denominator and no "left",
   * never the stored calorie target, as the current app draws it (#2071, #3670).
   */
  budgetKcal: number | null | undefined;
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
  const goal = input.budgetKcal ?? null;
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
 * The model without macro targets, for the cards that show calories alone: Home's donut and
 * energy-balance widget, the Body tab's Energy Balance and End of Day's totals. Like the Nutrition
 * card, they show "kcal" with no denominator when there is no budget (#3282).
 */
export function budgetEnergyModel(input: {
  totals: Totals | null | undefined;
  recordedIntake: number | null | undefined;
  budgetKcal: number | null | undefined;
}): EnergyModel {
  return nutritionEnergyModel({
    ...input,
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
