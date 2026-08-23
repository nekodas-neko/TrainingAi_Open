import { z } from 'zod';
import { oneRmImplausible } from '@trainingai/shared/validation/plausibility'
import { aestMidnight, todayInTz, normalizeDateParam, shiftDateStr } from '@trainingai/shared/date-utils';
import { getCurrentPhase, isDeloadActive } from '@trainingai/shared/phase-engine';
import { estimateOneRm, BW_REF } from '@trainingai/shared/1rm';
import { computeSetAggregates, computeIntensityPct } from '@trainingai/shared/workout/set-aggregates';
import { bodyweightSetLoadKg } from '@trainingai/shared/workout/bodyweight-load';
import { defaultUseFor1rm } from '@trainingai/shared/workout/default-use-for-1rm';
import type { ProgramPhaseType } from '@trainingai/shared/types/program';

export const LogExercisePayloadSchema = z.object({
  sessionName:          z.string().min(1).max(200),
  sessionId:            z.string().uuid().optional(),
  workoutSessionId:     z.string().uuid().optional(),
  exerciseLogId:        z.string().uuid().optional(),
  setLogIds:            z.array(z.string().uuid()).optional(),
  exercise:             z.string().min(1).max(200),
  weights:              z.array(z.number().min(-100).max(500)).min(1).max(20),
  sets:                 z.number().int().min(1).max(20),
  reps:                 z.array(z.number().int().min(0).max(100)).min(1).max(20),
  localDate:            z.string().optional(),
  timeToCompleteSet:    z.number().int().min(0).max(86_400).optional(),
  setTimes:             z.array(z.number().int().min(0).max(86_400)).max(20).optional(),
  restTimes:            z.array(z.number().int().min(0).max(86_400)).max(20).optional(),
  setStartTimes:        z.array(z.number().int().min(1_600_000_000_000).max(4_100_000_000_000)).max(20).optional(),
  setEndTimes:          z.array(z.number().int().min(1_600_000_000_000).max(4_100_000_000_000)).max(20).optional(),
  interExerciseRestSec: z.number().int().min(0).max(86_400).optional(),
  prepTimeSec:          z.number().int().min(0).max(86_400).optional(),
  progressionStyle:     z.array(z.object({
    id:        z.string().optional(),
    styleId:   z.string().optional(),
    setNumber: z.number().optional(),
    pct:       z.number(),
    reps:      z.number(),
    restSec:   z.number(),
    useFor1rm: z.boolean().optional(),
  })).optional(),
  styleName:            z.string().optional(),
  styleId:              z.string().optional(),
  muscleGroups:         z.array(z.string()).optional(),
  workoutStartedAt:     z.number().optional(),
  warmupEndedAtMs:      z.number().optional(),
  rpeValues:            z.array(z.number().int().min(5).max(10)).optional(),
  intensityMode:        z.enum(['full', 'deload']).optional(),
  wasOverride:          z.boolean().optional(),
  exerciseDeloaded:     z.boolean().optional(),
  estimated1rm:         z.number().optional(),
  target80:             z.number().optional(),
});

export type LogExercisePayload = z.infer<typeof LogExercisePayloadSchema>;

// PR gate: deload work is deliberately submaximal, so its 1RM estimate must
// never enter personal_records. Whole-session deloads were already excluded;
// a per-exercise deload excludes just that exercise — and unlike the session
// flag it has no baseline exception, since the exercise itself was cut.
export function shouldCountTowardPr(args: {
  estimated1rm: number
  isAnyDeload: boolean
  isBaseline: boolean
  exerciseDeloaded: boolean
}): boolean {
  if (args.estimated1rm <= 0) return false
  // Q-24 §7: weights and reps are each bounded, but the rep factor multiplies them — the
  // individually-legal 500 kg x 100 reps estimates a ~2,166 kg 1RM. Gate the RECORD, not the
  // log: the set still saves (rejecting it would lose real work over a bound we chose), but an
  // impossible value never reaches personal_records, where IfBetter would keep it forever.
  if (oneRmImplausible(args.estimated1rm)) return false
  if (args.exerciseDeloaded) return false
  return !args.isAnyDeload || args.isBaseline
}

export async function logExerciseFromPayload(
  userId: string,
  payload: LogExercisePayload,
  tz: string,
): Promise<{
  workoutSessionId: string;
  exerciseLogId: string;
  estimated1rm: number;
  target80: number;
  isPR: boolean;
}> {
  const {
    sessionName, sessionId, workoutSessionId,
    exerciseLogId: clientExerciseLogId, setLogIds: clientSetLogIds,
    exercise, weights, reps,
    localDate, timeToCompleteSet, setTimes, restTimes,
    setStartTimes, setEndTimes, interExerciseRestSec, prepTimeSec,
    progressionStyle, styleName, styleId, muscleGroups, workoutStartedAt, warmupEndedAtMs,
    rpeValues, intensityMode, wasOverride, exerciseDeloaded,
  } = payload;

  // Lazy import: `@/lib/data` compiles as a Turbopack async module (it pulls in pg /
  // node-postgres). A *static* top-level import of it here, combined with this module
  // also being dynamically imported by the outbox (pushMutations, adapter.ts), leaves
  // the route's static namespace binding empty under `next dev --turbopack` —
  // `getRepository` reads as undefined and every dev POST 500s (prod build is fine).
  // Resolving it lazily breaks that static-import-of-async-module edge.
  // See docs/superpowers/plans/2026-07-05-log-exercise-turbopack-dev-fix.md.
  const { getRepository } = await import('@/lib/data');
  const repo = await getRepository();

  // Resolve phase context for automatic-mode programs
  let currentPhaseId: string | undefined;
  let currentPhaseType: ProgramPhaseType | undefined;
  let sessionIsEarlyDeload = false;

  const programWithPhases = await repo.getActiveProgramWithPhases(userId);
  const activeProgram = programWithPhases?.program ?? await repo.getActiveProgram(userId);
  if (programWithPhases) {
    const { program: activeProg, phases: phaseList } = programWithPhases;
    const todayStr = todayInTz(tz);
    if (phaseList.length > 0) {
      const sessionCounts = await repo.countAllSessionsSinceStart(userId, activeProg.id);
      // Keyed by program-session id (WK-15). Prefer the payload's program-session id; fall
      // back to resolving the session name against the active program for older clients that
      // send only a name.
      const resolvedSessionId = sessionId
        ?? activeProg.sessions.find(x => x.name.toLowerCase() === sessionName.toLowerCase())?.id;
      const thisSessionCount = resolvedSessionId ? (sessionCounts.get(resolvedSessionId) ?? 0) : 0;
      const { phase } = getCurrentPhase(phaseList, 1, thisSessionCount);
      currentPhaseId = phase.id;
      currentPhaseType = phase.phaseType;
      sessionIsEarlyDeload = isDeloadActive(phase, activeProg, todayStr);
    }
  } else if (activeProgram?.phaseMode === 'ai_dynamic' && sessionId) {
    // getActiveProgramWithPhases only resolves for 'automatic' programs, so it's always null
    // here for ai_dynamic — their deload state lives in session_periodization instead. Without
    // this, a card-initiated deload session never sets currentPhaseType, so
    // shouldCountTowardPr's isAnyDeload gate never fires and a deload set can mint a PR off a
    // deliberately submaximal load.
    const periodizationState = await repo.getSessionPeriodization(userId, sessionId).catch(() => null);
    if (periodizationState?.phase === 'deload') {
      currentPhaseType = 'deload';
    }
  }

  const exerciseType = await repo.getExerciseType(exercise);

  let effectiveWeights = weights;
  if (exerciseType === 'bodyweight') {
    // Reps are the load: use a fixed reference weight instead of real body weight so
    // the estimate tracks reps + added load only, never the lifter's weigh-ins.
    effectiveWeights = weights.map(w => Math.max(1, BW_REF + w));
  }

  const norm = normalizeDateParam(localDate ?? todayInTz(tz));
  const rawDate = norm ?? todayInTz(tz).replace(/-/g, '/');
  const [y, m, d] = rawDate.split('/').map(Number);
  const startOfDay = aestMidnight(y, m, d);
  const sessionStart = workoutStartedAt ? new Date(workoutStartedAt) : startOfDay;

  let wsId = workoutSessionId;
  if (wsId) {
    const ensured = await repo.ensureWorkoutSession(
      userId, wsId, sessionId, sessionName, sessionStart,
      currentPhaseId, currentPhaseType, sessionIsEarlyDeload,
      intensityMode ?? null, wasOverride ?? false,
    );
    if (!ensured.wasInserted) {
      currentPhaseId = ensured.phaseId;
      currentPhaseType = ensured.phaseType;
      sessionIsEarlyDeload = ensured.isEarlyDeload;
    }
  } else {
    const todaySessions = await repo.getDayLog(userId, rawDate);
    const existing = todaySessions.find(ws => ws.sessionName === sessionName && !ws.completedAt);
    if (existing) {
      wsId = existing.id;
      currentPhaseId = existing.phaseId;
      currentPhaseType = existing.phaseType;
      sessionIsEarlyDeload = existing.isEarlyDeload;
    } else {
      const ws = await repo.createWorkoutSession(
        userId, sessionId, sessionName, sessionStart,
        currentPhaseId, currentPhaseType, sessionIsEarlyDeload,
      );
      wsId = ws.id;
    }
  }

  if (warmupEndedAtMs) {
    await repo.setWorkoutSessionWarmupEnd(userId, wsId, new Date(warmupEndedAtMs))
  }

  const isBaseline = currentPhaseType === 'baseline';
  const isAnyDeload = currentPhaseType === 'deload' || sessionIsEarlyDeload;
  // Mirrors shouldCountTowardPr's gate below: a deliberately submaximal set — whether from a
  // static program's deload phase (isAnyDeload) or an AI per-exercise/whole-session deload
  // (exerciseDeloaded) — must never feed the 1RM estimate itself, not just be excluded from
  // becoming a new PR (Q-115). Baseline is the same carve-out as the PR gate: a baseline test
  // is a genuine max-effort attempt even during an otherwise-active deload window.
  const { estimated1rm, target80 } = estimateOneRm(
    weights.map((w, i) => ({ weightKg: w, reps: reps[i] ?? 0 })),
    { exerciseType, style: progressionStyle, isBaseline, deloaded: exerciseDeloaded === true || (isAnyDeload && !isBaseline) },
  );

  // Volume must be priced at what the lifter actually moved. A bodyweight set logs weight 0, so
  // computing volume from the raw weights recorded ZERO work for real reps (finding Q-13) — while
  // the same sets were simultaneously scored at 82-88% intensity off `effectiveWeights`. Body
  // weight comes from the most recent weigh-in at or before this session, never BW_REF: that
  // constant exists to keep the 1RM off the scales and would put ~100 kg on every rep here.
  let volumeWeights = weights;
  if (exerciseType === 'bodyweight') {
    const isoDate = rawDate.replace(/\//g, '-');
    // `listBodyMetrics` already returns NEWEST FIRST, so find() takes the most recent weigh-in at
    // or before this session. Reversing it first would take the OLDEST in the window — a body
    // weight up to 90 days stale.
    const metrics = await repo.listBodyMetrics(userId, shiftDateStr(isoDate, -90), isoDate);
    const bodyweightKg = metrics.find(m => m.weightKg != null && m.weightKg > 0)?.weightKg ?? null;
    volumeWeights = weights.map(w => bodyweightSetLoadKg(exercise, bodyweightKg, w));
  }
  const { volume, avgReps } = computeSetAggregates(volumeWeights, reps);

  const setData = weights.map((w, i) => {
    const r = reps[i] ?? reps[reps.length - 1];
    return {
      setNumber: i + 1,
      weightKg: w,
      reps: r,
      setTimeSec: setTimes?.[i],
      restTimeSec: restTimes?.[i],
      intensityPct: computeIntensityPct(effectiveWeights[i], estimated1rm) ?? undefined,
      useFor1rm: progressionStyle?.[i]?.useFor1rm ?? defaultUseFor1rm(reps, i),
      setStartMs: setStartTimes?.[i],
      setEndMs: setEndTimes?.[i],
      rpe: rpeValues?.[i],
      // Q-14: a bodyweight movement is never prescribed a %1RM — resolveBodyweightStyle turns the
      // style's pct into a rep target instead. Storing that pct here put it alongside a
      // BW_REF-relative intensity_pct on a different basis, so every bodyweight set recorded a
      // phantom 14-18 pp overshoot. The rep target is the prescription that was actually delivered.
      plannedPct:     exerciseType === 'bodyweight' ? undefined : (progressionStyle?.[i]?.pct ?? undefined),
      plannedReps:    progressionStyle?.[i]?.reps ?? undefined,
      plannedRestSec: progressionStyle?.[i]?.restSec ?? undefined,
    };
  });

  // E1-2: stamp the exercise at its real completion time, not server-receive time.
  // An outbox replay days later would otherwise date the log to sync day, corrupting
  // 1RM history/trend ordering (`ORDER BY loggedAt`) and PR tiebreaks. Prefer the
  // last set's end, then the workout start; fall back to now only when the payload
  // carries no timing at all (never true for a normal client submit).
  const lastSetEndMs = setEndTimes?.filter((t): t is number => typeof t === 'number').at(-1);
  const loggedAt = lastSetEndMs != null ? new Date(lastSetEndMs)
    : workoutStartedAt != null ? new Date(workoutStartedAt)
    : new Date();

  // RV-32: `exercise_logs.style_id` is a client-supplied FK into a strictly user-scoped table, and
  // it arrived here unchecked on both the web route and the outbox's `pushMutations` branch — this
  // function is the one place that covers both.
  //
  // **Dropped to null rather than refused**, unlike the two program-config paths, and the difference
  // is deliberate: a refusal here is a 4xx on a queued mutation, which the outbox quarantines as a
  // poison pill — so a foreign style id would cost the user a whole logged workout over a metadata
  // column. Losing the style reference is the smaller loss by a wide margin. The config paths refuse
  // instead because the user is editing interactively and can see and fix the rejection.
  const ownedStyleId = styleId != null && !(await repo.progressionStyleIdsOwned(userId, [styleId]))
    ? null
    : styleId

  const { exerciseLog } = await repo.logExerciseAndSets(userId, {
    workoutSessionId: wsId,
    exerciseLogId: clientExerciseLogId,
    exerciseName: exercise,
    styleId: ownedStyleId ?? undefined,
    styleName: styleName,
    estimated1rm,
    target80,
    volume,
    avgReps,
    timeToComplete: timeToCompleteSet,
    muscleGroups: (muscleGroups ?? []).map(mg => mg.toLowerCase()),
    loggedAt,
    interExerciseRestSec: interExerciseRestSec ?? undefined,
    prepTimeSec: prepTimeSec ?? undefined,
    exerciseDeloaded: exerciseDeloaded ?? false,
  }, setData.map((s, i) => ({ ...s, id: clientSetLogIds?.[i] })));

  let isPR = false;
  if (shouldCountTowardPr({
    estimated1rm,
    isAnyDeload,
    isBaseline,
    exerciseDeloaded: exerciseDeloaded ?? false,
  })) {
    isPR = await repo.upsertPersonalRecordIfBetter(userId, exercise, estimated1rm);
  }

  return {
    workoutSessionId: wsId,
    exerciseLogId: exerciseLog.id,
    estimated1rm,
    target80,
    isPR,
  };
}
