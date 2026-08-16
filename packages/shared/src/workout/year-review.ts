import { shiftDateStr } from "@trainingai/shared/date-utils";

// Monday ("YYYY-MM-DD") of the week containing a given day string.
function mondayOf(dayStr: string): string {
  const dow = (new Date(`${dayStr}T00:00:00Z`).getUTCDay() + 6) % 7; // 0=Mon..6=Sun
  return shiftDateStr(dayStr, -dow);
}

// Longest run of consecutive ISO weeks (Monday-to-Monday, 7 days apart) with >=1 session.
export function longestWeeklyStreak(sessionDayStrs: string[]): number {
  const mondays = Array.from(new Set(sessionDayStrs.map(mondayOf))).sort();
  if (mondays.length === 0) return 0;
  let longest = 1;
  let current = 1;
  for (let i = 1; i < mondays.length; i++) {
    const prevMs = new Date(`${mondays[i - 1]}T00:00:00Z`).getTime();
    const nextMs = new Date(`${mondays[i]}T00:00:00Z`).getTime();
    if ((nextMs - prevMs) / 86_400_000 === 7) {
      current++;
      longest = Math.max(longest, current);
    } else {
      current = 1;
    }
  }
  return longest;
}

// 12 monthly buckets over the trailing year, index 0 = 11 months ago ... index 11 = this month.
export function monthlySessionCounts(sessionDayStrs: string[], todayDayStr: string): number[] {
  const counts = new Array(12).fill(0);
  const [ty, tm] = todayDayStr.split("-").map(Number);
  for (const dayStr of sessionDayStrs) {
    const [y, m] = dayStr.split("-").map(Number);
    const monthsAgo = (ty - y) * 12 + (tm - m);
    if (monthsAgo >= 0 && monthsAgo < 12) counts[11 - monthsAgo]++;
  }
  return counts;
}
