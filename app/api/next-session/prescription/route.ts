import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRepository } from "@/lib/data";
import { DEFAULT_TZ, startOfWeekInTz, todayInTz } from "@trainingai/shared/date-utils";
import { readProgramDeloadCheck } from "@trainingai/shared/ai-periodization/program-phase";
import { fitStoredPlanToCheckinBudget } from "@trainingai/shared/ai-periodization/checkin-plan-budget";
import { isSessionUnderWay } from "@trainingai/shared/ai-periodization/session-under-way";
import { slotHoldsPlan } from "@trainingai/shared/ai-periodization/plan-status";
import { adoptPendingAiPlan } from "@trainingai/shared/ai-periodization/pending-plan-adoption";
import { prescribedBar } from "@trainingai/shared/workout/load-rounding";
import { loadLiftPreferences } from "@trainingai/shared/ai-periodization/lift-preference-read";
import { rateLimit } from "@/lib/rate-limit";
import { readSessionFromStoredState } from "@trainingai/shared/workout/read-session";
import { NO_PHASE_STATE } from "@/lib/data/repository";
import type { ExerciseType } from "@trainingai/shared/types/program";


export interface NextSessionSetPreview {
  weightKg: number | null;
  reps: number;
  restSec: number;
}

export interface NextSessionExercisePreview {
  name: string;
  // #3896 step 7: the slot's id, so the app's "…" on a lift can open the Coach about it.
  sessionExerciseId: string;
  exerciseType: ExerciseType;
  sets: NextSessionSetPreview[];
}

export interface NextSessionPrescriptionResponse {
  isRestDay: boolean;
  sessionName?: string;
  // 'driving' = a stored AI prescription is in effect; 'static' = the exercise's base
  // progression style; 'pending' = an ai_dynamic program whose next plan is made when the
  // session is opened: none is stored yet, or the stored one was consumed
  // (`isAiPrescriptionPending`, the same test /api/workout-data uses, #3007).
  source?: 'driving' | 'static' | 'pending';
  // While driving: where the stored plan's numbers came from, as /api/workout-data's
  // `prescriptionSource`. 'rules' = the model failed and the program as written was stored (RV-202).
  prescriptionSource?: 'model' | 'rules';
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

  // RV-82: the program comes off the recommendation. `getNextSession` already fetches it, and
  // `getActiveProgram` is a fixed 5-query composite — asking for it again here ran `programs`,
  // `program_sessions`, `schedules`, `schedule_days` and `session_exercises` twice per request.
  const [recommendation, styles, library] = await Promise.all([
    repo.getNextSession(userId, tz),
    repo.listProgressionStyles(userId),
    repo.listExerciseLibrary(),
  ]);
  const program = recommendation.program ?? null;

  if (recommendation.isRestDay || !recommendation.session || !program) {
    return NextResponse.json(REST_DAY_RESPONSE, { headers: CACHE_HEADERS });
  }

  const programSession = recommendation.session;
  const styleById = new Map(styles.map(s => [s.id, s.sets]));
  const styleByName = new Map(styles.map(s => [s.name, s.sets]));
  const libByName = new Map(library.map(e => [e.name.toLowerCase(), e]));
  const exerciseNames = programSession.exercises.map(ex => ex.exerciseName);
  const isAutomatic = program.phaseMode === 'automatic';
  const isAiDynamic = program.phaseMode === 'ai_dynamic';
  const todayStr = todayInTz(tz);

  const [phaseState, lastLogs, lastRealOneRm, prMap, periodization, estimates, liftPreferences] = await Promise.all([
    // The phase a static program's session is in, read as /api/workout-data reads it: its phases and
    // its sessions' counts in one query (#4050).
    isAutomatic ? repo.getProgramPhaseState(userId, program.id) : Promise.resolve(NO_PHASE_STATE),
    repo.getLastExerciseLogsBatch(userId, exerciseNames),
    repo.getLastRealOneRmBatch(userId, exerciseNames),
    repo.listPersonalRecords(userId),
    // #3890: in the applies-to week, the weekly check-in's shorter session (no model call).
    isAiDynamic
      ? repo.getSessionPeriodization(userId, programSession.id)
          .then(st => st && fitStoredPlanToCheckinBudget(userId, programSession.id, repo, tz, st))
          // #3900 review (H): a plan left `pending` from before the AI plan applied every plan by itself.
          .then(st => st && adoptPendingAiPlan(userId, programSession.id, repo, tz, program, st))
      : Promise.resolve(null),
    repo.getExerciseEstimates(userId).catch(() => []),
    // #4019 / #3890: the lift preferences and this week's check-in hold, as the session screen reads them.
    loadLiftPreferences(repo, userId, exerciseNames, { checkinWeekStart: startOfWeekInTz(tz) }),
  ]);
  const estimateMap = new Map(estimates.map(e => [e.exerciseName, e.estimated1rm]));

  // #3876: an aligned program's deload ends at the program's cap, not the type's count.
  const programDeload = isAiDynamic
    ? await readProgramDeloadCheck(repo, userId, program.id, periodization, tz).catch(() => null)
    : null;

  // #4019: the card takes every lift's sets, reps and bar from the same function the session screen's
  // batch read runs (`readSessionFromStoredState` -> `buildWorkoutExercises`), not from a copy of it. It
  // differs from the screen's own single-session read in two ways, both because it previews a FUTURE
  // session: no re-check against today's soreness, injuries and check-in (today's signals are not that
  // session's), and no `?aiDeload` toggle (the person has not opened it).
  // The re-check as a read was built and reviewed at a54dca72 and taken out on purpose (#4019 item 2).
  const read = readSessionFromStoredState({
    program, programSession, todayStr, allPhases: phaseState.phases,
    thisSessionCount: phaseState.sessionCounts.get(programSession.id) ?? 0,
    periodization, programDeload,
    underWay: isAiDynamic && periodization != null && slotHoldsPlan(periodization)
      ? await isSessionUnderWay(repo, userId, programSession.id) : false,
    loggedTodayInThisSession: new Set<string>(),
    shared: { lastLogs, lastRealOneRm, prMap, estimateMap, styleById, styleByName, styles, libByName, liftPreferences },
  });

  // 'pending': an ai_dynamic program with no plan in hand (none stored, consumed, aged out, or a
  // baseline, which has none): the plan is made when the session is opened.
  const source: NextSessionPrescriptionResponse['source'] = !isAiDynamic
    ? 'static'
    : read.aiDrivesLoad ? 'driving' : (read.aiPrescription == null || read.aiPrescriptionPending ? 'pending' : 'static');

  const exercises: NextSessionExercisePreview[] = read.exercises.map(ex => ({
    name: ex.name,
    sessionExerciseId: ex.sessionExerciseId,
    exerciseType: ex.exerciseType,
    sets: (ex.progressionStyle ?? []).map(s => ({
      weightKg: ex.exerciseType === 'bodyweight' || !ex.estimated1rm || ex.estimated1rm <= 0
        ? null
        : prescribedBar(ex.estimated1rm, s.pct, ex.equipment),
      reps: s.reps,
      restSec: s.restSec,
    })),
  }));

  return NextResponse.json({
    isRestDay: false,
    sessionName: programSession.name,
    source,
    ...(read.aiDrivesLoad && read.aiPrescription!.source ? { prescriptionSource: read.aiPrescription!.source } : {}),
    exercises,
  } satisfies NextSessionPrescriptionResponse, { headers: CACHE_HEADERS });
}
