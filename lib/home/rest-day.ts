import type { NextSessionRecommendation } from "@trainingai/shared/types/program";
import { todayInTz } from "@trainingai/shared/date-utils";

// Rest day is a transient, client-side choice for today — /api/log-rest-day persists
// nothing (rest days are inferred from gaps in workout history), so refetching
// /api/next-session after choosing rest just recomputes the prompt and reverts the
// selection. We persist the choice in a date-stamped localStorage marker so it sticks
// across navigation for the rest of the day and survives remounts.
export const REST_DAY_KEY = "ta_rest_day";

export function isRestDayChosen(): boolean {
  if (typeof window === "undefined") return false;
  try { return localStorage.getItem(REST_DAY_KEY) === todayInTz(); } catch { return false; }
}

export function markRestDayChosen(): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(REST_DAY_KEY, todayInTz()); } catch { /* ignore */ }
}

export function withRestDayOverride(rec: NextSessionRecommendation | null): NextSessionRecommendation | null {
  if (!rec || !isRestDayChosen()) return rec;
  return { ...rec, isRestDay: true, deloadOrRestRecommended: false };
}
