import { balanceZone } from '@trainingai/shared/nutrition/calorie-balance';
export type IntakeBalance = {
  intakeKcal?: number | null;
  loggedIntakeKcal?: unknown;
  estimatedKcal?: unknown;
  budgetKcal?: number | null;
  expenditureKcal?: number | null;
  zoneLabel?: string | null;
};
export function recordedIntake(input: {
  calories: number | null;
  hasLogs: boolean;
  pending: boolean;
  allSkipped: boolean;
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
  const intake =
    input.hasLogs || input.pending || input.allSkipped
      ? input.calories
      : (server ?? input.calories);
  const remaining = intake != null && b?.budgetKcal != null ? b.budgetKcal - intake : null;
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
