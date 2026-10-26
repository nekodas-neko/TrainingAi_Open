import type { HealthStore } from '../../health/data/HealthStore.ts';

/**
 * Whether the morning sheet should open itself. It keys on the sleep feel being missing, not on a
 * check-in row existing: a Home readiness answer (#2106) creates the day's row without one, and
 * that must not stop the sheet offering itself. Every save of the sheet writes a numeric
 * `sleepQualityFeel`, so a number there means the sheet has been done.
 */
export async function shouldOfferMorning(
  store: Pick<HealthStore, 'getSnapshot' | 'readCheckin'>,
  date: string,
) {
  const sleepFeelSaved = () => {
    const state = store.getSnapshot();
    const pending = state.operations
      .filter((operation) => operation.domain === 'day_checkins' && operation.date === date)
      .at(-1);
    const row = (pending?.payload ?? state.checkins[date]) as
      | { sleepQualityFeel?: unknown }
      | null
      | undefined;
    return typeof row?.sleepQualityFeel === 'number';
  };
  if (sleepFeelSaved()) {
    return false;
  }
  const confirmed = await store.readCheckin(date);
  return sleepFeelSaved() ? false : confirmed ? true : null;
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

/**
 * The tint of each updates-strip icon, by type, as the current app's `home-banner-strip.tsx` draws
 * it: goals cyan, day amber, week purple. Keyed on the entry's type, never its position, so a
 * dismissed row cannot hand its colour to the next.
 */
export type BannerType = 'goals' | 'day' | 'week';
export const bannerTone = {
  goals: 'activity',
  day: 'checkin',
  week: 'sleep',
} as const satisfies Record<BannerType, string>;
