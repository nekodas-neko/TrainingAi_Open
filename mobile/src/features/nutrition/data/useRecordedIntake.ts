import { useEffect } from 'react';
import { useNutrition } from './NutritionProvider';
import { recordedIntakeOf, type IntakeBalance } from './recorded-intake';
export function useRecordedIntake(date: string, balance: IntakeBalance | null | undefined) {
  const n = useNutrition(date);
  useEffect(() => {
    void n.store?.refresh('logs', date);
    void n.store?.refresh('mealTypes', date);
    void n.store?.refresh('mealStatuses', date);
  }, [n.store, date]);
  return recordedIntakeOf(n, date, balance);
}
