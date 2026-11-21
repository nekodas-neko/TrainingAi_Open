import { useState } from 'react';
import { CURRENT_VS_QUESTION } from '@trainingai/shared/types/day-checkin';
import { useHealthData } from '../../health/data/HealthDataProvider';
import { readinessVerdictSpec } from '../../health/data/checkin';
import { readinessSpec } from '../../health/data/models';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { failureNotice } from '../../../core/reporting/index.ts';
import { useHome } from './HomeProvider';
import {
  feelCheckin,
  readinessPrompt,
  readinessQuestionDismissKey,
  respondedToday,
  type Feel,
} from './readiness-prompt';

/**
 * The unusual-day readiness question's one reader (#3953): today's prompt, the local dismissal, and
 * the write path for an answer. The unusual-day card and the Exercise Readiness card both read the
 * prompt here, so the trigger and the wording live once.
 */
export function useReadinessQuestion() {
  const health = useHealthData();
  const home = useHome();
  const verdict = useWorkoutResource(readinessVerdictSpec(health.today));
  const readiness = useWorkoutResource(readinessSpec(health.today));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = health.operations.filter(
    (op) => op.domain === 'day_checkins' && op.date === health.today,
  );
  const row = pending.at(-1)?.payload ?? health.checkins[health.today] ?? null;
  const feelAnswered =
    row?.vsNormal != null && (row.vsNormalTouched as boolean | null | undefined) === true;
  // A queued answer is only in `readinessResponses` until its POST lands, so offline or in flight it
  // is the record that the question was dealt with today.
  const prompt = readinessPrompt(
    verdict.data?.verdict,
    feelAnswered || respondedToday(health.readinessResponses, health.today),
    readiness.data?.readinessDisplayScore,
  );
  const dismissedToday = !!home.markers[readinessQuestionDismissKey(health.today)];
  async function answer(feel: Feel) {
    if (!health.store || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await health.store.saveCheckin(
        health.today,
        feelCheckin(row, feel, CURRENT_VS_QUESTION) as Parameters<
          typeof health.store.saveCheckin
        >[1],
      );
      await health.store.respondToReadiness(health.today, 'rated');
      verdict.refresh();
    } catch (failure) {
      setError(failureNotice('Could not save your answer on this phone. Try again.', failure));
    } finally {
      setBusy(false);
    }
  }
  /** "Not now": this phone only, for today. Not an answer, so nothing is queued for the server. */
  async function dismiss() {
    if (!home.store || busy) {
      return;
    }
    setError(null);
    try {
      await home.store.mark(readinessQuestionDismissKey(health.today));
    } catch (failure) {
      setError(failureNotice('Could not save that on this phone. Try again.', failure));
    }
  }
  return { prompt, dismissedToday, busy, error, answer, dismiss };
}
