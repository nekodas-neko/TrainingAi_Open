import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRepository } from "@/lib/data";
import { DEFAULT_TZ, toAestDay } from "@trainingai/shared/date-utils";
import { getCurrentPhase } from "@trainingai/shared/phase-engine";

export interface ExerciseSummary {
  exercise: string;
  weight: number | null;
  date: string | null;
  sessionName: string;
  estimated1rm: number | null;
  previousEstimated1rm: number | null;
  target80: number | null;
  personalRecord1rm: number | null;
  exerciseType: 'weighted' | 'bodyweight';
  lastReps: number | null;
  maxReps: number | null;
}

export async function GET(_req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const repo = await getRepository();
  const tz = session.user?.timezone ?? DEFAULT_TZ;
  const [program, latestLogs, personalRecords, exerciseLibrary, maxRepsByExercise, previous1rmMap] = await Promise.all([
    repo.getActiveProgram(userId),
    repo.getExerciseSummary(userId),
    repo.listPersonalRecords(userId),
    repo.listExerciseLibrary(),
    repo.listMaxReps(userId),
    repo.listPrevious1rm(userId),
  ]);

  const logMap = new Map(latestLogs.map(l => [l.exerciseName, l]));
  const exerciseTypeByName = new Map(exerciseLibrary.map(e => [e.name, e.exerciseType]));

  // Build summary ordered by program session position
  const exercises: ExerciseSummary[] = [];
  if (program) {
    for (const sess of program.sessions) {
      for (const ex of sess.exercises) {
        const log = logMap.get(ex.exerciseName);
        exercises.push({
          exercise: ex.exerciseName,
          weight: log?.sets[0]?.weightKg ?? null,
          date: log?.loggedAt
            ? toAestDay(log.loggedAt, tz).replace(/-/g, '/')
            : null,
          sessionName: sess.name,
          estimated1rm: log?.estimated1rm ?? null,
          previousEstimated1rm: previous1rmMap.get(ex.exerciseName) ?? null,
          target80: log?.target80 ?? null,
          personalRecord1rm: personalRecords.get(ex.exerciseName) ?? null,
          exerciseType: exerciseTypeByName.get(ex.exerciseName) ?? 'weighted',
          lastReps: log?.sets[0]?.reps ?? null,
          maxReps: maxRepsByExercise.get(ex.exerciseName) ?? null,
        });
      }
    }
  }

  // Group by session for the canonical record used by the UI
  const canonical: Record<string, string[]> = {};
  if (program) {
    for (const sess of program.sessions) {
      canonical[sess.name] = sess.exercises.map(e => e.exerciseName);
    }
  }

  // Phase info for automatic-phase programs
  let phaseName: string | null = null;
  let cycleLabel: string | null = null;
  if (program?.phaseMode === 'automatic' && program.sessionsPerCycle && program.sessionsPerCycle >= 1) {
    const [phases, sessionsCount] = await Promise.all([
      repo.listProgramPhases(userId, program.id),
      repo.countSessionsSinceStart(userId, program.id),
    ]);
    if (phases.length > 0) {
      const result = getCurrentPhase(phases, program.sessionsPerCycle, sessionsCount);
      phaseName = result.phase.name;
      cycleLabel = `C${result.cycleInPhase}/${result.totalPhaseCycles}`;
    }
  }

  return NextResponse.json({ exercises, canonical, phaseName, cycleLabel }, { headers: { "Cache-Control": "private, no-store" } });
}
