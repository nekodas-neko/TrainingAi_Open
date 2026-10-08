import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRepository } from "@/lib/data";
import { DEFAULT_TZ, todayInTz, startOfWeekInTz, aestMidnight, toAestDay, shiftDateStr } from "@trainingai/shared/date-utils";
import { getScheduledSessionsPerWeek } from "@trainingai/shared/schedule-utils";
import { computeWeightRateKgPerWeek } from "@trainingai/shared/health/long-term-goal-progress";
import { nightSessions, canonicalLatestNight, recordsSleep } from "@trainingai/shared/health/sleep-night";

export interface ProgressSummaryResponse {
  // #2337: `thisWeekHours` is null when no night this week has a duration — "0 h" against a sleep
  // goal is a claim about a week nothing recorded. A payload cached before this is still a number.
  sleep: { lastNightHours: number | null; thisWeekHours: number | null };
  workouts: { todayComplete: boolean; completedThisWeek: number; scheduledThisWeek: number };
  bodyBaseline: { weightKg: number | null; bodyFatPct: number | null };
  // kg/week linear-regression slope over the last 14 days of weight readings —
  // paired with evaluateWeightRateVsGoalBand (lib/health/long-term-goal-progress.ts)
  // client-side against the user's target weight.
  weightRateKgPerWeek: number | null;
}

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const repo = await getRepository();
  const tz = session.user?.timezone ?? DEFAULT_TZ;
  const today = todayInTz(tz);
  const weekStartStr = startOfWeekInTz(tz);
  const [wy, wm, wd] = weekStartStr.split('-').map(Number);
  const mondayUtc = aestMidnight(wy, wm, wd, tz);
  const sevenDaysAgo = shiftDateStr(today, -7);
  const fourteenDaysAgo = shiftDateStr(today, -13);

  // RV-82: the program comes off `nextSession` below, which already fetched it — this route used
  // to run `getActiveProgram`, a fixed 5-query composite, a second time in the same request.
  const [sleepSessions, dayExercises, nextSession, bodyBaseline, weekSessionsAll, weightHistory] = await Promise.all([
    repo.listSleepSessions(userId, sevenDaysAgo, today),
    repo.getDayExerciseNames(userId, today.replace(/-/g, '/'), tz),
    repo.getNextSession(userId, tz),
    repo.getBodyMetricsBaseline(userId),
    repo.getWorkoutSessionsFrom(userId, mondayUtc),
    repo.listBodyMetrics(userId, fourteenDaysAgo, today),
  ]);
  const program = nextSession.program ?? null;

  // Dated points, not bare numbers (LB-67): rows exist only on days carrying a metric, so a fit
  // against array position reports a slope per READING as though it were per day. The sort and the
  // null filter live inside the shared fit now.
  const weightRateKgPerWeek = computeWeightRateKgPerWeek(weightHistory);

  // "Last night" and "this week" are counts of nights, not of rows (Q-76). Sorting the raw list by
  // date descending picks arbitrarily between an evening nap and the night that followed it on the
  // same date, which is how a 0.1 h bout became "last night's sleep"; a fragmented night also has to
  // come back as one night, not two short ones. `nightSessions` is oldest-first, so `.at(-1)` is
  // last night. Naps drop out of the weekly total too — the card says "sleep", and a nights-only
  // total is the number that lines up with the nightly figure above it.
  const nights = nightSessions(sleepSessions, tz);
  const lastNightHours = canonicalLatestNight(nights, tz)?.durationHours ?? null;
  // Missing is not zero (#2337): a week with no measured night has no total, and summing nothing into
  // 0 told a user with no sleep source they had slept 0 h. A night that recorded nothing
  // (`recordsSleep`) is left out rather than counted as 0; it never moved a real week's total.
  const weekNightHours = nights
    .filter(ss => ss.date >= weekStartStr)
    .map(ss => ss.durationHours)
    .filter((h): h is number => recordsSleep(h));
  const thisWeekHours = weekNightHours.length > 0 ? weekNightHours.reduce((sum, h) => sum + h, 0) : null;

  const trainedToday = dayExercises.length > 0;
  const todayComplete = trainedToday || nextSession.isRestDay;

  const weekSessions = weekSessionsAll.filter(ws => ws.exercises.length > 0);
  const uniqueSessionDays = new Set(
    weekSessions.map(ws => `${toAestDay(ws.startedAt, tz)}|${ws.sessionName}`)
  );
  const completedThisWeek = uniqueSessionDays.size;

  const scheduledThisWeek = program ? getScheduledSessionsPerWeek(program) : 0;

  return NextResponse.json(
    {
      sleep: { lastNightHours, thisWeekHours },
      workouts: { todayComplete, completedThisWeek, scheduledThisWeek },
      bodyBaseline,
      weightRateKgPerWeek,
    } satisfies ProgressSummaryResponse,
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
