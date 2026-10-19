import { budgetProvenance, budgetProvenanceText } from '@trainingai/shared/nutrition/calorie-balance';

type Balance = {
  restingBaseKcal?: number | null;
  activeKcal?: number | null;
  targetNetKcal?: unknown;
  restingRateKcal?: number | null;
  deficitKcal?: unknown;
  stepCreditKcal?: unknown;
  ownTargetKcal?: unknown;
};
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
 * The line under the calorie bar, from the one shared builder, so Home's Nutrition card, the
 * Nutrition tab and the energy details say the same thing with the same signs.
 */
export function budgetLine(provenance: BudgetProvenance, balance?: Balance | null): string {
  return budgetProvenanceText(provenance, {
    restingBaseKcal: balance?.restingBaseKcal,
    targetNetKcal: typeof balance?.targetNetKcal === 'number' ? balance.targetNetKcal : null,
  });
}
