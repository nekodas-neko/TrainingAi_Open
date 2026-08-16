import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRepository } from "@/lib/data";
import { formatInTimeZone } from "date-fns-tz";
import { DEFAULT_TZ, todayInTz, startOfWeekInTz, aestMidnight, toAestDay, shiftDateStr } from "@trainingai/shared/date-utils";
import { getScheduledSessionsPerWeek } from "@trainingai/shared/schedule-utils";
import { computeWeightRateKgPerWeek } from "@trainingai/shared/health/long-term-goal-progress";
import { nightSessions } from "@trainingai/shared/health/sleep-night";

export interface ProgressSummaryResponse {
  sleep: { lastNightHours: number | null; thisWeekHours: number };
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
  const sevenDaysAgo = formatInTimeZone(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), tz, 'yyyy-MM-dd');
  const fourteenDaysAgo = shiftDateStr(today, -13);

  const [sleepSessions, program, dayExercises, nextSession, bodyBaseline, weekSessionsAll, weightHistory] = await Promise.all([
    repo.listSleepSessions(userId, sevenDaysAgo, today),
    repo.getActiveProgram(userId),
    repo.getDayExerciseNames(userId, today.replace(/-/g, '/')),
    repo.getNextSession(userId, tz),
    repo.getBodyMetricsBaseline(userId),
    repo.getWorkoutSessionsFrom(userId, mondayUtc),
    repo.listBodyMetrics(userId, fourteenDaysAgo, today),
  ]);

  const orderedWeights = [...weightHistory]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(m => m.weightKg)
    .filter((w): w is number => w != null);
  const weightRateKgPerWeek = computeWeightRateKgPerWeek(orderedWeights);

  // "Last night" and "this week" are counts of nights, not of rows (Q-76). Sorting the raw list by
  // date descending picks arbitrarily between an evening nap and the night that followed it on the
  // same date, which is how a 0.1 h bout became "last night's sleep"; a fragmented night also has to
  // come back as one night, not two short ones. `nightSessions` is oldest-first, so `.at(-1)` is
  // last night. Naps drop out of the weekly total too — the card says "sleep", and a nights-only
  // total is the number that lines up with the nightly figure above it.
  const nights = nightSessions(sleepSessions, tz);
  const lastNightHours = nights.at(-1)?.durationHours ?? null;
  const thisWeekHours = nights
    .filter(ss => ss.date >= weekStartStr)
    .reduce((sum, ss) => sum + (ss.durationHours ?? 0), 0);

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
