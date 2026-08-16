import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRepository } from "@/lib/data";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { DEFAULT_TZ } from "@trainingai/shared/date-utils";
import { classifyDay, isDeloadSession } from "./classify-day";

// Upper bound for a single training session's wall-clock duration. Beyond this we assume
// `startedAt` fell back to local-midnight (no real start time was captured) and use the
// exercise-log span instead of an inflated completedAt−startedAt figure.
const MAX_PLAUSIBLE_SESSION_MIN = 240;

export interface WeeklyStatsResponse {
  days: {
    dateKey: string; label: string; sessions: string[]; volume: number;
    /**
     * Volume from sessions `volume` deliberately excludes (deload *and* testing — see
     * `isDeloadSession`). It is kept out of `volume` so it can't inflate `totalVolumeKg`, but the
     * day's bar still needs a real height: a deload day is training, not a rest day (Q-246).
     */
    deloadVolume: number;
    isDeload: boolean; isTesting: boolean;
  }[];
  totalSessions: number;
  totalSets: number;
  totalVolumeKg: number;
  avgIntensityPct: number | null;
  avgDurationMin: number | null;
}

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tz = session.user.timezone ?? DEFAULT_TZ;
  const nowUtc = new Date();

  // Monday of the current ISO week in user's timezone
  const nowZoned = toZonedTime(nowUtc, tz);
  const daysFromMonday = (nowZoned.getDay() + 6) % 7; // 0=Mon … 6=Sun
  const mondayZoned = new Date(nowZoned);
  mondayZoned.setDate(mondayZoned.getDate() - daysFromMonday);
  mondayZoned.setHours(0, 0, 0, 0);
  const fromUtc = fromZonedTime(mondayZoned, tz);

  const repo = await getRepository();
  const allSessions = await repo.getWorkoutSessionsFrom(userId, fromUtc);
  // Mirror the calendar's filter: only sessions with at least one logged exercise
  const sessions = allSessions.filter(ws => ws.exercises.length > 0);

  // Build Mon–Sun grid for the current calendar week; future days are empty
  const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const days: WeeklyStatsResponse["days"] = [];
  for (let d = 0; d < 7; d++) {
    const dayZoned = new Date(mondayZoned);
    dayZoned.setDate(dayZoned.getDate() + d);
    const dayUtc = fromZonedTime(dayZoned, tz);
    const dateKey = formatInTimeZone(dayUtc, tz, "yyyy/MM/dd");
    const isFuture = dayZoned > nowZoned;
    const daySessions = isFuture ? [] : sessions
      .filter(ws => formatInTimeZone(ws.startedAt, tz, "yyyy/MM/dd") === dateKey);
    const sessionNames = daySessions.map(ws => ws.sessionName);
    const { volume, deloadVolume, isDeload, isTesting } = classifyDay(daySessions);
    days.push({ dateKey, label: DAY_LABELS[d], sessions: [...new Set(sessionNames)], volume, deloadVolume, isDeload, isTesting });
  }

  let totalSets = 0;
  let intensitySum = 0;
  let intensityCount = 0;
  let durationSum = 0;
  let durationCount = 0;

  for (const ws of sessions) {
    if (isDeloadSession(ws)) continue;
    for (const ex of ws.exercises) {
      totalSets += ex.sets.length;
      for (const set of ex.sets) {
        if (set.intensityPct != null && set.intensityPct > 0) {
          intensitySum += set.intensityPct;
          intensityCount++;
        }
      }
    }
    // Prefer real wall-clock duration (completedAt − startedAt) when both are set and the
    // span is plausible for a single session. `startedAt` is a real timestamp for workouts
    // logged with a start time, but falls back to local-midnight when one wasn't supplied —
    // so guard with an upper cap: a midnight start + evening completion would read ~18 h and
    // must be rejected in favour of the log-span estimate. The old log-span-only path badly
    // understated (it excludes warm-up and the final rest, and collapses to ~0 when sets are
    // logged in a burst), which is why a true 55-min session read as ~28 min.
    const wallMin = ws.completedAt != null
      ? (ws.completedAt.getTime() - ws.startedAt.getTime()) / 60000
      : null;
    if (wallMin != null && wallMin > 0 && wallMin <= MAX_PLAUSIBLE_SESSION_MIN) {
      durationSum += wallMin;
      durationCount++;
    } else {
      const logTimes = ws.exercises
        .map(e => e.loggedAt?.getTime())
        .filter((t): t is number => t != null);
      if (logTimes.length >= 2 && Math.max(...logTimes) > Math.min(...logTimes)) {
        durationSum += (Math.max(...logTimes) - Math.min(...logTimes)) / 60000;
        durationCount++;
      }
    }
  }

  // Count unique (date, sessionName) pairs — avoids inflating when multiple
  // workout_session rows exist for the same session on the same day
  const uniqueSessionDays = new Set(
    sessions.map(ws => `${formatInTimeZone(ws.startedAt, tz, "yyyy/MM/dd")}|${ws.sessionName}`)
  );

  const totalVolumeKg = Math.round(days.reduce((s, d) => s + d.volume, 0));

  return NextResponse.json(
    {
      days,
      totalSessions: uniqueSessionDays.size,
      totalSets,
      totalVolumeKg,
      avgIntensityPct: intensityCount > 0 ? Math.round(intensitySum / intensityCount) : null,
      avgDurationMin: durationCount > 0 ? Math.round(durationSum / durationCount) : null,
    } satisfies WeeklyStatsResponse,
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
