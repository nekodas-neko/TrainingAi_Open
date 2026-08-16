import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRepositoryAsync } from "@/lib/data";
import { formatInTimeZone } from "date-fns-tz";
import { DEFAULT_TZ } from "@trainingai/shared/date-utils";
import { mergeByDate } from "@/lib/sleep/merge-sessions";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tz = session.user.timezone ?? DEFAULT_TZ;
  const now = new Date();
  const to   = formatInTimeZone(now, tz, "yyyy-MM-dd");
  const from = formatInTimeZone(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), tz, "yyyy-MM-dd");

  const repo = await getRepositoryAsync();
  const [rows, dailyRows] = await Promise.all([
    repo.listSleepSessions(session.user.id, from, to),
    repo.getOuraDaily(session.user.id, from, to),
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

  return NextResponse.json(merged, { headers: { "Cache-Control": "private, no-store" } });
}
