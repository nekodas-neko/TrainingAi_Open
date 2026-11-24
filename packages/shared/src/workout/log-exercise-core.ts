// #3916. The data layer's outbox push (`pushMutations` in `lib/data/postgres/adapter.ts`) calls this
// with its own repository. It must not import `@/lib/data`, statically or through `import()`: the
// data layer reaching a module that reaches back into `@/lib/data` is the cycle that broke
// `/api/readiness-score` on the dev bundler (#3911), and
// `lib/health/__tests__/data-layer-readiness-cycle.test.ts` fails if one comes back.
import { isDeloadedForEstimate } from '../1rm';
import { oneRmImplausible } from '@trainingai/shared/validation/plausibility'
import { aestMidnight, todayInTz, normalizeDateParam, shiftDateStr } from '@trainingai/shared/date-utils';
import { resolveSessionPhase, isStoredBaseline } from '@trainingai/shared/workout/read-session';
import { estimateOneRm, BW_REF, withPrescribedBars } from '@trainingai/shared/1rm';
import { computeSetAggregates, computeIntensityPct } from '@trainingai/shared/workout/set-aggregates';
import { bodyweightSetLoadKg } from '@trainingai/shared/workout/bodyweight-load';
import { defaultUseFor1rm } from '@trainingai/shared/workout/default-use-for-1rm';
import type { ProgramPhaseType } from '@trainingai/shared/types/program';
import type { EditStamp } from '@trainingai/shared/sync/edited-at';
import type { WorkoutRepository } from '@/lib/data/repository';
import { logMayConsumeOneShot } from '@trainingai/shared/ai-periodization/lift-preference';

export { LogExercisePayloadSchema } from './log-payload';
import type { LogExercisePayload } from './log-payload';
export type { LogExercisePayload } from './log-payload';

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

export async function logExerciseWithRepo(
  repo: WorkoutRepository,
  userId: string,
  payload: LogExercisePayload,
  tz: string,
  // Issue 2721: the route omits it (a live write, stamped with server time); the outbox push passes
  // the payload's `editedAt`, and a copy older than the row's last decided edit is skipped.
  stamp: EditStamp = { kind: 'server' },
): Promise<{
  workoutSessionId: string;
  exerciseLogId: string;
  estimated1rm: number;
  target80: number;
  isPR: boolean;
  /** Issue 2721: the server already holds a newer copy, so nothing was written. */
  superseded: boolean;
}> {
  const {
    sessionName, sessionId: payloadSessionId, workoutSessionId,
    exerciseLogId: clientExerciseLogId, setLogIds: clientSetLogIds,
    exercise, weights, reps,
    localDate, timeToCompleteSet, setTimes, restTimes,
    setStartTimes, setEndTimes, interExerciseRestSec, prepTimeSec,
    progressionStyle, plannedWeights, prescriptionBasisKg, styleName, styleId, muscleGroups, workoutStartedAt, warmupEndedAtMs,
    rpeValues, rpeSources, intensityMode, wasOverride, exerciseDeloaded, effort,
  } = payload;

  // Issue 2721: a stale copy is decided before anything is written, so a superseded push leaves the
  // workout session (and its warm-up end) untouched as well as the log. `logExerciseAndSets` checks
  // again under its own lock, which covers a fix landing between this check and that write.
  if (stamp.kind === 'client' && clientExerciseLogId) {
    const kept = await repo.skipSupersededExerciseLogPush(userId, clientExerciseLogId, stamp);
    if (kept) {
      return { ...kept, exerciseLogId: clientExerciseLogId, isPR: false, superseded: true };
    }
  }

  // The payload's `sessionId` is stored as the workout's program session link and used to read
  // phase state, so it must name a session in one of the caller's own programs. Dropped to null
  // rather than refused, for the reason given at the `styleId` check below: this runs for queued
  // outbox pushes too, and a refusal would quarantine a whole logged workout over one link column.
  const sessionId = payloadSessionId && (await repo.programSessionIdOwned(userId, payloadSessionId))
    ? payloadSessionId
    : undefined;

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
      // The one phase resolution the screen, the card and the Coach share (#4114): the phase, its type
      // and whether a deload (the phase's own or a confirmed early week) is active.
      const { phaseStatus } = resolveSessionPhase({
        program: activeProg, todayStr, allPhases: phaseList, thisSessionCount, periodization: null,
      });
      if (phaseStatus) {
        currentPhaseId = phaseStatus.phase.id;
        currentPhaseType = phaseStatus.phase.phaseType;
        sessionIsEarlyDeload = phaseStatus.isDeloadActive;
      }
    }
  } else if (activeProgram?.phaseMode === 'ai_dynamic' && sessionId) {
    // getActiveProgramWithPhases only resolves for 'automatic' programs, so it's always null
    // here for ai_dynamic — their deload state lives in session_periodization instead. Without
    // this, a card-initiated deload session never sets currentPhaseType, so
    // shouldCountTowardPr's isAnyDeload gate never fires and a deload set can mint a PR off a
    // deliberately submaximal load.
    const periodizationState = await repo.getSessionPeriodization(userId, sessionId).catch(() => null);
    // #3877: a session the lifter overrode to full weight is not a deload, whatever the phase. It
    // used to be recorded as one, so every exercise of it stored an estimate of 0 and could set no
    // record (production, 26 Oct). Decided here, where the workout session's phase type is first
    // written; a session already stored keeps its type (read back below), so past rows are as they were.
    // Only native sends `'full'`: the WebView sends `intensityMode` only for a deload and omits it for
    // full weight, and an outbox replay carries null. So anything but an explicit deload counts as full.
    const overriddenToFull = wasOverride === true && intensityMode !== 'deload';
    // #4097: what was TRAINED decides what is recorded. A Preview workout uploads at its finish, so the stored
    // phase may have moved since it was started (a full workout uploaded after the program entered a deload
    // was stored as one: 1RM 0, no record, counted as a deload session; a deload uploaded after the phase left
    // it stored no phase at all). When the upload says how it was trained ('full' or 'deload'; native sends
    // both, the WebView sends only 'deload'), that is the answer; without it (an older build, an outbox
    // replay) the stored phase decides, exactly as before.
    const trainedAsDeload = intensityMode === 'deload'
      || (intensityMode !== 'full' && periodizationState?.phase === 'deload' && !overriddenToFull);
    if (trainedAsDeload) {
      currentPhaseType = 'deload';
    } else if (isStoredBaseline(periodizationState)) {
      // TN-75: the same test `workout-data` uses for `isAiDynamicBaseline`, so the server agrees
      // with the screen that this is a calibration session. It is stored as the session's
      // `phase_type`, which is the marker adherence reads need to exclude calibration sets (they
      // carry no per-set plan by design). It also sends the estimate through the AMRAP formula the
      // client already used; measured on the 09-07→09-12 round, that moves 5 of 20 loaded logs by
      // one 0.25 kg rounding step and leaves the rest identical.
      currentPhaseType = 'baseline';
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
  const startOfDay = aestMidnight(y, m, d, tz);
  /**
   * LA-21. The fallback here used to be local midnight outright, and it is where **7 of the owner's
   * 11 implausible sessions came from** — each recorded `started_at` at exactly 00:00 local and
   * `completed_at` between 08:53 and 14:05, so the session read as an 8-to-14-hour workout. Those
   * durations are now culled from statistics, which means a real workout currently contributes no
   * duration-derived number at all. Recording a plausible start is what makes it count again.
   *
   * The ladder is the same one `loggedAt` uses forty lines below, for the same reason: prefer the
   * timing the payload actually carries.
   *
   *   1. `workoutStartedAt` — the device's own session anchor, and what a normal submit sends.
   *   2. **the first set's start** — already in the payload (`setStartTimes`), and it is *inside* the
   *      session, so at worst it loses the warm-up rather than hours.
   *   3. `now`, but only when the log is for TODAY. Logging an exercise happens during the session,
   *      so `now` is inside it.
   *   4. midnight, for a back-dated log, where we genuinely do not know — and the cull is then the
   *      honest outcome rather than a fabricated span.
   *
   * **Why the fallback fires at all:** `workout-screen.tsx` sends `workoutStartMs ?? undefined`, and
   * the store's abandoned-session guard sets `workoutStartMs` to null. So the guard that protects
   * against a days-old session is itself what leaves the next log with no anchor.
   */
  const firstSetStartMs = setStartTimes?.find((t): t is number => typeof t === 'number');
  const isForToday = rawDate === todayInTz(tz).replace(/-/g, '/');
  const sessionStart = workoutStartedAt ? new Date(workoutStartedAt)
    : firstSetStartMs != null ? new Date(firstSetStartMs)
    : isForToday ? new Date()
    : startOfDay;

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
    const todaySessions = await repo.getDayLog(userId, rawDate, tz);
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
        intensityMode ?? null, wasOverride ?? false,
      );
      wsId = ws.id;
    }
  }

  if (warmupEndedAtMs) {
    await repo.setWorkoutSessionWarmupEnd(userId, wsId, new Date(warmupEndedAtMs))
  }

  const isBaseline = currentPhaseType === 'baseline';
  const isAnyDeload = currentPhaseType === 'deload' || sessionIsEarlyDeload;
  /** The one predicate that decides whether this exercise's 1RM is estimated at all — named once so
   *  the estimate and the stored provenance cannot disagree, which is exactly how Q-298 arose. */
  const deloadedForEstimate = isDeloadedForEstimate({ exerciseDeloaded, isAnyDeload, isBaseline });
  // Mirrors shouldCountTowardPr's gate below: a deliberately submaximal set — whether from a
  // static program's deload phase (isAnyDeload) or an AI per-exercise/whole-session deload
  // (exerciseDeloaded) — must never feed the 1RM estimate itself, not just be excluded from
  // becoming a new PR (Q-115). Baseline is the same carve-out as the PR gate: a baseline test
  // is a genuine max-effort attempt even during an otherwise-active deload window.
  const lastSetEndMs = setEndTimes?.filter((t): t is number => typeof t === 'number').at(-1);
  const loggedAt = lastSetEndMs != null ? new Date(lastSetEndMs)
    : workoutStartedAt != null ? new Date(workoutStartedAt)
    : new Date();
  const hasBars = exerciseType !== 'bodyweight' && !deloadedForEstimate && (plannedWeights?.some(w => w != null) ?? false);
  const basisKg = !hasBars ? null : prescriptionBasisKg ?? await repo.getPrescriptionBasisBefore(userId, exercise, loggedAt, clientExerciseLogId);
  const { estimated1rm, target80 } = estimateOneRm(
    weights.map((w, i) => ({ weightKg: w, reps: reps[i] ?? 0 })),
    { exerciseType, style: withPrescribedBars(progressionStyle, plannedWeights, basisKg), isBaseline, deloaded: deloadedForEstimate },
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
      // #2450: a source with no RPE beside it would describe nothing, so it is dropped.
      rpeSource: rpeValues?.[i] != null ? (rpeSources?.[i] ?? undefined) : undefined,
      // Q-14: a bodyweight movement is never prescribed a %1RM — resolveBodyweightStyle turns the
      // style's pct into a rep target instead. Storing that pct here put it alongside a
      // BW_REF-relative intensity_pct on a different basis, so every bodyweight set recorded a
      // phantom 14-18 pp overshoot. The rep target is the prescription that was actually delivered.
      plannedPct:     exerciseType === 'bodyweight' ? undefined : (progressionStyle?.[i]?.pct ?? undefined),
      plannedReps:    progressionStyle?.[i]?.reps ?? undefined,
      plannedRestSec: progressionStyle?.[i]?.restSec ?? undefined,
      // #2445: a bodyweight bar is never prescribed (the prescription route returns null for one),
      // so a stray value there is dropped rather than stored as a load target. Same reasoning as
      // planned_pct above.
      plannedWeightKg: exerciseType === 'bodyweight' ? undefined : (plannedWeights?.[i] ?? undefined),
    };
  });

  // E1-2: stamp the exercise at its real completion time, not server-receive time.
  // An outbox replay days later would otherwise date the log to sync day, corrupting
  // 1RM history/trend ordering (`ORDER BY loggedAt`) and PR tiebreaks. Prefer the
  // last set's end, then the workout start; fall back to now only when the payload
  // carries no timing at all (never true for a normal client submit).


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

  const logged = await repo.logExerciseAndSets(userId, {
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
    // Q-298: record the predicate that ACTUALLY zeroed the estimate, not just the AI flag.
    //
    // The `deloaded:` argument above is `exerciseDeloaded === true || (isAnyDeload && !isBaseline)`,
    // so a phase-level deload zeroes the 1RM — and this line used to store `exerciseDeloaded ?? false`,
    // leaving the row saying `exercise_deloaded = false` about work the app had just declined to
    // estimate. The row did not describe what happened to it.
    //
    // Deliberately NOT changed: the `exerciseDeloaded` passed to `shouldCountTowardPr` below, which
    // takes `isAnyDeload` separately and already gates on it. This changes what is STORED, not what
    // is decided, so no PR behaviour moves.
    exerciseDeloaded: deloadedForEstimate,
    // #3745: stored only, read by nothing yet. Absent (an older build) writes nothing over a stored one.
    effortVsPlan: effort?.vsPlan ?? null,
    effortSource: effort?.source ?? null,
  }, setData.map((s, i) => ({ ...s, id: clientSetLogIds?.[i] })), stamp);
  const superseded = logged.superseded === true;

  let isPR = false;
  // A superseded copy was not written, so its estimate must not reach personal_records either: a
  // stale lbs-as-kg log would otherwise re-mint the record the fix just corrected.
  if (!superseded && shouldCountTowardPr({
    estimated1rm,
    isAnyDeload,
    isBaseline,
    exerciseDeloaded: exerciseDeloaded ?? false,
  })) {
    // #3671: dated by the set, not the upload, so a workout synced after midnight keeps its day.
    // #4021: pass the log's id so the step writes under the log's current name if a rename moved it.
    isPR = await repo.upsertPersonalRecordIfBetter(userId, exercise, estimated1rm, loggedAt, logged.exerciseLog.id);
  }

  // #3896: a log of a plan that carried the lift's one-shot ("lighter / heavier next time", ±1 set)
  // consumes it. The plan records the one-shot's write time (`liftPreference.oneShotSetAt`) and the
  // client echoes it in the payload; the conditional write clears the row only if it still holds that
  // exact value, so a log of an older plan, of another session, or of a stale queue entry leaves a
  // one-shot it never carried alone, and a forged value matches nothing (it is compared, never stored).
  // A deload or baseline log never carried it, and a re-push of a stored log is not a new one.
  // Best-effort: the log is already saved, and a failed clear leaves the one-shot for the next log
  // (or for its expiry) rather than losing the workout.
  const servedOneShotAt = payload.liftOneShotSetAt ? new Date(payload.liftOneShotSetAt) : null
  if (!superseded && servedOneShotAt && !Number.isNaN(servedOneShotAt.getTime()) && logMayConsumeOneShot({
    isNewLog: logged.inserted === true, deloaded: deloadedForEstimate, baseline: isBaseline,
  })) {
    await (async () => repo.consumeLiftOneShot(userId, exercise, servedOneShotAt))()
      .catch(err => console.error('[log-exercise] one-shot clear failed (left for the next log):', err));
  }

  return {
    workoutSessionId: wsId,
    exerciseLogId: logged.exerciseLog.id,
    estimated1rm,
    target80,
    isPR,
    superseded,
  };
}
