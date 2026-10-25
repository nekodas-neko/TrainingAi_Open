import { balanceZone } from '@trainingai/shared/nutrition/calorie-balance';
import { countedIntakeKcal, readEstimateRows } from '@trainingai/shared/nutrition/counted-intake';
export type IntakeBalance = {
  intakeKcal?: number | null;
  loggedIntakeKcal?: unknown;
  estimatedKcal?: unknown;
  /** #2863. The counted plan-meal estimates, one per meal type (`balance.estimatedMeals`). */
  estimatedMeals?: unknown;
  budgetKcal?: number | null;
  expenditureKcal?: number | null;
  remainingKcal?: number | null;
  zoneLabel?: string | null;
};
/**
 * The day's intake for every native calorie surface: logged food (the device's own when it holds
 * logs or unsynced edits, else the server's logged figure) plus the plan meals counted as estimated,
 * through the shared `countedIntakeKcal` the current app and the server read (#2863).
 *
 * The estimates come from the server as rows per meal type, and the device's own logged meal types
 * drop any the device has superseded, so a meal logged here but not yet synced is not counted twice.
 * A day where every meal is skipped counts no estimate.
 */
export function recordedIntake(input: {
  calories: number | null;
  hasLogs: boolean;
  pending: boolean;
  allSkipped: boolean;
  /** Meal types of the device's logs for the day. */
  loggedMealTypeIds?: readonly (string | null | undefined)[];
  balance: IntakeBalance | null | undefined;
}) {
  const b = input.balance;
  const server =
    typeof b?.loggedIntakeKcal === 'number'
      ? b.loggedIntakeKcal
      : b?.intakeKcal == null
        ? null
        : Math.max(
            0,
            b.intakeKcal - (typeof b.estimatedKcal === 'number' ? b.estimatedKcal : 0),
          );
  const logged =
    input.hasLogs || input.pending || input.allSkipped
      ? input.calories
      : (server ?? input.calories);
  const estimates = input.allSkipped ? [] : readEstimateRows(b?.estimatedMeals);
  const intake =
    logged == null && estimates.length === 0
      ? null
      : countedIntakeKcal({
          loggedKcal: logged ?? 0,
          estimates,
          loggedMealTypeIds: input.loggedMealTypeIds,
        });
  const remaining =
    !input.pending && typeof b?.remainingKcal === 'number'
      ? b.remainingKcal
      : intake != null && b?.budgetKcal != null
        ? b.budgetKcal - intake
        : null;
  const net = intake != null && b?.expenditureKcal != null ? intake - b.expenditureKcal : null;
  return {
    intake,
    remaining,
    net,
    zoneLabel:
      intake != null && b?.budgetKcal != null
        ? balanceZone(Math.round(intake) - Math.round(b.budgetKcal)).label
        : (b?.zoneLabel ?? null),
  };
}

/** recordedIntake from what the nutrition store holds for `date` (useNutrition's view and queue). */
export function recordedIntakeOf(
  n: {
    view: {
      totals?: { calories: number } | null;
      logs: readonly { mealTypeId: string }[];
      mealTypes: readonly { id: string }[];
      mealStatuses: Record<string, string>;
    };
    operations: readonly { date: string; domain: string }[];
  },
  date: string,
  balance: IntakeBalance | null | undefined,
) {
  return recordedIntake({
    calories: n.view.totals?.calories ?? null,
    hasLogs: n.view.logs.length > 0,
    loggedMealTypeIds: n.view.logs.map((x) => x.mealTypeId),
    pending: n.operations.some((x) => x.date === date && x.domain === 'food_logs'),
    allSkipped:
      n.view.mealTypes.length > 0 &&
      n.view.mealTypes.every((x) => n.view.mealStatuses[x.id] === 'skipped'),
    balance,
  });
}
