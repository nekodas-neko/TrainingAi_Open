import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRepositoryAsync } from "@/lib/data";
import { formatInTimeZone } from "date-fns-tz";
import { DEFAULT_TZ } from "@trainingai/shared/date-utils";
import { mergeByDate } from "@/lib/sleep/merge-sessions";
import { isNightProvisional } from "@/lib/sleep/provisional";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tz = session.user.timezone ?? DEFAULT_TZ;
  const now = new Date();
  const to   = formatInTimeZone(now, tz, "yyyy-MM-dd");
  const from = formatInTimeZone(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), tz, "yyyy-MM-dd");

  const repo = await getRepositoryAsync();
  const [rows, dailyRows, coverageEnd] = await Promise.all([
    repo.listSleepSessions(session.user.id, from, to),
    repo.getOuraDaily(session.user.id, from, to),
    repo.getSleepCoverageEnd(session.user.id),
  ]);
  const sleepTimeRecommendationByDate = new Map(
    dailyRows.filter(d => d.sleepTimeRecommendation != null).map(d => [d.date, d.sleepTimeRecommendation]),
  );

  const merged = mergeByDate(rows.map(r => ({
    date:            r.date,
    ouraId:          r.ouraId          ?? null,
    durationHours:   r.durationHours   ?? null,
    deepSleepHours:  r.deepSleepHours  ?? null,
    remSleepHours:   r.remSleepHours   ?? null,
    lightSleepHours: r.lightSleepHours ?? null,
    awakHours:       r.awakHours       ?? null,
    efficiency:      r.efficiency      ?? null,
    onsetLatencySec: r.onsetLatencySec ?? null,
    averageHrvMs:    r.averageHrvMs    ?? null,
    avgHeartRate:    r.avgHeartRate    ?? null,
    lowestHeartRate: r.lowestHeartRate ?? null,
    restlessPeriods: r.restlessPeriods ?? null,
    sleepScore:      r.sleepScore      ?? null,
    respiratoryRate: r.respiratoryRate ?? null,
    sleepPhase5Min:  r.sleepPhase5Min  ?? null,
    sleepStart:      r.sleepStart.toISOString(),
    sleepEnd:        r.sleepEnd.toISOString(),
    sleepTimeRecommendation: sleepTimeRecommendationByDate.get(r.date) ?? null,
  })));

  // A night the rollup has not yet derived past is still growing, and saying so is the whole of
  // BF-83: the owner saw the same night read 6 h 15 m and then 7 h 40 m four minutes apart, with
  // nothing marking the first as unfinished. Computed here rather than stored on the row because a
  // stored flag is only as fresh as the last write to that row, and the thing it describes changes
  // without the row changing. It is also why a provisional night must be left out of the
  // recent-nights average it is compared against — that average moved too.
  const coverageEndMs = coverageEnd?.getTime() ?? null;
  const withProvisional = merged.map(r => ({
    ...r,
    // A merged row without an end is not a night whose end can still move — `mergeByDate` only
    // drops the field when no cluster survived, and there is nothing to badge.
    provisional: r.sleepEnd != null && isNightProvisional(new Date(r.sleepEnd).getTime(), coverageEndMs),
  }));

  return NextResponse.json(withProvisional, { headers: { "Cache-Control": "private, no-store" } });
}
