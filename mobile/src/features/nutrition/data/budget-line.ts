import { formatCount } from '@trainingai/shared/format/number';
import { budgetProvenance, budgetProvenanceText } from '@trainingai/shared/nutrition/calorie-balance';
import { movementSummary } from '@trainingai/shared/nutrition/movement-breakdown';
import type { z } from 'zod';
import type { energySpec } from '../../health/data/models';

type EnergyResponse = z.infer<ReturnType<typeof energySpec>['schema']>;

type Balance = {
  restingBaseKcal?: number | null;
  activeKcal?: number | null;
  targetNetKcal?: unknown;
  restingRateKcal?: number | null;
  deficitKcal?: unknown;
  stepCreditKcal?: unknown;
  ownTargetKcal?: unknown;
};
/**
 * The three addends of `activeKcal`. The server sends them beside `balance`, not inside it, so
 * callers pass the response's root `activeBreakdown`.
 */
export type ActiveBreakdown = Pick<
  NonNullable<EnergyResponse['activeBreakdown']>,
  'workoutKcal' | 'activityKcal' | 'stepsKcal'
>;
export type BudgetProvenance = ReturnType<typeof budgetProvenance>;

/** Where the day's calorie budget came from, or null while the balance lacks its inputs. */
export function balanceProvenance(b: Balance | null | undefined): BudgetProvenance | null {
  if (
    !b ||
    b.restingBaseKcal == null ||
    b.activeKcal == null ||
    typeof b.targetNetKcal !== 'number'
  ) {
    return null;
  }
  return budgetProvenance({
    restingBaseKcal: b.restingBaseKcal,
    activeKcal: b.activeKcal,
    targetNetKcal: b.targetNetKcal,
    restingRateKcal: b.restingRateKcal,
    deficitKcal: typeof b.deficitKcal === 'number' ? b.deficitKcal : null,
    stepCreditKcal: typeof b.stepCreditKcal === 'number' ? b.stepCreditKcal : null,
    ownTargetKcal: typeof b.ownTargetKcal === 'number' ? b.ownTargetKcal : null,
  });
}

/**
 * The "+N earned" chip beside "kcal left" (#4089): the movement addend of the budget, from the same
 * `budgetProvenance` call the current app's energy card reads (`budget.earned`), so it explains the
 * budget and never changes it. Null when it is zero or unknown, so no chip is drawn.
 */
export function earnedChipText(b: Balance | null | undefined): string | null {
  const earned = balanceProvenance(b)?.earned;
  return typeof earned === 'number' && Number.isFinite(earned) && Math.round(earned) > 0
    ? `+${formatCount(earned)} earned`
    : null;
}

/**
 * The line under the calorie bar, from the one shared builder, so Home's Nutrition card, the
 * Nutrition tab and the energy details say the same thing with the same signs.
 */
export function budgetLine(
  provenance: BudgetProvenance,
  balance?: Balance | null,
  activeBreakdown?: ActiveBreakdown | null,
): string {
  return budgetProvenanceText(provenance, {
    restingBaseKcal: balance?.restingBaseKcal,
    targetNetKcal: typeof balance?.targetNetKcal === 'number' ? balance.targetNetKcal : null,
    movementParts: activeBreakdown
      ? movementSummary({
          workoutKcal: activeBreakdown.workoutKcal,
          activityKcal: activeBreakdown.activityKcal,
          stepsKcal: activeBreakdown.stepsKcal,
        })
      : null,
  });
}

/**
 * The log-food sheet's "Today after logging" bar: warning once logging this food would take the
 * day's counted intake past its budget, success otherwise. The current app's assign step does the
 * same flip (`components/nutrition/assign-step.tsx`, BF-175 / #2160): orange over, green within.
 */
export function afterLoggingBarTone(afterKcal: number, budgetKcal: number): 'success' | 'warning' {
  return afterKcal > budgetKcal ? 'warning' : 'success';
}
