import { useEffect, useRef } from 'react';
import type { useNutrition } from '../nutrition/data/NutritionProvider';
import type { MealPlan } from '../nutrition/data/models';
import { materialisePlanEstimates } from './data/plan-estimates';

/**
 * Writes today's plan-meal estimates (#3650) whenever what they depend on changes: the plan, the
 * day type, and today's logs and answers as their reads land. One run at a time; a second run
 * finds the first one's estimates already answered and writes nothing.
 */
export function usePlanEstimates(
  n: ReturnType<typeof useNutrition>,
  date: string,
  plan: MealPlan | null | undefined,
  isTrainingDay: boolean | undefined,
) {
  const running = useRef(false);
  const logsLoaded = n.loaded.includes('logs:' + n.today);
  const answersLoaded = n.loaded.includes('answers:' + n.today);
  const { store, ready, today, timezone } = n;
  const logCount = n.view.logs.length;
  const answerCount = n.view.answers.length;
  useEffect(() => {
    if (!store || !ready || date !== today || !plan || running.current) return;
    running.current = true;
    void materialisePlanEstimates({ store, date, timezone, plan, isTrainingDay })
      .catch(() => {
        /* an estimate is never worth an error on screen */
      })
      .finally(() => {
        running.current = false;
      });
  }, [store, ready, today, timezone, date, plan, isTrainingDay, logsLoaded, answersLoaded, logCount, answerCount]);
}
