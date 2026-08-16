import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRepository } from "@/lib/data";
import { DEFAULT_TZ } from "@trainingai/shared/date-utils";
import { prescriptionDrivesLoad, prescriptionStyleForExercise } from "@trainingai/shared/ai-periodization/apply-prescription";
import { normalizeStoredPrescription } from "@trainingai/shared/ai-periodization/reconcile-prescription";
import { resolveBodyweightStyle, resolveWorkingBasis } from "@trainingai/shared/1rm";
import { mroundStepUp, weightStepFor } from "@/components/workout/utils";
import { rateLimit } from "@/lib/rate-limit";
import type { StyleSet } from "@trainingai/shared/types/progression";
import type { ExerciseType } from "@trainingai/shared/types/program";

export interface NextSessionSetPreview {
  weightKg: number | null;
  reps: number;
  restSec: number;
}

export interface NextSessionExercisePreview {
  name: string;
  exerciseType: ExerciseType;
  sets: NextSessionSetPreview[];
}

export interface NextSessionPrescriptionResponse {
  isRestDay: boolean;
  sessionName?: string;
  // 'driving' = a stored AI prescription is in effect; 'static' = the exercise's base
  // progression style; 'pending' = an ai_dynamic program with no usable stored
  // prescription yet.
  source?: 'driving' | 'static' | 'pending';
  exercises?: NextSessionExercisePreview[];
}

const REST_DAY_RESPONSE: NextSessionPrescriptionResponse = { isRestDay: true };
const CACHE_HEADERS = { "Cache-Control": "private, no-store" };

// Read-only preview of the NEXT scheduled session's prescription, for the workout
// done-screen's "Next workout" card. Deliberately does NOT reuse /api/workout-data —
// that route re-evaluates/expires/regenerates the stored prescription keyed on TODAY,
// which would corrupt a future session's prescription if called at completion time.
// This route only reads; it never calls updatePrescriptionStatus/
// updatePrescriptionExercisesCache or fires a regenerate POST.
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!rateLimit(`${userId}:next-session-prescription`, 20, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const tz = session.user?.timezone ?? DEFAULT_TZ;
  const repo = await getRepository();

  const [recommendation, program, styles, library] = await Promise.all([
    repo.getNextSession(userId, tz),
    repo.getActiveProgram(userId),
    repo.listProgressionStyles(userId),
    repo.listExerciseLibrary(),
  ]);

  if (recommendation.isRestDay || !recommendation.session || !program) {
    return NextResponse.json(REST_DAY_RESPONSE, { headers: CACHE_HEADERS });
  }

  const programSession = recommendation.session;
  const styleById = new Map(styles.map(s => [s.id, s.sets]));
  const libByName = new Map(library.map(e => [e.name.toLowerCase(), e]));
  const exerciseNames = programSession.exercises.map(ex => ex.exerciseName);
  const isAiDynamic = program.phaseMode === 'ai_dynamic';

  const [lastLogs, lastRealOneRm, prMap, periodization, estimates] = await Promise.all([
    repo.getLastExerciseLogsBatch(userId, exerciseNames),
    repo.getLastRealOneRmBatch(userId, exerciseNames),
    repo.listPersonalRecords(userId),
    isAiDynamic ? repo.getSessionPeriodization(userId, programSession.id) : Promise.resolve(null),
    repo.getExerciseEstimates(userId).catch(() => []),
  ]);
  const estimateMap = new Map(estimates.map(e => [e.exerciseName, e.estimated1rm]));

  // Normalise a stored no-op transition (target phase === current phase) before it decides
  // whether the AI drives this preview — see normalizeStoredPrescription.
  const prescription = periodization?.prescription
    ? normalizeStoredPrescription(
        periodization.prescription, periodization.phase,
        new Map(programSession.exercises.map(e => [e.id, e.exerciseRole])),
      )
    : null;
  const drives = isAiDynamic && prescription != null && periodization != null
    && prescriptionDrivesLoad(prescription.phaseAction, periodization.prescriptionStatus);

  const source: NextSessionPrescriptionResponse['source'] = !isAiDynamic
    ? 'static'
    : drives ? 'driving' : (prescription == null ? 'pending' : 'static');

  const droppedThisCycle = new Set(drives ? (prescription!.droppedExerciseIds ?? []) : []);

  const exercises: NextSessionExercisePreview[] = programSession.exercises
    .filter(ex => !droppedThisCycle.has(ex.id))
    .map(ex => {
      const lastLog = lastLogs.get(ex.exerciseName) ?? null;
      const libEntry = libByName.get(ex.exerciseName.toLowerCase());
      const exerciseType: ExerciseType = libEntry?.exerciseType ?? 'weighted';

      let styleSets: StyleSet[] | null = null;
      let aiStyleApplied = false;
      if (drives) {
        const p = prescription!.exercises.find(e => e.sessionExerciseId === ex.id);
        if (p) {
          styleSets = prescriptionStyleForExercise(p);
          aiStyleApplied = true;
        }
      }
      if (!styleSets) {
        const resolved = ex.styleId ? styleById.get(ex.styleId) ?? null : null;
        styleSets = resolved
          ? resolved.map(s => ({ pct: s.pct, reps: s.reps, restSec: s.restSec, useFor1rm: s.useFor1rm } as StyleSet))
          : null;
      }

      // Same resolver as the workout screen (Q-5) — this inline max was the second of three
      // copies, and the reason the preview and the session it previews could differ.
      const basis = resolveWorkingBasis({
        lastNonDeload1rm: lastRealOneRm.get(ex.exerciseName)?.estimated1rm,
        seedEstimate: estimateMap.get(ex.exerciseName),
        allTimePr1rm: prMap.get(ex.exerciseName),
      }) ?? 0;
      styleSets = resolveBodyweightStyle({
        bwType: exerciseType,
        style: styleSets,
        isBaselinePhase: false,
        aiStyleApplied,
        basis,
      });

      const step = weightStepFor(libEntry?.equipment);
      const sets: NextSessionSetPreview[] = (styleSets ?? []).map(s => ({
        weightKg: exerciseType === 'bodyweight' || basis <= 0 ? null : mroundStepUp(basis * s.pct / 100, step),
        reps: s.reps,
        restSec: s.restSec,
      }));

      return { name: ex.exerciseName, exerciseType, sets };
    });

  return NextResponse.json({
    isRestDay: false,
    sessionName: programSession.name,
    source,
    exercises,
  } satisfies NextSessionPrescriptionResponse, { headers: CACHE_HEADERS });
}
