import type { HealthStore } from '../../health/data/HealthStore.ts';

export async function shouldOfferMorning(
  store: Pick<HealthStore, 'getSnapshot' | 'readCheckin'>,
  date: string,
) {
  const hasCheckin = () => {
    const state = store.getSnapshot();
    return (
      !!state.checkins[date] ||
      state.operations.some(
        (operation) => operation.domain === 'day_checkins' && operation.date === date,
      )
    );
  };
  if (hasCheckin()) {
    return false;
  }
  const confirmed = await store.readCheckin(date);
  return hasCheckin() ? false : confirmed ? true : null;
}

export function localHour(timezone: string, now = new Date()) {
  return Number(
    new Intl.DateTimeFormat('en-AU', {
      timeZone: timezone,
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(now),
  );
}
export function goalsReviewDue(
  profile:
    | {
        activityLevel: string | null;
        fitnessGoal: string | null;
        lastGoalReviewAt: string | null;
      }
    | null
    | undefined,
  now = Date.now(),
) {
  return (
    !!profile?.activityLevel &&
    !!profile.fitnessGoal &&
    (!profile.lastGoalReviewAt ||
      now - Date.parse(profile.lastGoalReviewAt) > 14 * 24 * 3_600_000)
  );
}
export function recapHasData(metrics: Record<string, unknown> | undefined) {
  if (!metrics) {
    return true;
  }
  const training = metrics.training as { sessions?: number } | undefined;
  return (
    (training?.sessions ?? 0) > 0 ||
    ['prs', 'muscleSets'].some(
      (key) => Array.isArray(metrics[key]) && (metrics[key] as unknown[]).length > 0,
    ) ||
    ['hrv', 'readiness', 'sleepScore', 'sleepHours', 'stressHighMinutes'].some(
      (key) => (metrics[key] as { week?: unknown } | undefined)?.week != null,
    ) ||
    ['resilience', 'illness', 'ots'].some((key) => metrics[key] != null)
  );
}
