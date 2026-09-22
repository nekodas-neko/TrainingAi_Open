import { STREAK_LOOKBACK_DAYS } from "@trainingai/shared/workout/streak-window";

/** Counts calendar days in the active window (training + allowed rest days).
 *
 *  Lifted out of `session-select-content.tsx` so that file could stay under its size baseline;
 *  nothing about the rule changed in the move. `dayKey(n)` is the caller's timezone-aware
 *  "n days ago" key — it is passed in rather than derived here so the count and the week strip
 *  above it can never disagree about which day is which.
 *
 *  A zero return means "no trained day in the window", which is NOT the same as "we could not
 *  read the window" — the caller holds that distinction (RV-86) and this function has no way to
 *  express it. */
export function computeStreak(
  trainedDays: Record<string, string[]>,
  dayKey: (daysAgo?: number) => string,
): number {
  let count = 0;
  let consecutiveRest = 0;
  // 2 consecutive rest days keep the streak (warning); the 3rd breaks it — mirrors
  // the server rule in lib/ai-periodization/ai-dynamic.ts (streakWarning at 2,
  // streakBroken at >= 3) and the StreakCard banner copy. Breaking here at > 1 made
  // the count one day stricter than the banner promised.
  const MAX_REST_GAP = 2;
  // Only credit today if already trained — don't consume the rest-day allowance
  // for a day that hasn't ended yet.
  if ((trainedDays[dayKey(0)] ?? []).length > 0) count = 1;
  // Walk back from yesterday so an untrained today doesn't break the streak.
  // The bound is the SHARED constant, not a literal (RV-57): its module calls itself a contract
  // between the route that decides how many days to send and this loop that decides how far to
  // walk, and a literal here cannot be held to it. The value is unchanged — 365 either way — so
  // this changes nothing today and makes BF-176 unrepeatable tomorrow.
  for (let ago = 1; ago < STREAK_LOOKBACK_DAYS; ago++) {
    const trained = (trainedDays[dayKey(ago)] ?? []).length > 0;
    if (trained) {
      count += 1 + consecutiveRest;
      consecutiveRest = 0;
    } else {
      consecutiveRest++;
      if (consecutiveRest > MAX_REST_GAP) break;
    }
  }
  return count;
}
