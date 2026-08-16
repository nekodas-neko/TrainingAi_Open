import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRepository } from "@/lib/data";
import { DEFAULT_TZ, todayInTz, shiftDateStr, aestMidnight, toAestDay } from "@trainingai/shared/date-utils";
import { longestWeeklyStreak, monthlySessionCounts } from "@trainingai/shared/workout/year-review";
import { pickHeadlinePersonalRecord } from "@trainingai/shared/1rm";

const TOP_EXERCISE_LIMIT = 5;

export interface YearReviewTopExerciseView {
  exerciseName: string;
  setCount: number;
  first1rm: number | null;
  last1rm: number | null;
  /** `'bodyweight'` means the 1RMs are a BW_REF-relative index, not kilograms. */
  exerciseType: string | null;
}

export interface YearReviewResponse {
  sessionCount: number;
  totalSets: number;
  totalVolumeKg: number;
  totalMinutes: number;
  topExercises: YearReviewTopExerciseView[];
  prCount: number;
  biggestPr: { exerciseName: string; estimated1rm: number; exerciseType: string | null } | null;
  longestWeeklyStreak: number;
  monthlySessionCounts: number[];
}

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const repo = await getRepository();
  const tz = session.user?.timezone ?? DEFAULT_TZ;
  const today = todayInTz(tz);
  const sinceStr = shiftDateStr(today, -365);
  const [sy, sm, sd] = sinceStr.split("-").map(Number);
  const since = aestMidnight(sy, sm, sd, tz);
  const now = new Date();

  const [totals, topExercisesRaw, prs, sessionLoads] = await Promise.all([
    repo.getYearReviewTotals(userId, since),
    repo.getYearReviewTopExercises(userId, since, TOP_EXERCISE_LIMIT),
    repo.listRecentPersonalRecords(userId, since, now),
    repo.getSessionLoadsFrom(userId, since),
  ]);

  const sessionDayStrs = sessionLoads.map(s => toAestDay(s.startedAt, tz));

  const biggestPr = pickHeadlinePersonalRecord(prs);

  return NextResponse.json(
    {
      sessionCount: totals.sessionCount,
      totalSets: totals.totalSets,
      totalVolumeKg: Math.round(totals.totalVolumeKg),
      totalMinutes: totals.totalMinutes,
      topExercises: topExercisesRaw,
      prCount: prs.length,
      biggestPr: biggestPr
        ? { exerciseName: biggestPr.exerciseName, estimated1rm: biggestPr.estimated1rm, exerciseType: biggestPr.exerciseType }
        : null,
      longestWeeklyStreak: longestWeeklyStreak(sessionDayStrs),
      monthlySessionCounts: monthlySessionCounts(sessionDayStrs, today),
    } satisfies YearReviewResponse,
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
