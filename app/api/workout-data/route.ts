import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRepository } from "@/lib/data";
import type { ProgramPhase } from "@trainingai/shared/types/program";
import { todayInTz, shiftDateStr, DEFAULT_TZ } from "@trainingai/shared/date-utils";
import { buildAutomaticPhaseStatus, isEarlyDeloadWeek } from "@trainingai/shared/phase-engine";
import { getScheduledSessionsPerWeek } from "@trainingai/shared/schedule-utils";
import { prescriptionDrivesLoad } from "@trainingai/shared/ai-periodization/apply-prescription";
import { reevaluatePrescriptionForToday, reevaluationKey } from "@trainingai/shared/ai-periodization/reevaluate";
import { resolveSelfReportedSick } from "@trainingai/shared/ai-periodization/signals";
import { normalizeStoredPrescription } from "@trainingai/shared/ai-periodization/reconcile-prescription";
import { latestIllnessFromDerived } from "@trainingai/shared/health/illness-radar";
import { isAiPrescriptionPending } from "@trainingai/shared/ai-periodization/prescription-pending";
import { moodMuscleMatches } from "@trainingai/shared/muscles";
import type { AiPrescription } from "@trainingai/shared/types/ai-periodization";
import {
  buildWorkoutExercises,
  aiDynamicFallbackPhaseStatus,
  type WorkoutExercise,
  type PhaseStatus,
  type PerSessionPhaseStatus,
} from "@trainingai/shared/workout/session-data";
import { reportServerError } from "@/lib/observability";
import { rateLimit } from "@/lib/rate-limit";
import { generatePrescriptionForSession } from "@trainingai/shared/ai-periodization/generate-prescription";

// Re-exported so existing type imports (e.g. `import('@/app/api/workout-data/route').PhaseStatus`)
// keep resolving after the interfaces moved to lib/workout/session-data.ts.
export type { WorkoutExercise, PhaseStatus, PerSessionPhaseStatus };

export async function GET(req: NextRequest) {
  try {
    return await handleWorkoutData(req);
  } catch (err) {
    // K8: one of the two reads the whole offline architecture leans on. An
    // uncaught throw here (e.g. drifted prod data the local seed can't reproduce)
    // otherwise 500s with no server trace — record it before the framework 500.
    reportServerError(err, { url: req.nextUrl.pathname });
    return NextResponse.json({ error: "Failed to load workout data" }, { status: 500 });
  }
}

// Regenerate this session's prescription in-process instead of POSTing back to this same
// server's /api/ai-periodization/session/[id]/prescribe (Q-122): a server-to-self round trip
// consumes a second request worker and a second pool connection for work this process can do
// itself, and it has actually failed in production ("fetch failed"). The route it replaced is a
// thin wrapper over generatePrescriptionForSession, so the work is identical — including its
// rate-limit budget, re-applied here under the same key so an unattended poll loop still cannot
// mint unlimited Gemini calls.
function regeneratePrescriptionInBackground(
  userId: string,
  programSessionId: string,
  repo: Awaited<ReturnType<typeof getRepository>>,
  tz: string,
) {
  if (!rateLimit(`prescribe:${userId}`, 20, 60 * 60 * 1000)) return
  void generatePrescriptionForSession(userId, programSessionId, repo, tz)
    .catch(err => reportServerError(err, { userId, url: '/api/workout-data#prescribe' }))
}

async function handleWorkoutData(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionParam = searchParams.get("tab") ?? searchParams.get("session") ?? "";
  const aiDeload = searchParams.get("aiDeload") === "1";
  // A client poll while the prescription regenerates: read the current state (incl.
  // aiPrescriptionPending) WITHOUT re-firing generation. Without this, the pre-workout
  // screen's ~3s poll fires a fresh /prescribe every tick, turning one generation into a
  // burst of ~8 Gemini calls that trips the model's per-minute rate limit and 502s them all.
  const isPoll = searchParams.get("poll") === "1";

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const repo = await getRepository();

  const [program, styles, library] = await Promise.all([
    repo.getActiveProgram(userId),
    repo.listProgressionStyles(userId),
    repo.listExerciseLibrary(),
  ]);
  if (!program) return NextResponse.json({ exercises: [], sessions: [] });
  const styleById = new Map(styles.map(s => [s.id, s.sets]));
  const styleByName = new Map(styles.map(s => [s.name, s.sets]));
  const libByName = new Map(library.map(e => [e.name.toLowerCase(), e]));

  // A poll is checking whether the regenerating prescription has landed, so it must NOT be
  // HTTP-cached: with max-age=30 the browser serves the first poll's `aiPrescriptionPending:true`
  // response to every subsequent poll for 30s — the whole poll window — so the client never sees
  // the prescription that lands mid-window and times out into "couldn't generate" even though
  // generation succeeded (prod 2026-07-19). Non-poll reads keep the SWR cache for instant paint.
  const cacheHeaders = isPoll
    ? { 'Cache-Control': 'no-store' }
    : { 'Cache-Control': 'private, no-store' };

  // If sessionParam is "meta" or empty, return just the program structure
  if (!sessionParam || sessionParam === "meta") {
    let phaseStatus: PhaseStatus | null = null
    let perSessionPhaseStatus: PerSessionPhaseStatus[] = []
    if (program.phaseMode === 'automatic') {
      const phases = await repo.listProgramPhases(userId, program.id)
      if (phases.length > 0) {
        const tz = session?.user?.timezone ?? DEFAULT_TZ
        const today = todayInTz(tz)
        const sessionCounts = await repo.countAllSessionsSinceStart(userId, program.id)
        const totalPerWeek = getScheduledSessionsPerWeek(program)
        const numSessions = Math.max(1, program.sessions.length)
        const sessionPerWeek = totalPerWeek / numSessions

        perSessionPhaseStatus = program.sessions.map(sess => {
          const count = sessionCounts.get(sess.id) ?? 0
          return {
            sessionId: sess.id,
            sessionName: sess.name,
            phaseStatus: buildAutomaticPhaseStatus(phases, count, program, today, sessionPerWeek),
          }
        })

        // Leader = session furthest through the program (most completedCycles)
        if (perSessionPhaseStatus.length > 0) {
          const leader = perSessionPhaseStatus.reduce((best, curr) =>
            curr.phaseStatus.completedCycles > best.phaseStatus.completedCycles ? curr : best
          )
          phaseStatus = leader.phaseStatus
        }
      }
    }
    return NextResponse.json({ program, styles, phaseStatus, perSessionPhaseStatus }, { headers: cacheHeaders });
  }

  // ── Batch variant (?tab=all): every session's full workout data in one response ──────
  // Collapses the home/workout-select N+1 per-session prefetch into a single request.
  // STRICTLY READ-ONLY — unlike the single-tab path below it fires NO /prescribe, does NO
  // DB writes, and runs NO consumption-day reevaluate. It computes each session's exercises +
  // phaseStatus purely from already-stored prescription state (an expired prescription simply
  // stops driving load, without the 'dismissed' write the single-tab path makes). The client
  // seeds each per-session `workout-card:<id>` cache key from this; the authoritative single-tab
  // fetch on actual tab-open does the reevaluate/regenerate work.
  if (sessionParam === "all") {
    const tz = session?.user?.timezone ?? DEFAULT_TZ
    const todayStr = todayInTz(tz)
    const isAutomatic = program.phaseMode === 'automatic'
    const isAiDynamic = program.phaseMode === 'ai_dynamic'

    // Shared data fetched once for every session. lastLogs/priorLogs are DISTINCT ON
    // (exercise_name) so a single union call returns per-name last logs identical to the
    // per-session calls the single-tab path makes — no partitioning needed (buildWorkoutExercises
    // only ever looks up its own session's exercise names).
    const unionNames = [...new Set(program.sessions.flatMap(s => s.exercises.map(ex => ex.exerciseName)))]
    const [allPhases, prMap, todayExercises, sessionCounts, lastLogs, lastRealOneRm, priorLogsThisProgram, estimates] = await Promise.all([
      isAutomatic ? repo.listProgramPhases(userId, program.id) : Promise.resolve([] as ProgramPhase[]),
      repo.listPersonalRecords(userId),
      repo.getDayExerciseNames(userId, todayStr.replace(/-/g, '/')),
      isAutomatic ? repo.countAllSessionsSinceStart(userId, program.id) : Promise.resolve(new Map<string, number>()),
      repo.getLastExerciseLogsBatch(userId, unionNames),
      repo.getLastRealOneRmBatch(userId, unionNames),
      isAiDynamic ? repo.getLastExerciseLogsBatch(userId, unionNames, program.id) : Promise.resolve(null),
      repo.getExerciseEstimates(userId).catch(() => []),
      // Heals the stored sessions_in_phase before the periodization read below turns it into
      // completedCycles / phaseSessionNumber (SYNC-T2). Batched here rather than awaited
      // separately so it costs no extra round-trip; advisory, so a failure must not take the
      // whole workout screen down with it.
      isAiDynamic ? repo.reconcileSessionsInPhase(userId, program.id).catch(() => {}) : Promise.resolve(),
    ])
    const estimateMap = new Map(estimates.map(e => [e.exerciseName, e.estimated1rm]))

    const totalPerWeek = getScheduledSessionsPerWeek(program)
    const numSessions = Math.max(1, program.sessions.length)
    const sessionPerWeek = totalPerWeek / numSessions

    // A confirmed early-deload week is the only deload signal this batch path can see — it takes no
    // `aiDeload` query param — and for ai_dynamic programs it reached nothing at all until Q-175.
    const earlyDeloadWeek = isEarlyDeloadWeek(program, todayStr)

    // Per-session AI periodization state (ai_dynamic only) fetched in parallel.
    const periodizationBySession = new Map(
      await Promise.all(program.sessions.map(async (sess) =>
        [sess.id, isAiDynamic ? await repo.getSessionPeriodization(userId, sess.id) : null] as const,
      )),
    )

    const perSession: Record<string, {
      exercises: WorkoutExercise[]
      program: typeof program
      session: (typeof program.sessions)[number]
      phaseStatus: PhaseStatus | null
      dataDate: string
      aiPrescriptionPending: boolean
    }> = {}

    for (const programSession of program.sessions) {
      const exerciseNames = programSession.exercises.map(ex => ex.exerciseName)
      const aiPeriodizationState = periodizationBySession.get(programSession.id) ?? null

      const loggedTodayInThisSession = new Set(
        todayExercises
          .filter(e => e.sessionId === programSession.id)
          .map(e => e.exerciseName),
      )

      // Phase resolution — per-session count (same sessionCounts map the single-tab path derives).
      let currentPhase: ProgramPhase | null = null
      let sessionPhaseStatus: PhaseStatus | null = null
      if (isAutomatic && allPhases.length > 0) {
        const thisSessionCount = sessionCounts.get(programSession.id) ?? 0
        sessionPhaseStatus = buildAutomaticPhaseStatus(allPhases, thisSessionCount, program, todayStr, sessionPerWeek)
        currentPhase = sessionPhaseStatus.phase
      }

      const hasAnyPriorLog = priorLogsThisProgram != null && exerciseNames.some(name => priorLogsThisProgram.has(name))
      const isAiDynamicBaseline = isAiDynamic
        && aiPeriodizationState?.phase === 'baseline'
        && !aiPeriodizationState?.baselineComplete
        && !hasAnyPriorLog

      const isBaselinePhase = currentPhase?.phaseType === 'baseline' || isAiDynamicBaseline

      if (isAiDynamicBaseline && !sessionPhaseStatus) {
        sessionPhaseStatus = {
          phase: { id: '', phaseSetId: '', position: 0, name: 'Baseline', durationCycles: 1, phaseType: 'baseline' } as ProgramPhase,
          cycleInPhase: 1,
          totalPhaseCycles: 1,
          completedCycles: 0,
          totalProgramCycles: 0,
          sessionsPerCycle: 1,
          sessionsInCurrentCycle: 0,
          blockComplete: false,
          approxWeeksRemaining: null,
          isDeloadActive: false,
          isBaseline: true,
          openEnded: true,
          phaseSessionNumber: 1,
        }
      }

      if (earlyDeloadWeek && isAiDynamic && !sessionPhaseStatus) {
        sessionPhaseStatus = {
          phase: { id: '', phaseSetId: '', position: 0, name: 'Deload', durationCycles: 1, phaseType: 'deload' } as ProgramPhase,
          cycleInPhase: 1,
          totalPhaseCycles: 1,
          completedCycles: 0,
          totalProgramCycles: 0,
          sessionsPerCycle: 1,
          sessionsInCurrentCycle: 0,
          blockComplete: false,
          approxWeeksRemaining: null,
          isDeloadActive: true,
          isBaseline: false,
          openEnded: true,
          phaseSessionNumber: 1,
        }
      } else if (earlyDeloadWeek && isAiDynamic && sessionPhaseStatus) {
        sessionPhaseStatus = { ...sessionPhaseStatus, isDeloadActive: true }
      }

      if (isAiDynamic && !sessionPhaseStatus && aiPeriodizationState) {
        sessionPhaseStatus = aiDynamicFallbackPhaseStatus(aiPeriodizationState)
      }

      const aiPrescription = isAiDynamic && !isBaselinePhase && aiPeriodizationState?.prescription
        ? normalizeStoredPrescription(
            aiPeriodizationState.prescription, aiPeriodizationState.phase,
            new Map(programSession.exercises.map(ex => [ex.id, ex.exerciseRole])),
          )
        : null
      const aiDrivesLoad = aiPrescription != null && aiPeriodizationState != null
        && prescriptionDrivesLoad(aiPrescription.phaseAction, aiPeriodizationState.prescriptionStatus)

      const aiPhaseLabel = aiPrescription ? aiPrescription.phase.charAt(0).toUpperCase() + aiPrescription.phase.slice(1) : ''
      const aiPrescriptionPending = isAiPrescriptionPending(aiPeriodizationState, { isAiDynamic, isBaselinePhase })
      const droppedThisCycle = new Set(aiDrivesLoad ? (aiPrescription!.droppedExerciseIds ?? []) : [])

      const exercises = buildWorkoutExercises(programSession, {
        lastLogs,
        lastRealOneRm,
        prMap,
        estimateMap,
        styleById,
        styleByName,
        styles,
        libByName,
        currentPhase,
        allPhases,
        isDeloadActive: sessionPhaseStatus?.isDeloadActive ?? false,
        isBaselinePhase,
        aiDrivesLoad,
        aiPrescription,
        aiPhaseLabel,
        isAiDynamic,
        aiDeload: false,
        droppedThisCycle,
        loggedTodayInThisSession,
        trainingGoal: program.trainingGoal,
      })

      perSession[programSession.id] = {
        exercises,
        program,
        session: programSession,
        phaseStatus: sessionPhaseStatus,
        dataDate: todayStr,
        aiPrescriptionPending,
      }
    }

    return NextResponse.json({ perSession }, { headers: cacheHeaders });
  }

  // Resolve strictly by session id (every caller passes the DB id — nav via ?session=<id>,
  // card prefetch via the session's id). No name match and no sessions[0] fallback: a stale
  // id must surface as "not found" (so the client can re-sync its offline program mirror and
  // reselect), never silently return the wrong session's data. Identity = id, never name.
  const programSession = program.sessions.find(s => s.id === sessionParam);

  if (!programSession) {
    // sessionNotFound tells the client its session id is stale (offline mirror out of sync
    // after a program edit) so it can force an id-based re-sync instead of dead-ending.
    return NextResponse.json({ exercises: [], sessionNotFound: true }, { headers: cacheHeaders });
  }

  // styles + library already fetched above — run session-specific queries in parallel
  const exerciseNames = programSession.exercises.map(ex => ex.exerciseName);
  const isAutomatic = program.phaseMode === 'automatic';
  const isAiDynamic = program.phaseMode === 'ai_dynamic';
  const tz = session?.user?.timezone ?? DEFAULT_TZ
  const todayStr = todayInTz(tz)

  const [allPhases, lastLogs, lastRealOneRm, todayExercises, aiPeriodizationState, prMap, estimates] = await Promise.all([
    isAutomatic ? repo.listProgramPhases(userId, program.id) : Promise.resolve([] as ProgramPhase[]),
    repo.getLastExerciseLogsBatch(userId, exerciseNames),
    repo.getLastRealOneRmBatch(userId, exerciseNames),
    repo.getDayExerciseNames(userId, todayStr.replace(/-/g, '/')),
    // Reconcile first, then read: the stored counter feeds completedCycles /
    // phaseSessionNumber below and has drifted three times (SYNC-T2). Chained inside the
    // Promise.all so it still runs alongside the other five queries.
    isAiDynamic
      ? repo.reconcileSessionsInPhase(userId, program.id)
          .catch(() => {})
          .then(() => repo.getSessionPeriodization(userId, programSession.id))
      : Promise.resolve(null),
    repo.listPersonalRecords(userId),
    repo.getExerciseEstimates(userId).catch(() => []),
  ]);
  const estimateMap = new Map(estimates.map(e => [e.exerciseName, e.estimated1rm]));

  // Only count an exercise as "done today" if it was logged as part of *this* program
  // session — exercises shared between sessions (e.g. Tricep Cable Combo in both Push
  // and Upper) shouldn't show as completed here just because they were done elsewhere today.
  const loggedTodayInThisSession = new Set(
    todayExercises
      .filter(e => e.sessionId === programSession.id)
      .map(e => e.exerciseName),
  );

  // Phase resolution — per-session count for this specific session
  let currentPhase: ProgramPhase | null = null
  let sessionPhaseStatus: PhaseStatus | null = null
  if (isAutomatic && allPhases.length > 0) {
    const sessionCounts = await repo.countAllSessionsSinceStart(userId, program.id)
    const thisSessionCount = sessionCounts.get(programSession.id) ?? 0
    const totalPerWeek = getScheduledSessionsPerWeek(program)
    const numSessions = Math.max(1, program.sessions.length)
    const sessionPerWeek = totalPerWeek / numSessions
    sessionPhaseStatus = buildAutomaticPhaseStatus(allPhases, thisSessionCount, program, todayStr, sessionPerWeek)
    currentPhase = sessionPhaseStatus.phase
  }

  // AI Dynamic baseline: first session before baseline is marked complete = 1 AMRAP set per exercise.
  // Guard against stale DB state: if any exercise already has prior logs, baseline was already done
  // (the completion call was missed, e.g. due to app crash). Don't force AMRAP mode in that case.
  // Program-scoped (not the general cross-program `lastLogs` used for display below) — a
  // shared exercise name logged under a *different* program mustn't let this fresh
  // ai_dynamic cycle skip its own AMRAP baseline week.
  const priorLogsThisProgram = isAiDynamic
    ? await repo.getLastExerciseLogsBatch(userId, exerciseNames, program.id)
    : null
  const hasAnyPriorLog = priorLogsThisProgram != null && exerciseNames.some(name => priorLogsThisProgram.has(name))
  const isAiDynamicBaseline = isAiDynamic
    && aiPeriodizationState?.phase === 'baseline'
    && !aiPeriodizationState?.baselineComplete
    && !hasAnyPriorLog

  const isBaselinePhase = currentPhase?.phaseType === 'baseline' || isAiDynamicBaseline

  // Surface isBaseline to the client for AI Dynamic programs so the active workout
  // shows the AMRAP banner and labels sets as "AMRAP" instead of "Set N".
  if (isAiDynamicBaseline && !sessionPhaseStatus) {
    sessionPhaseStatus = {
      phase: { id: '', phaseSetId: '', position: 0, name: 'Baseline', durationCycles: 1, phaseType: 'baseline' } as ProgramPhase,
      cycleInPhase: 1,
      totalPhaseCycles: 1,
      completedCycles: 0,
      totalProgramCycles: 0,
      sessionsPerCycle: 1,
      sessionsInCurrentCycle: 0,
      blockComplete: false,
      approxWeeksRemaining: null,
      isDeloadActive: false,
      isBaseline: true,
      openEnded: true,
      phaseSessionNumber: 1,
    }
  }

  // The app has TWO deload-confirmation entry points and they must converge here: the pre-workout
  // Full/Deload/Rest toggle (`?aiDeload=1`) and Home's "Take deload week now" card, which writes
  // `programs.earlyDeloadWeekStart` and passes no query param at all. Q-109 wired the first into
  // the AI-dynamic load; Q-175 is the second arriving a week late, having produced byte-identical
  // full-intensity prescriptions for the whole confirmed week.
  const aiDeloadNow = aiDeload || isEarlyDeloadWeek(program, todayStr)

  // ai_dynamic deload: user chose deload from the home screen — surface isDeloadActive to workout
  if (aiDeloadNow && isAiDynamic && !sessionPhaseStatus) {
    sessionPhaseStatus = {
      phase: { id: '', phaseSetId: '', position: 0, name: 'Deload', durationCycles: 1, phaseType: 'deload' } as ProgramPhase,
      cycleInPhase: 1,
      totalPhaseCycles: 1,
      completedCycles: 0,
      totalProgramCycles: 0,
      sessionsPerCycle: 1,
      sessionsInCurrentCycle: 0,
      blockComplete: false,
      approxWeeksRemaining: null,
      isDeloadActive: true,
      isBaseline: false,
      openEnded: true,
      phaseSessionNumber: 1,
    }
  } else if (aiDeloadNow && isAiDynamic && sessionPhaseStatus) {
    sessionPhaseStatus = { ...sessionPhaseStatus, isDeloadActive: true }
  }

  // For AI dynamic programs not already handled above (not baseline, not a user-confirmed
  // deload), still return a non-null phaseStatus with isBaseline:false so the client always
  // receives an explicit signal and can clear any stale baseline state from cache. The
  // engine-chosen `phase: 'deload'` lands here too — see aiDynamicFallbackPhaseStatus.
  if (isAiDynamic && !sessionPhaseStatus && aiPeriodizationState) {
    sessionPhaseStatus = aiDynamicFallbackPhaseStatus(aiPeriodizationState)
  }

  // AI Dynamic: when a prescription is in effect (accepted/auto-applied, or a pending
  // "stay"), its per-exercise sets/reps/pct drive the loaded weights instead of the
  // static progression style. This is what makes the phase actually reach the bar.
  let aiPrescription = isAiDynamic && !isBaselinePhase && aiPeriodizationState?.prescription
    ? normalizeStoredPrescription(
        aiPeriodizationState.prescription, aiPeriodizationState.phase,
        new Map(programSession.exercises.map(ex => [ex.id, ex.exerciseRole])),
      )
    : null
  const aiDrivesLoad = aiPrescription != null && aiPeriodizationState != null
    && prescriptionDrivesLoad(aiPrescription.phaseAction, aiPeriodizationState.prescriptionStatus)

  if (aiDrivesLoad && aiPrescription && aiPeriodizationState) {
    // Consumption-day re-evaluation (AI-2/AI-3) — re-derive per-exercise soreness/injury
    // deloads against TODAY's signals without re-running the LLM.
    //
    // Two guards were removed here and replaced by one input fingerprint:
    //  - "only if generated on an earlier day" made a prescription generated TODAY (what
    //    the completion-time regeneration produces) never see soreness logged later the
    //    same day — the case where a same-day check-in matters most;
    //  - "only once per calendar date" was stamped by the FIRST read of the day, so a
    //    check-in logged after that (the normal order: open the app, then log how you feel)
    //    could never take effect either.
    // The fingerprint below keeps the cheap skip on repeat fetches while re-running the
    // moment the inputs actually change. All three reads here are cheap, indexed
    // single-user lookups (injuries is a handful of rows at most); they buy skipping the
    // three heavier queries below.
    const [todayMoodLog, yesterdayMoodLog, todayMorningCheckin, injuries] = await Promise.all([
      repo.getMoodLog(userId, todayStr),
      repo.getMoodLog(userId, shiftDateStr(todayStr, -1)),
      repo.getDayCheckin(userId, todayStr, 'morning'),
      repo.listInjuries(userId),
    ])
    const inputsKey = reevaluationKey(todayStr, todayMoodLog ?? yesterdayMoodLog, todayMorningCheckin, injuries)
    if (aiPrescription.reevaluatedInputsKey !== inputsKey) {
      const [recentSessions, muscleAssignmentsMap, derivedRows] = await Promise.all([
        repo.getRecentSessionsOfType(userId, programSession.id, 5),
        repo.getExerciseMuscleAssignments(exerciseNames),
        repo.getOuraDailyDerived(userId, shiftDateStr(todayStr, -1), todayStr),
      ])

      // Ignore a session that completed AFTER this prescription was generated — the same
      // rule the generation path applies via excludeSessionId (W5 §4.2). Such a session is
      // already baked into the prescription, and its ~0h gap would otherwise satisfy the
      // emergency-deload "<36h and 3+ sore muscles" condition on the very next open. This
      // matters now that same-day prescriptions re-evaluate at all (previously the
      // generated-day guard made the case unreachable).
      const generatedAt = aiPeriodizationState.prescriptionGeneratedAt
      const lastCompleted = recentSessions.find(s =>
        s.completedAt != null && (generatedAt == null || s.completedAt <= generatedAt))
      const hoursSinceLastSession = lastCompleted?.completedAt
        ? (Date.now() - lastCompleted.completedAt.getTime()) / 3_600_000
        : null

      const sessionMuscleGroups = programSession.exercises.flatMap(ex => ex.muscleGroups)
      const activeInjuredMusclesInSession = [...new Set(
        injuries
          .filter(i => !i.resolvedDate)
          .map(i => i.muscleName)
          .filter(muscle => sessionMuscleGroups.some(mg => moodMuscleMatches(mg, muscle)))
      )]
      const moodLogToUse = todayMoodLog ?? yesterdayMoodLog
      const soreMusclesInSession: string[] = []
      if (moodLogToUse?.bodyState.includes('sore_muscles') && moodLogToUse.soreMuscles.length > 0) {
        for (const soreMuscle of moodLogToUse.soreMuscles) {
          if (sessionMuscleGroups.some(mg => moodMuscleMatches(mg, soreMuscle))) {
            soreMusclesInSession.push(soreMuscle)
          }
        }
      }

      const reevalResult = reevaluatePrescriptionForToday(
        aiPrescription,
        {
          soreMusclesInSession,
          hoursSinceLastSession,
          activeInjuredMusclesInSession,
          trainingGoal: program.trainingGoal,
          illnessFlag: latestIllnessFromDerived(derivedRows)?.flag ?? null,
          selfReportedSick: resolveSelfReportedSick(todayMoodLog?.bodyState, todayMorningCheckin?.illnessContext),
          exercises: programSession.exercises.map(ex => ({
            sessionExerciseId: ex.id,
            name: ex.exerciseName,
            // Same library→muscleGroups fallback as generation time (signals.ts): without it a
            // custom/non-library exercise re-evaluates with zero assignments, so its per-exercise
            // deload silently reverts to full load while the muscle is still sore (E2-2).
            muscleAssignments: muscleAssignmentsMap[ex.exerciseName]?.length
              ? muscleAssignmentsMap[ex.exerciseName]
              : ex.muscleGroups.map(mg => ({ muscle: mg, role: 'main' as const })),
          })),
        },
        {
          phase: aiPeriodizationState.phase,
          prescription: aiPeriodizationState.prescription,
          prescriptionStatus: aiPeriodizationState.prescriptionStatus,
          prescriptionExpiresAt: aiPeriodizationState.prescriptionExpiresAt,
        },
      )

      if (reevalResult.needsRegenerate) {
        regeneratePrescriptionInBackground(userId, programSession.id, repo, tz)
      } else {
        const stamped: AiPrescription = { ...reevalResult.prescription, reevaluatedInputsKey: inputsKey }
        aiPrescription = stamped
        repo.updatePrescriptionExercisesCache(userId, programSession.id, stamped).catch(() => {})
      }
    }
  }

  // Failed-generation signature: the previous session consumed its prescription slot but no
  // prescription ever landed (Gemini outage/error at completion time). Without a retry here,
  // the gap persists until the *next* session's completion — one outage costs two sessions of
  // prescriptions. Fire-and-forget regenerate, same idempotent /prescribe endpoint the
  // completion and transition paths already use.
  // A fresh AI prescription is in flight: the slot was consumed (by a completed session, a
  // phase transition, or a program edit) and the regeneration below hasn't landed yet. The
  // client uses this to show a "preparing your AI workout" state instead of painting the
  // base-program numbers the AI is about to replace.
  const aiPrescriptionPending = isAiPrescriptionPending(aiPeriodizationState, { isAiDynamic, isBaselinePhase })
  if (aiPrescriptionPending && !isPoll) {
    regeneratePrescriptionInBackground(userId, programSession.id, repo, tz)
  }
  const aiPhaseLabel = aiPrescription ? aiPrescription.phase.charAt(0).toUpperCase() + aiPrescription.phase.slice(1) : ''

  // Workout Review "drop this cycle": while the overlay drives load, exercises it dropped
  // for this cycle are omitted from the session. The exercise stays in the program and
  // reappears once the prescription is regenerated (permanent drops delete the row instead).
  const droppedThisCycle = new Set(aiDrivesLoad ? (aiPrescription!.droppedExerciseIds ?? []) : [])

  const exercises: WorkoutExercise[] = buildWorkoutExercises(programSession, {
    lastLogs,
    lastRealOneRm,
    prMap,
    estimateMap,
    styleById,
    styleByName,
    styles,
    libByName,
    currentPhase,
    allPhases,
    isDeloadActive: sessionPhaseStatus?.isDeloadActive ?? false,
    isBaselinePhase,
    aiDrivesLoad,
    aiPrescription,
    aiPhaseLabel,
    isAiDynamic,
    aiDeload,
    droppedThisCycle,
    loggedTodayInThisSession,
    trainingGoal: program.trainingGoal,
  });

  return NextResponse.json({ exercises, program, session: programSession, phaseStatus: sessionPhaseStatus, dataDate: todayStr, aiPrescriptionPending }, { headers: cacheHeaders });
}
