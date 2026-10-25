import { plural } from "@trainingai/shared/format/plural";
import { budgetEnergyModel } from "./energy-model";

const thousands = (value: number) => Math.round(value).toLocaleString();

// A food with no brand has no leading dot: "125 g · 80 kcal", not " · 125 g · 80 kcal".
export function foodLine(
  brand: string | null | undefined,
  servingSizeG: number,
  calories: number,
) {
  return [brand?.trim(), `${servingSizeG} g`, `${thousands(calories)} kcal`]
    .filter(Boolean)
    .join(" · ");
}

export function portionKcalLine(servings: number, totalKcal: number) {
  return `${plural(servings, "portion", "portions")} · ${thousands(totalKcal / servings)} kcal per portion`;
}

export function recipeCountLine(ingredients: number, servings: number) {
  return `${plural(ingredients, "ingredient", "ingredients")} · ${plural(servings, "portion", "portions")}`;
}

/** "+" for a surplus, "−" (a real minus) for a deficit, nothing at zero. */
export function signedKcal(netKcal: number) {
  const sign = netKcal > 0 ? "+" : netKcal < 0 ? "−" : "";
  return `${sign}${thousands(Math.abs(netKcal))}`;
}

/**
 * The figures End of Day's totals show. Intake is the counted one (logged food plus the plan meals
 * counted as estimated) so the sheet agrees with the energy ring; the logged total is the fallback
 * only while no counted figure exists.
 */
export function dayTotalFigures(input: {
  loggedKcal: number;
  intake: number | null;
  budget: number | null;
}) {
  const calories = input.intake ?? input.loggedKcal;
  const budget = input.budget != null && input.budget > 0 ? input.budget : null;
  const { remaining } = budgetEnergyModel({
    totals: { calories: input.loggedKcal, proteinG: 0, carbsG: 0, fatG: 0 },
    recordedIntake: input.intake,
    budgetKcal: budget,
  });
  return {
    calories,
    budget,
    remaining: remaining == null ? null : Math.max(0, remaining),
    fraction: budget == null ? null : calories / budget,
  };
}

export { batteryColor } from '../../../shared/battery-color';
