import { plural } from "@trainingai/shared/format/plural";
import type { BodyBatteryLabel } from "@trainingai/shared/health/body-battery-band";

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
  remaining: number | null;
  budget: number | null;
}) {
  const calories = input.intake ?? input.loggedKcal;
  const budget = input.budget != null && input.budget > 0 ? input.budget : null;
  return {
    calories,
    budget,
    remaining:
      budget == null ? null : Math.max(0, input.remaining ?? budget - calories),
    fraction: budget == null ? null : calories / budget,
  };
}

type BatteryTheme = {
  colors: { danger: string };
  tones: { checkin: { foreground: string }; activity: { foreground: string } };
};

/** Same three bands as the shared `bodyBatteryColor`, in theme colours rather than CSS variables. */
export function batteryColor(label: BodyBatteryLabel, theme: BatteryTheme) {
  if (label === "Drained") return theme.colors.danger;
  if (label === "Low") return theme.tones.checkin.foreground;
  return theme.tones.activity.foreground;
}
