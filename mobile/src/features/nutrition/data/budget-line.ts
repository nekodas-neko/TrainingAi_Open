import { budgetProvenance } from '@trainingai/shared/nutrition/calorie-balance';

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
 * The line under the calorie bar. The own-target and floored wordings are the web's
 * (components/nutrition/calorie-zone-bar.tsx), so Home's Nutrition card and the Nutrition tab say
 * the same thing about a budget held at its floor.
 */
export function budgetLine(provenance: BudgetProvenance): string {
  const total = provenance.total.toLocaleString();
  if (provenance.ownTarget) return `Your own target: ${total} kcal`;
  const chain = provenance.chain;
  if (chain) {
    return chain.totalFloored
      ? `${total} minimum budget — never below your resting rate`
      : `${chain.rmr.toLocaleString()} resting rate − ${chain.deficit.toLocaleString()} goal + ${chain.dailyLiving.toLocaleString()} daily living + ${chain.movement.toLocaleString()} movement = ${total} kcal`;
  }
  return `${provenance.base.toLocaleString()} base + ${provenance.earned.toLocaleString()} movement = ${total} kcal`;
}
