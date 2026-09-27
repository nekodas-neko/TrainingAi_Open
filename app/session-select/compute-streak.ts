import { computeDayStreak, streakRestGapFor } from "@trainingai/shared/workout/day-streak";
import type { Schedule } from "@trainingai/shared/types/program";

/**
 * Home's streak number — a SHAPE ADAPTER now, not a formula (LA-156).
 *
 * This file used to carry its own copy of the calendar-day rule with the rest gap hardcoded to
 * **2**, which is the floor rather than the answer: `streakRestGapFor` raises it from the user's
 * own schedule, so somebody training Mon+Tue gets 5 (BF-122a). Home could not do that because it
 * never read the schedule, so for a weekly user it under-reported against `/api/achievements`.
 * The rule is `computeDayStreak`'s and lives once (RV-216).
 *
 * **The file survives rather than being deleted**, which `LA-156`'s "done when" asked for: its
 * caller is a size-ratcheted hotspot with four lines of headroom, and inlining this would need
 * about six. What the entry was really asking for — that the duplicated RULE is gone — is done.
 * Nothing below decides what a streak is; it converts Home's `Record<date, sessions>` into the
 * dates array the shared function takes.
 */
/** The slice of the user's schedule the rest gap is derived from, or null when there is none. */
export type StreakSchedule = Pick<Schedule, "type" | "restAfterN" | "days"> | null;

export function computeStreak(
  trainedDays: Record<string, string[]>,
  todayStr: string,
  schedule: StreakSchedule,
): number {
  // ⚠ SLASHES → DASHES, and this is the whole reason a shape adapter is worth having. Home's keys
  // come from `dayKeyInTz`, which ends `.replace(/-/g, '/')` — while `computeDayStreak` does
  // `Date.parse(`${d}T00:00:00Z`)`, and `Date.parse('2026/09/27T00:00:00Z')` is **NaN**. Passing
  // Home's keys straight through would not throw: every gap would be NaN, every comparison false,
  // and the card would quietly print a wrong number. Normalising here is not tidying.
  const norm = (d: string) => d.replace(/\//g, "-");
  const dates = Object.keys(trainedDays).filter(d => (trainedDays[d] ?? []).length > 0).map(norm);
  // `.current`, not `.best`: the card reads "STREAK … days" about the run up to today, and the
  // banner beside it talks about the streak you are in.
  return computeDayStreak(dates, norm(todayStr), streakRestGapFor(schedule)).current;
}
