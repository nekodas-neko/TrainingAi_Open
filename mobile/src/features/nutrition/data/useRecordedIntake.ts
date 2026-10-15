import { useEffect } from 'react';
import { useNutrition } from './NutritionProvider';
import { recordedIntake, type IntakeBalance } from './recorded-intake';
export function useRecordedIntake(date: string, balance: IntakeBalance | null | undefined) {
  const n = useNutrition(date);
  useEffect(() => {
    void n.store?.refresh('logs', date);
    void n.store?.refresh('mealTypes', date);
    void n.store?.refresh('mealStatuses', date);
  }, [n.store, date]);
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
