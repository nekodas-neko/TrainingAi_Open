import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRepository } from "@/lib/data";
import { formatInTimeZone } from "date-fns-tz";
import { DEFAULT_TZ } from "@trainingai/shared/date-utils";
import type { ExerciseHistoryLogRow } from "@trainingai/shared/types/log";
import { rpeTrendFromSets } from "@trainingai/shared/ai-periodization/expected-rpe";

export interface ExerciseHistoryResponse {
  entries: ExerciseHistoryEntry[];
  // Which unit `estimated1rm` means for this exercise. A bodyweight estimate is BW_REF-relative,
  // so the client renders it as a rep max rather than kilograms (see lib/1rm.ts, finding Q-12).
  exerciseType: 'weighted' | 'bodyweight';
}

export interface ExerciseHistoryEntry {
  date: string;
  sessionName: string;
  sets: number;
  weightKg: number[];
  reps: number[];
  estimated1rm: number | null;
  volume: number | null;
  isDeload: boolean;
  // avg (actual RPE − expected RPE) across this entry's rated sets; null when
  // fewer than 3 sets logged both an RPE and an intensity% that day.
  rpeDelta: number | null;
}

function isDeloadRow(row: ExerciseHistoryLogRow): boolean {
  return row.isEarlyDeload || row.phaseType === 'deload';
}

const HISTORY_LIMIT = 20;

export async function GET(req: NextRequest) {
  // Auth first, then the parameter — see the note in `app/api/day-log/route.ts` (Q-454).
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const name = req.nextUrl.searchParams.get("name");
  if (!name) return NextResponse.json({ error: "Missing name" }, { status: 400 });

  const tz = session.user.timezone ?? DEFAULT_TZ;
  const repo = await getRepository();
  const [rows, library] = await Promise.all([
    repo.getExerciseHistoryRows(userId, name, HISTORY_LIMIT),
    repo.listExerciseLibrary(),
  ]);
  const exerciseType = library.find(e => e.name === name)?.exerciseType ?? 'weighted';

  const entries: ExerciseHistoryEntry[] = rows.map(row => ({
    date: formatInTimeZone(row.loggedAt, tz, "yyyy/MM/dd HH:mm"),
    sessionName: row.sessionName,
    sets: row.sets.length,
    weightKg: row.sets.map(s => s.weightKg),
    reps: row.sets.map(s => s.reps),
    estimated1rm: row.estimated1rm ?? null,
    volume: row.volume ?? null,
    isDeload: isDeloadRow(row),
    rpeDelta: rpeTrendFromSets(row.sets.map(s => ({ rpe: s.rpe ?? null, intensityPct: s.intensityPct ?? null, reps: s.reps })))?.delta ?? null,
  }));

  return NextResponse.json(
    { entries, exerciseType } satisfies ExerciseHistoryResponse,
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
