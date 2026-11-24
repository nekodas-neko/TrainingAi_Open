import { capitalize } from '@trainingai/shared/format/capitalize';
import { sessionSoreness } from "@trainingai/shared/ai-periodization/session-soreness";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRepository } from "@/lib/data";
import type { ProgramPhase } from "@trainingai/shared/types/program";
import { todayInTz, shiftDateStr, startOfWeekInTz, DEFAULT_TZ } from "@trainingai/shared/date-utils";
import { buildAutomaticPhaseStatus } from "@trainingai/shared/phase-engine";
import { getScheduledSessionsPerWeek } from "@trainingai/shared/schedule-utils";
import { prescriptionDrivesLoad } from "@trainingai/shared/ai-periodization/apply-prescription";
import { reevaluatePrescriptionForToday, reevaluationKey, type ReevaluationSignals } from "@trainingai/shared/ai-periodization/reevaluate";
import { rowNumbersMoved } from "@trainingai/shared/ai-periodization/prescription-figures";
import { resolveSelfReportedSick, loadFigureSignals } from "@trainingai/shared/ai-periodization/signals";
import { normalizeStoredPrescription } from "@trainingai/shared/ai-periodization/reconcile-prescription";
import { latestIllnessFromDerived } from "@trainingai/shared/health/illness-radar";
import { isAiPrescriptionPending } from "@trainingai/shared/ai-periodization/prescription-pending";
import { readProgramDeloadCheck } from "@trainingai/shared/ai-periodization/program-phase";
import { moodMuscleMatches } from "@trainingai/shared/muscles";
import type { AiPrescription } from "@trainingai/shared/types/ai-periodization";
import {
  buildWorkoutExercises,
  type WorkoutExercise,
  type PhaseStatus,
  type PerSessionPhaseStatus,
} from "@trainingai/shared/workout/session-data";
import { reportServerError } from "@/lib/observability";
import { rateLimit } from "@/lib/rate-limit";
import { estimateProgramSessionMin } from "@trainingai/shared/workout/program-session-duration";
import { generatePrescriptionForSession } from "@trainingai/shared/ai-periodization/generate-prescription";
import { fitStoredPlanToCheckinBudget } from "@trainingai/shared/ai-periodization/checkin-plan-budget";
import { adoptPendingAiPlan } from "@trainingai/shared/ai-periodization/pending-plan-adoption";
import { isSessionUnderWay, sessionUnderWayCheck } from "@trainingai/shared/ai-periodization/session-under-way";
import { slotHoldsPlan } from "@trainingai/shared/ai-periodization/plan-status";
import { regeneratePrescriptionInBackground as regeneratePrescriptionSingleFlight } from "@trainingai/shared/ai-periodization/regenerate-in-background";
import { loadLiftPreferences } from "@trainingai/shared/ai-periodization/lift-preference-read";
import { readSessionFromStoredState, resolveSessionPhase } from "@trainingai/shared/workout/read-session";
import { rehold } from "@trainingai/shared/ai-periodization/checkin-plan-hold";
import { resolveWorkingBasis } from "@trainingai/shared/1rm";

// Re-exported so existing type imports (e.g. `import('@/app/api/workout-data/route').PhaseStatus`)
// keep resolving after the interfaces moved to lib/workout/session-data.ts.
export type { WorkoutExercise, PhaseStatus, PerSessionPhaseStatus };

// What a program that is not `automatic` has for phases and counts (none are read).
const NO_PHASE_STATE = { phases: [] as ProgramPhase[], sessionCounts: new Map<string, number>() };

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
// The in-flight guard, the reason it is not the rate limit, and why the marker is process-local
// rather than a row, are all in `regenerate-in-background.ts` (Q-470).
function regeneratePrescriptionInBackground(
  userId: string,
  programSessionId: string,
  repo: Awaited<ReturnType<typeof getRepository>>,
  tz: string,
) {
  regeneratePrescriptionSingleFlight(userId, programSessionId, {
    today: todayInTz(tz),
    allow: () => rateLimit(`prescribe:${userId}`, 20, 60 * 60 * 1000),
    run: () => generatePrescriptionForSession(userId, programSessionId, repo, tz),
    onError: err => reportServerError(err, { userId, url: '/api/workout-data#prescribe' }),
  })
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
      const { phases, sessionCounts } = await repo.getProgramPhaseState(userId, program.id)
      if (phases.length > 0) {
        const tz = session?.user?.timezone ?? DEFAULT_TZ
        const today = todayInTz(tz)
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
    // The Workout tab card's "~N min" per session (#2362): the duration model over each
    // exercise's assigned style, never exercises × a constant. Rides the meta response because
    // styles and equipment are already in hand here; a session with no styled exercise is absent.
    const estimatedMinBySession: Record<string, number> = {}
    for (const sess of program.sessions) {
      const min = estimateProgramSessionMin(
        sess.exercises.slice().sort((a, b) => a.position - b.position),
        styleById,
        name => libByName.get(name.toLowerCase())?.equipment,
      )
      if (min !== null) estimatedMinBySession[sess.id] = min
    }
    return NextResponse.json({ program, styles, phaseStatus, perSessionPhaseStatus, estimatedMinBySession }, { headers: cacheHeaders });
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
    const [{ phases: allPhases, sessionCounts }, prMap, todayExercises, lastLogs, lastRealOneRm, estimates, liftPreferences] = await Promise.all([
      // The phases and every session's count, in one query (#4050).
      isAutomatic ? repo.getProgramPhaseState(userId, program.id) : Promise.resolve(NO_PHASE_STATE),
      repo.listPersonalRecords(userId),
      repo.getDayExerciseNames(userId, todayStr.replace(/-/g, '/'), tz),
      repo.getLastExerciseLogsBatch(userId, unionNames),
      repo.getLastRealOneRmBatch(userId, unionNames),
      repo.getExerciseEstimates(userId).catch(() => []),
      // #3896: the user's lift preferences, for a static style the AI plan is not driving, with this
      // week's check-in hold (#3890) in the same read.
      loadLiftPreferences(repo, userId, unionNames, { checkinWeekStart: startOfWeekInTz(tz) }),
      // Heals the stored sessions_in_phase before the periodization read below turns it into
      // completedCycles / phaseSessionNumber (SYNC-T2). Batched here rather than awaited
      // separately so it costs no extra round-trip; advisory, so a failure must not take the
      // whole workout screen down with it.
      isAiDynamic ? repo.reconcileSessionsInPhase(userId, program.id).catch(() => {}) : Promise.resolve(),
    ])
    const estimateMap = new Map(estimates.map(e => [e.exerciseName, e.estimated1rm]))

    // Per-session AI periodization state (ai_dynamic only) fetched in parallel.
    const periodizationBySession = new Map(
      await Promise.all(program.sessions.map(async (sess) =>
        [sess.id, isAiDynamic ? await repo.getSessionPeriodization(userId, sess.id) : null] as const,
      )),
    )
    // #3876: an aligned program's deload ends at the program's cap, which every type shares, so one
    // read covers them all; none when no type is in a deload. A failed read falls back to the type's count.
    const programDeload = isAiDynamic
      ? await readProgramDeloadCheck(repo, userId, program.id,
          [...periodizationBySession.values()].find(s => s?.phase === 'deload'), tz).catch(() => null)
      : null

    // #3900 second review (1): a type with a workout under way keeps the plan it started with.
    const underWayFor = isAiDynamic ? await sessionUnderWayCheck(repo, userId) : () => false

    const perSession: Record<string, {
      exercises: WorkoutExercise[]
      program: typeof program
      session: (typeof program.sessions)[number]
      phaseStatus: PhaseStatus | null
      dataDate: string
      aiPrescriptionPending: boolean
      prescriptionSource?: AiPrescription['source']
    }> = {}

    for (const programSession of program.sessions) {
      const aiPeriodizationState = periodizationBySession.get(programSession.id) ?? null

      // The one read of a session from stored state, shared with the Next workout card (#4019).
      const read = readSessionFromStoredState({
        program,
        programSession,
        todayStr,
        allPhases,
        thisSessionCount: sessionCounts.get(programSession.id) ?? 0,
        periodization: aiPeriodizationState,
        programDeload,
        underWay: underWayFor(programSession.id),
        loggedTodayInThisSession: new Set(
          todayExercises
            .filter(e => e.sessionId === programSession.id)
            .map(e => e.exerciseName),
        ),
        shared: { lastLogs, lastRealOneRm, prMap, estimateMap, styleById, styleByName, styles, libByName, liftPreferences },
      })

      perSession[programSession.id] = {
        exercises: read.exercises,
        program,
        session: programSession,
        phaseStatus: read.phaseStatus,
        dataDate: todayStr,
        aiPrescriptionPending: read.aiPrescriptionPending,
        prescriptionSource: read.aiDrivesLoad ? read.aiPrescription!.source : undefined,
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

  const [{ phases: allPhases, sessionCounts }, lastLogs, lastRealOneRm, todayExercises, aiPeriodizationState, prMap, estimates, liftPreferences] = await Promise.all([
    // The phases and every session's count, in one query (#4050).
    isAutomatic ? repo.getProgramPhaseState(userId, program.id) : Promise.resolve(NO_PHASE_STATE),
    repo.getLastExerciseLogsBatch(userId, exerciseNames),
    repo.getLastRealOneRmBatch(userId, exerciseNames),
    repo.getDayExerciseNames(userId, todayStr.replace(/-/g, '/'), tz),
    // Reconcile first, then read: the stored counter feeds completedCycles /
    // phaseSessionNumber below and has drifted three times (SYNC-T2). Chained inside the
    // Promise.all so it still runs alongside the other five queries.
    isAiDynamic
      ? repo.reconcileSessionsInPhase(userId, program.id)
          .catch(() => {})
          .then(() => repo.getSessionPeriodization(userId, programSession.id))
          // #3890: in the applies-to week, the weekly check-in's shorter session (no model call).
          .then(state => state && fitStoredPlanToCheckinBudget(userId, programSession.id, repo, tz, state))
          // #3900 review (H): a plan left `pending` from before the AI plan applied every plan by itself.
          .then(state => state && adoptPendingAiPlan(userId, programSession.id, repo, tz, program, state, {
            // #3900 second review (2): a poll only reads; it never fires generation (`isPoll`).
            onRegenerate: isPoll ? undefined : () => regeneratePrescriptionInBackground(userId, programSession.id, repo, tz),
          }))
      : Promise.resolve(null),
    repo.listPersonalRecords(userId),
    repo.getExerciseEstimates(userId).catch(() => []),
    // #3896: the user's lift preferences, for a static style the AI plan is not driving, with this
    // week's check-in hold (#3890) in the same read.
    loadLiftPreferences(repo, userId, exerciseNames, { checkinWeekStart: startOfWeekInTz(tz) }),
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

  // Phase, baseline and a confirmed deload week: the one resolver the card and the `?tab=all` batch
  // call too (#4019). The pre-workout toggle (`aiDeload`) is this read's own input.
  const { currentPhase, phaseStatus: sessionPhaseStatus, isBaselinePhase } = resolveSessionPhase({
    program, todayStr, allPhases,
    thisSessionCount: sessionCounts.get(programSession.id) ?? 0,
    periodization: aiPeriodizationState,
    aiDeload,
  })

  // AI Dynamic: when a prescription is in effect (accepted/auto-applied, or a pending
  // "stay"), its per-exercise sets/reps/pct drive the loaded weights instead of the
  // static progression style. This is what makes the phase actually reach the bar.
  let aiPrescription = isAiDynamic && !isBaselinePhase && aiPeriodizationState?.prescription
    ? normalizeStoredPrescription(
        aiPeriodizationState.prescription, aiPeriodizationState.phase,
        new Map(programSession.exercises.map(ex => [ex.id, ex.exerciseRole])),
      )
    : null
  // Computed before the load decision: an aged-out prescription (#3700) is regenerating, so it is
  // not the plan. Serving it once more while the regeneration ran in the background put an expired
  // rest-day plan on the bar, and nothing repainted the screen when the fresh one landed.
  // #3876: an aligned program's deload ends at the program's cap, not the type's count, and the cap can
  // be reached with no new session. A failed read falls back to the type's count.
  const programDeload = isAiDynamic
    ? await readProgramDeloadCheck(repo, userId, program.id, aiPeriodizationState, tz).catch(() => null)
    : null
  // #3900 second review (1): while a workout of this type is under way (`isSessionUnderWay`, the one
  // definition generation uses), the plan it started with keeps driving the bar. It is not pending
  // after its expiry or deload count passes, it does not fall back to the base numbers, and nothing
  // regenerates it. A signal the person enters mid-workout (a sore, injury or sick check-in) still
  // lightens the remaining rows exactly as on main (third review, 3, the Orchestrator's call): only
  // time passing is held back, and a re-plan generation would refuse is done as a lightening instead.
  const underWay = isAiDynamic && aiPeriodizationState != null && slotHoldsPlan(aiPeriodizationState)
    ? await isSessionUnderWay(repo, userId, programSession.id)
    : false
  const aiPrescriptionPending = isAiPrescriptionPending(aiPeriodizationState, { isAiDynamic, isBaselinePhase, programDeload, underWay })
  const aiDrivesLoad = aiPrescription != null && aiPeriodizationState != null && !aiPrescriptionPending
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
      // #3764: the same split the full aggregation uses — an untouched suggestion changes no load.
      const { soreMusclesInSession, recentlyTrainedMusclesInSession } = sessionSoreness(moodLogToUse, sessionMuscleGroups)

      const reevalSignals: ReevaluationSignals = {
          soreMusclesInSession,
          recentlyTrainedMusclesInSession,
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
      }
      const reevalState = {
        phase: aiPeriodizationState.phase,
        prescription: aiPeriodizationState.prescription,
        prescriptionStatus: aiPeriodizationState.prescriptionStatus,
        prescriptionExpiresAt: aiPeriodizationState.prescriptionExpiresAt,
        sessionsInPhase: aiPeriodizationState.sessionsInPhase,
        programDeload,
        underWay,
      }
      let reevalResult = reevaluatePrescriptionForToday(aiPrescription, reevalSignals, reevalState)

      // Issue 2592: a deload or revert moved rows, so the stored minutes and volume pills describe
      // the old rows. Re-cost them through `prescriptionFigures` — the inputs it needs are loaded
      // only now, when a row actually moved, and a failed load keeps the stored figures (the rows
      // are still right; only the header would lag).
      if (!reevalResult.needsRegenerate && reevalResult.changed
        && rowNumbersMoved(aiPrescription.exercises, reevalResult.prescription.exercises)) {
        try {
          const figureSignals = await loadFigureSignals(repo, userId, programSession)
          reevalResult = reevaluatePrescriptionForToday(aiPrescription, reevalSignals, reevalState, new Date(), figureSignals)
        } catch (err) {
          reportServerError(err, { userId, url: '/api/workout-data#recost' })
        }
      }

      if (reevalResult.needsRegenerate) {
        regeneratePrescriptionInBackground(userId, programSession.id, repo, tz)
      } else {
        // #3890: the re-evaluation runs after the serve step held the plan, and its revert puts a
        // deloaded row's pre-deload (unheld) load back. Hold the result again, from the preferences
        // already read, so neither this response nor the cached plan carries a held lift above its bar.
        const reheld = rehold(reevalResult.prescription, aiPeriodizationState.phase, startOfWeekInTz(tz), liftPreferences, name => {
          const lib = libByName.get(name.toLowerCase())
          return {
            basisKg: resolveWorkingBasis({
              lastNonDeload1rm: lastRealOneRm.get(name)?.estimated1rm,
              seedEstimate: estimateMap.get(name),
              allTimePr1rm: prMap.get(name),
            }),
            equipment: lib?.equipment ?? [],
            bodyweight: lib?.exerciseType === 'bodyweight',
          }
        })
        const stamped: AiPrescription = { ...reheld, reevaluatedInputsKey: inputsKey }
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
  if (aiPrescriptionPending && !isPoll) {
    regeneratePrescriptionInBackground(userId, programSession.id, repo, tz)
  }
  const aiPhaseLabel = aiPrescription ? capitalize(aiPrescription.phase) : ''

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
    liftPreferences,
  });

  // #2110: which engine built the numbers the bar carries, so the screen can say when they are the
  // program's own (`'rules'`, the model could not be reached) rather than a coached plan. Only
  // while the prescription drives load — one that does not is not what `exercises` shows.
  const prescriptionSource = aiDrivesLoad ? aiPrescription!.source : undefined

  return NextResponse.json({ exercises, program, session: programSession, phaseStatus: sessionPhaseStatus, dataDate: todayStr, aiPrescriptionPending, prescriptionSource }, { headers: cacheHeaders });
}
