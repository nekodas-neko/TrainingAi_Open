"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import type { WorkoutExercise, PhaseStatus } from "@/app/api/workout-data/route";
import { PreWorkoutScreen } from "@/components/workout/pre-workout-screen";
import { WarmupScreen } from "@/components/workout/warmup-screen";
import { transitionSecForEquipment } from "@trainingai/shared/workout/duration-model";
import { ActiveWorkoutScreen } from "@/components/workout/active-workout-screen";
import { ExerciseSummaryScreen } from "@/components/workout/exercise-summary-screen";
import { PipView } from "@/components/workout/pip-view";
import { usePipMode } from "@/hooks/use-pip-mode";
import { usePipActions } from "@/hooks/use-pip-actions";
import {
  DEFAULT_SETS,
  DEFAULT_REPS,
  mroundStep,
  mroundStepUp,
  weightStepFor,
  defaultRpeFromPct,
  applyDeloadReverts,
  exerciseSetCount,
} from "@/components/workout/utils";
import { estimateOneRm } from "@trainingai/shared/1rm";
import type { ExerciseSummaryData, SessionLogEntry } from "@/components/workout/types";
import { buildSetSequence, nextStep } from "@trainingai/shared/workout/superset-order";
import { exerciseLibraryRowsFrom } from '@/lib/local-store/program-assembler';
import { getLocalStore } from "@/lib/local-store/index";
import { pullDelta } from "@/lib/local-store/sync-engine";
import { todayInTz, toAestDateStr, nowDatetimeInTz } from "@trainingai/shared/date-utils";
import { useWorkoutStore, effectiveRestSec } from "@/lib/stores/workout-store";
import { useShallow } from "zustand/react/shallow";
import { cachedFetch, readCacheSync, setCached, isWorkoutDataToday } from "@/lib/sqlite/cache";
import { useUserTimezone } from '@/components/shell/user-timezone-provider';
import { useDeloadChoice } from "@/components/workout/use-deload-choice";
import { useDurationPreset } from "@/components/workout/use-duration-preset";
import { WorkoutLoadError } from "@/components/workout/workout-load-error";
import { TTL_SHORT, TTL_MEDIUM, TTL_LONG } from '@trainingai/shared/cache-ttl';
import { invalidateWorkoutSummaries, invalidateExerciseLogged, invalidatePrescriptionChanged, invalidateWorkoutDataImmediate } from "@/lib/cache-groups";
import type { DurationPreset } from "@trainingai/shared/workout/duration-model";
import { hapticLight, hapticSuccess } from "@/lib/haptics";
import { scheduleRestCompleteNotification, cancelRestCompleteNotification, computeRestNotificationAction } from "@/lib/notifications";
import { startRestChip, stopRestChip } from "@/lib/native/rest-timer-chip";
import { getLiveHrManager } from "@/lib/live-hr/manager";
import { setTraceExercise, recordTraceSample, recordTraceBoundary } from "@/lib/live-hr/exercise-trace";
import { cancelWorkoutReminder } from "@/lib/workout-reminders";
import type { Injury } from "@trainingai/shared/types/injury";
import type { ExerciseLibraryEntry } from "@trainingai/shared/types/program";
import { InjurySwapSheet } from "@/components/workout/injury-swap-sheet";
import type { SessionPeriodization, AiPrescription, PrescriptionStatus } from "@trainingai/shared/types/ai-periodization";

const DoneScreen = dynamic(() => import("@/components/workout/done-screen").then(m => m.DoneScreen), { ssr: false });

// While a fresh AI prescription is regenerating, poll workout-data so the AI numbers appear
// as soon as they land. Bounded: ~8 tries × 3s ≈ 24s, after which a failed/slow generation
// falls back to the base-program numbers instead of blocking the workout forever.
const PRESCRIPTION_POLL_INTERVAL_MS = 3000;
const PRESCRIPTION_POLL_MAX = 10;

// Shared per-set weight derivation — used at init (launchExercise, the per-set-weights
// effect) and after an injury swap, so all three paths agree on how a set's target
// weight is picked. One Formula, One Place.
function computeInitialWeights(ex: WorkoutExercise | undefined, sets: number): number[] {
  if (ex?.exerciseType === "bodyweight") {
    return Array.from({ length: sets }, () => 0);
  }
  const step = weightStepFor(ex?.equipment);
  return Array.from({ length: sets }, (_, i) => {
    if (ex?.progressionStyle && ex?.estimated1rm) {
      const sc = ex.progressionStyle[i];
      if (sc) return mroundStepUp(ex.estimated1rm * sc.pct / 100, step);
    }
    if (ex?.target80 != null) return mroundStep(ex.target80, step);
    // Fallback for old logs that predate the target_80 column: derive from 1RM or last weight
    if (ex?.estimated1rm) return mroundStepUp(ex.estimated1rm * 0.8, step);
    if (ex?.latestWeight != null) return mroundStep(ex.latestWeight, step);
    return 60;
  });
}

function playBeep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
    osc.onended = () => ctx.close();
  } catch { /* AudioContext unavailable */ }
}

interface WorkoutScreenProps {
  sessionType: string;
  userId?: string;
  aiDeload?: boolean;
  wasOverride?: boolean;
}

export default function WorkoutScreen({ sessionType, userId, aiDeload, wasOverride }: WorkoutScreenProps) {
  const tz = useUserTimezone();
  const { deload, setDeload, recommended: deloadRecommended } = useDeloadChoice(!!aiDeload);
  // Subscribe with a shallow selector picking exactly the members used below, so
  // the orchestrator only re-renders when one of these changes — not on every
  // unrelated store mutation. Actions have stable identity (no re-render cost).
  const store = useWorkoutStore(
    useShallow((s) => ({
      // state
      accumulatedRestMs: s.accumulatedRestMs,
      currentIdx: s.currentIdx,
      currentSet: s.currentSet,
      exerciseStartMs: s.exerciseStartMs,
      lapStartMs: s.lapStartMs,
      lastExerciseEndMs: s.lastExerciseEndMs,
      mode: s.mode,
      restStartMs: s.restStartMs,
      lastSetRestStartMs: s.lastSetRestStartMs,
      sessionLog: s.sessionLog,
      sessionType: s.sessionType,
      setEndMsArray: s.setEndMsArray,
      sets: s.sets,
      setStartMsArray: s.setStartMsArray,
      soloMode: s.soloMode,
      summaryData: s.summaryData,
      timerStarted: s.timerStarted,
      readyElapsedBaselineSec: s.readyElapsedBaselineSec,
      todayLogged: s.todayLogged,
      revertedDeloads: s.revertedDeloads,
      workoutEndMs: s.workoutEndMs,
      warmupEndedMs: s.warmupEndedMs,
      workoutPhase: s.workoutPhase,
      workoutSessionId: s.workoutSessionId,
      workoutStartMs: s.workoutStartMs,
      lastSetRestSec: s.lastSetRestSec,
      newPRs: s.newPRs,
      xpEarned: s.xpEarned,
      // actions (stable references)
      addAccumulatedRestMs: s.addAccumulatedRestMs,
      addTodayLogged: s.addTodayLogged,
      toggleDeloadRevert: s.toggleDeloadRevert,
      appendLapTime: s.appendLapTime,
      appendRestTime: s.appendRestTime,
      appendSessionLog: s.appendSessionLog,
      appendSetEndMs: s.appendSetEndMs,
      appendSetStartMs: s.appendSetStartMs,
      appendSetWeight: s.appendSetWeight,
      clearLapTimes: s.clearLapTimes,
      clearRestTimes: s.clearRestTimes,
      clearSetTimingArrays: s.clearSetTimingArrays,
      clearSetWeights: s.clearSetWeights,
      clearTodayLogged: s.clearTodayLogged,
      resetSession: s.resetSession,
      setAccumulatedRestMs: s.setAccumulatedRestMs,
      setCurrentIdx: s.setCurrentIdx,
      setCurrentSet: s.setCurrentSet,
      setMode: s.setMode,
      setPerSetWeights: s.setPerSetWeights,
      setReps: s.setReps,
      setSets: s.setSets,
      setSoloMode: s.setSoloMode,
      setSummaryData: s.setSummaryData,
      setTimerStarted: s.setTimerStarted,
      setTimestamps: s.setTimestamps,
      setReadyElapsedBaselineSec: s.setReadyElapsedBaselineSec,
      setWorkoutPhase: s.setWorkoutPhase,
      startWorkout: s.startWorkout,
      updatePerSetWeight: s.updatePerSetWeight,
      initRpeValues: s.initRpeValues,
      setRpeValue: s.setRpeValue,
      commitExerciseSummary: s.commitExerciseSummary,
      setLastSetRestSec: s.setLastSetRestSec,
      clearExerciseBuffers: s.clearExerciseBuffers,
      addNewPR: s.addNewPR,
      setXpEarned: s.setXpEarned,
    }))
  );
  const isPip = usePipMode();

  // Non-persisted UI state
  const [exercises, setExercises] = useState<WorkoutExercise[]>([]);
  const [phaseStatus, setPhaseStatus] = useState<PhaseStatus | null>(null);
  const [sessionDisplayName, setSessionDisplayName] = useState<string>("");
  const [programSessionId, setProgramSessionId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  // K2: terminal error state for the primary load — an infinite skeleton (the old
  // behaviour when /api/workout-data 500s on a cold cache) is a bug. Only set when
  // nothing painted from cache or the local mirror; stale/seeded data beats an error.
  const [loadError, setLoadError] = useState(false);
  const [loggedCount, setLoggedCount] = useState(0);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarAdded, setCalendarAdded] = useState(false);
  const [phaseCompletionBanner, setPhaseCompletionBanner] = useState<{ from: string; to: string } | null>(null);
  const [activeInjuries, setActiveInjuries] = useState<Injury[]>([]);
  const [injurySwapTarget, setInjurySwapTarget] = useState<{ exerciseIndex: number; injuredMuscles: string[] } | null>(null);
  const [programPhaseMode, setProgramPhaseMode] = useState<string | null>(null);
  // A fresh AI prescription is regenerating (workout-data's aiPrescriptionPending). While
  // true the pre-workout screen shows a "preparing" state instead of the base-program
  // numbers the AI is about to replace. prescriptionGenTimedOut trips after a bounded poll
  // so a failed/slow generation falls back to the base numbers rather than hanging forever.
  // Set when /api/workout-data reports the navigated session id is stale (offline mirror out
  // of sync). We force an id-based re-sync and prompt the user to reselect — a dead id is
  // never silently remapped to another session by name.
  const [sessionStale, setSessionStale] = useState(false);
  const [aiPrescriptionPending, setAiPrescriptionPending] = useState(false);
  // The session's configured budget, for the picker's "Standard" sublabel.
  const [sessionBudgetMin, setSessionBudgetMin] = useState<number | undefined>(undefined);
  const [prescriptionGenTimedOut, setPrescriptionGenTimedOut] = useState(false);
  const [prescriptionPollAttempt, setPrescriptionPollAttempt] = useState(0);
  const [periodization, setPeriodization] = useState<{
    state: SessionPeriodization;
    signals: { exercises: Array<{ sessionExerciseId: string; name: string; current1rm: number | null; role: string; rm1Trend: 'up' | 'flat' | 'down'; rm1ChangeKg: number }> };
  } | null>(null);
  const [periodizationLoading, setPeriodizationLoading] = useState(false);
  // Guards the stale-session-id self-heal (below) against a loop: records the id we've already
  // tried to re-resolve after an AI 404, so we re-resolve each dead id at most once.
  const staleSessionIdRecoveredRef = useRef<string | null>(null);
  // Guards the client-side prescription trigger (below): the session id we've already fired
  // generation for this pending episode, so we fire /prescribe at most once per episode.
  const prescribeFiredForRef = useRef<string | null>(null);
  // Monotonic id so an out-of-order periodization fetch response can't overwrite a newer one
  // (loadPeriodization is now callable imperatively, not just from a single effect).
  const periodizationReqRef = useRef(0);
  // Bar-load / prep seconds for the current exercise: time on the "get ready" screen before the
  // first Start (loading the bar / setting up). Captured at handleStart from the ready-screen
  // elapsed baseline, read into the log payload at completion. A ref (not store) — transient and
  // per-exercise; a mid-exercise app remount simply drops it (prep is a nice-to-have).
  const prepSecRef = useRef<number | null>(null);
  const sessionKey = programSessionId ?? sessionType.toLowerCase();
  const effectiveExercises = useMemo(
    () => applyDeloadReverts(exercises, store.revertedDeloads[sessionKey] ?? []),
    [exercises, store.revertedDeloads, sessionKey],
  );
  // Full set-by-set order for the session, honoring supersetGroup alternation.
  // AI-dynamic programs already arrive with supersetGroup nulled (workout-data
  // route), so this degenerates to plain per-exercise order for them.
  const sequence = useMemo(
    () => buildSetSequence(effectiveExercises.map((ex) => ({
      supersetGroup: ex.supersetGroup ?? null,
      setCount: exerciseSetCount(ex),
    }))),
    [effectiveExercises],
  );
  const xpBeforeWorkout = useRef<number | undefined>(undefined);
  const phaseAtWorkoutStart = useRef<PhaseStatus | null>(null);
  const isCompletingRef = useRef(false);
  // Shared guard for handleLogCurrentSet/handleCompleteSet — a double/rapid tap on
  // Log Set or Complete would otherwise mint a fresh clientExerciseLogId per call,
  // which the server's replay-detection can't dedupe against (session-86: 5 rapid
  // taps once fired 4 complete-workout POSTs). One shared ref since the two
  // handlers can interleave (log last set → complete).
  const isLoggingRef = useRef(false);
  // Set true right before a currentIdx change driven by restoreExercise() — the
  // restored perSetWeights/etc are already correct and must not be clobbered by
  // the per-set-weight init effect that normally recomputes on every currentIdx change.
  const skipPerSetWeightsInitRef = useRef(false);

  // Capture XP before workout starts from the sync cache — avoids a live achievements
  // fetch (3 heavy aggregate queries) just to compute the post-workout XP delta.
  // One-time read, not a render-body cache read — this orchestrator re-renders on
  // every store update, and readCacheSync must never live in that path.
  useEffect(() => {
    const cachedXp = readCacheSync<{ xp?: number }>(`achievements:${userId}`);
    if (cachedXp?.xp != null && xpBeforeWorkout.current === undefined) {
      xpBeforeWorkout.current = cachedXp.xp;
    }
  }, [userId]);

  // Q-126: `achievements:<userId>` is written by exactly one screen (More → Profile) but cleared
  // by five invalidation groups, so the seed is often absent — logging a meal before finishing a
  // workout was enough. Defaulting the baseline to 0 then reported the user's entire lifetime XP
  // as this session's gain. With no baseline the badge is skipped instead (done-screen already
  // hides it when xpEarned is null), and the response is written back so the next session has one.
  const recordXpEarned = useCallback(() => {
    const xpBefore = xpBeforeWorkout.current;
    fetch('/api/achievements')
      .then(r => r.ok ? r.json() : null)
      .then((d: { xp?: number } | null) => {
        if (d?.xp == null) return;
        setCached(`achievements:${userId}`, d, TTL_SHORT).catch(() => {});
        if (xpBefore === undefined) return;
        store.setXpEarned(Math.max(0, d.xp - xpBefore));
      })
      .catch(() => {});
  }, [userId, store]);

  // Resolve the program session id synchronously (before paint) from the same cache seed
  // fetchExercises reads, so todayLoggedKey matches the id completions were written under —
  // otherwise the first painted frame keys by the session-name fallback and prior
  // completions flash unmarked on every open/finish (UB7). Cheap: one sessionStorage read.
  useLayoutEffect(() => {
    if (programSessionId) return;
    const tab = sessionType.toLowerCase();
    const cacheKey = `workout-data:${tab}${deload ? ':deload' : ''}`;
    const seed =
      readCacheSync<{ session?: { id: string } }>(cacheKey) ??
      (!deload ? readCacheSync<{ session?: { id: string } }>(`workout-card:${sessionType}`) : null);
    if (seed?.session?.id) setProgramSessionId(seed.session.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionType, deload]);

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchExercises = useCallback(async (opts?: { poll?: boolean }) => {
    const tab = sessionType.toLowerCase();
    // Deload gets its own cache key — regular cached sets must never flash before AMRAP sets load
    const cacheKey = `workout-data:${tab}${deload ? ':deload' : ''}`;
    setLoadError(false);
    // Tracks whether the on-device mirror painted anything, so a subsequent fetch
    // failure only escalates to the K2 error screen when the screen is truly blank.
    let localSeeded = false;

    type WorkoutDataSeed = { dataDate?: string; exercises: WorkoutExercise[]; session?: { id: string; name: string; timeBudgetMinutes?: number }; phaseStatus?: PhaseStatus; program?: { phaseMode?: string }; aiPrescriptionPending?: boolean; sessionNotFound?: boolean };

    // workout-data/workout-card is a date-less, 6h-TTL cache — a payload built before
    // midnight can still be served after it. loggedTodayInSession is only meaningful
    // for the day it was computed, so a stale-dated payload has it stripped here, at
    // the single point every downstream consumer (this screen + pre-workout-screen +
    // done-screen, all reading the same `exercises` state) derives from.
    const freshExercises = (data: WorkoutDataSeed): WorkoutExercise[] =>
      isWorkoutDataToday(data, tz)
        ? (data.exercises ?? [])
        : (data.exercises ?? []).map(ex => ({ ...ex, loggedTodayInSession: false }));

    // Synchronous read for immediate paint from sessionStorage mirror
    const synced = readCacheSync<WorkoutDataSeed>(cacheKey);
    // Home/workout-select prefetch each session's card into `workout-card:<id>` (same
    // /api/workout-data response shape) before this screen ever opens — reuse it for
    // an instant paint when this screen's own cache hasn't been written yet. Deload
    // never seeds from it: regular cached sets must never flash before AMRAP sets load.
    const cardSeed = !synced && !deload
      ? readCacheSync<WorkoutDataSeed>(`workout-card:${sessionType}`)
      : null;
    if (synced) {
      setExercises(freshExercises(synced));
      setPhaseStatus(synced.phaseStatus ?? null);
      if (synced.session?.name) setSessionDisplayName(synced.session.name);
      if (synced.session?.id) setProgramSessionId(synced.session.id);
      if (synced.session?.timeBudgetMinutes) setSessionBudgetMin(synced.session.timeBudgetMinutes);
      if (synced.program?.phaseMode) setProgramPhaseMode(synced.program.phaseMode);
      setLoading(false);
    } else if (cardSeed) {
      setExercises(freshExercises(cardSeed));
      setPhaseStatus(cardSeed.phaseStatus ?? null);
      if (cardSeed.session?.name) setSessionDisplayName(cardSeed.session.name);
      if (cardSeed.session?.id) setProgramSessionId(cardSeed.session.id);
      if (cardSeed.session?.timeBudgetMinutes) setSessionBudgetMin(cardSeed.session.timeBudgetMinutes);
      if (cardSeed.program?.phaseMode) setProgramPhaseMode(cardSeed.program.phaseMode);
      setLoading(false);
    } else {
      setLoading(true);
      // No cache yet — seed structure (sessions, exercises, per-set progression)
      // from the on-device SQLite mirror so the screen paints offline. The network
      // response below overwrites this with the full, server-computed data.
      const localStore = userId ? getLocalStore(userId) : null;
      if (localStore) {
        try {
          const local = await localStore.getActiveProgramLocal();
          // E1-5/R-2: resolve strictly by id — mirror the server's id-only identity
          // (c2bd70f/v1.171.0 removed exactly the name/sessions[0] fallback there).
          // Painting sessions[0] for a stale nav id silently attributed logged sets
          // to the wrong session.
          const sess = local?.sessions.find(s => s.id === tab);
          if (local && sess) {
            setExercises(sess.exercises);
            setSessionDisplayName(sess.name);
            setProgramSessionId(sess.id);
            setProgramPhaseMode(local.phaseMode);
            setLoading(false);
            localSeeded = true;
          } else if (local && !sess && typeof navigator !== 'undefined' && !navigator.onLine) {
            // Offline + id absent from the mirror: no network response will arrive to
            // run the sessionNotFound guard below, so surface the reselect state here
            // instead of painting another session. Online, we fall through and let the
            // authoritative server fetch decide (it returns sessionNotFound).
            setSessionStale(true);
            setLoading(false);
          }
        } catch { /* fall through to network fetch */ }
      }
    }

    try {
      const wdParams = new URLSearchParams({ tab })
      if (deload) wdParams.set('aiDeload', '1')
      // A poll only checks whether the regenerating prescription has landed — it must NOT
      // re-fire generation, or the ~3s cadence bursts /prescribe (Gemini) and rate-limits itself.
      if (opts?.poll) wdParams.set('poll', '1')
      // TTL_LONG: explicit invalidation on program changes handles staleness. Written inline
      // rather than via a local alias — the other workout-data: read passes TTL_LONG directly,
      // and one key may only carry one TTL expression.
      await cachedFetch<WorkoutDataSeed>(
        cacheKey,
        `/api/workout-data?${wdParams}`,
        TTL_LONG,
        (data) => {
          // Stale nav id: the server has no session with this id (offline mirror out of sync
          // after a program edit). Don't paint a wrong/empty session — force an id-based full
          // mirror re-sync so navigation ids become current, and flag for a reselect prompt.
          if (data.sessionNotFound) {
            setSessionStale(true);
            setLoading(false);
            if (userId) pullDelta(userId, true, true).catch(() => {});
            return;
          }
          setSessionStale(false);
          setExercises(freshExercises(data));
          // Teach the on-device mirror what this response knows about each exercise, so the
          // next offline read can type a bodyweight movement as reps instead of kg (Q-20).
          // Fire-and-forget: a failed mirror write must never affect the painted screen.
          if (userId && data.exercises?.length) {
            const store = getLocalStore(userId);
            if (store) {
              store.upsertExerciseLibrary(
                exerciseLibraryRowsFrom(data.exercises, new Date().toISOString()),
              ).catch(() => {});
            }
          }
          setPhaseStatus(data.phaseStatus ?? null);
          if (data.session?.name) setSessionDisplayName(data.session.name);
          if (data.session?.id) setProgramSessionId(data.session.id);
          if (data.session?.timeBudgetMinutes) setSessionBudgetMin(data.session.timeBudgetMinutes);
          if (data.program?.phaseMode) setProgramPhaseMode(data.program.phaseMode);
          // Only the authoritative network payload carries the pending flag — a
          // possibly-stale cache seed must not gate the screen, so it's read here, not
          // from the seed. Any non-pending payload clears a prior pending state.
          setAiPrescriptionPending(data.aiPrescriptionPending ?? false);
          setLoading(false);
        },
        {
          // K2: cachedFetch never rejects, so the old catch below was dead code and
          // a cold-cache 500 hung the screen on an infinite skeleton. Surface a
          // terminal error-with-retry only when nothing painted (no cache seed, no
          // local mirror). navigator.onLine already gates this in cachedFetchCore,
          // so offline stays the offline pill, not an error.
          onError: () => {
            if (!synced && !cardSeed && !localSeeded) {
              setLoadError(true);
              setLoading(false);
            }
          },
        },
      );
    } catch {
      // Reachable only on a pathological synchronous throw; the onError channel
      // handles the normal HTTP/network failure path above.
      if (!synced && !cardSeed && !localSeeded) { setLoadError(true); setLoading(false); }
    }
  }, [sessionType, deload, userId, tz]);

  // Fetch the session's AI-periodization state (drives the AI Prescription card). Callable
  // imperatively so it can re-run the moment a fresh prescription is generated — otherwise the
  // card stayed frozen at the pre-generation state until the whole screen remounted (an app
  // close/reopen), even though the exercise weights had already refreshed via the poll.
  // `afterWrite` bypasses the browser's HTTP cache. The route USED to ship
  // `Cache-Control: private, max-age=60`, so a refetch fired straight after a mutation
  // (accept, dismiss, transition, duration switch) was answered from that 60s window with
  // the PRE-mutation state — the card repainted the old prescription even though the write
  // had landed. Q-166 took every API route to `private, no-store`, so this is belt-and-braces
  // now rather than the fix; it stays because the cost is nil and headers can come back.
  // Ordinary loads keep the cache — this route runs the full signal aggregation.
  const loadPeriodization = useCallback((opts?: { afterWrite?: boolean }) => {
    if (!programSessionId || programPhaseMode !== 'ai_dynamic') return;
    const reqId = ++periodizationReqRef.current;
    type PeriodizationResponse = {
      state: SessionPeriodization;
      signals: { exercises: Array<{ sessionExerciseId: string; name: string; current1rm: number | null; role: string; rm1Trend: 'up' | 'flat' | 'down'; rm1ChangeKg: number }> };
    };
    const cacheKey = `ai-periodization-session:${programSessionId}`;
    // Instant paint from the last-known state, then revalidate.
    const seed = readCacheSync<PeriodizationResponse>(cacheKey);
    if (seed) setPeriodization(seed);
    setPeriodizationLoading(true);
    fetch(`/api/ai-periodization/session/${programSessionId}`, opts?.afterWrite ? { cache: 'no-store' } : undefined)
      .then(async (res) => {
        if (reqId !== periodizationReqRef.current) return; // superseded by a newer request
        if (res.ok) {
          const d = await res.json() as PeriodizationResponse;
          setPeriodization(d);
          setCached(cacheKey, d, TTL_MEDIUM);
        } else if (res.status === 404 && staleSessionIdRecoveredRef.current !== programSessionId) {
          // Stranded session id: the on-device program mirror is out of sync after an edit,
          // so we're asking the AI engine about a session it no longer has. Force an id-based
          // full re-sync of the mirror from server truth (never resolve by name) so the app's
          // current program — and every session id it navigates with — becomes correct again.
          // Guarded so each dead id triggers at most one re-sync (no loop).
          staleSessionIdRecoveredRef.current = programSessionId;
          if (userId) pullDelta(userId, true, true).catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => { if (reqId === periodizationReqRef.current) setPeriodizationLoading(false); });
  }, [programSessionId, programPhaseMode, userId]);

  const { warmupGoalSec, durationSwitching, handleDurationPresetChange } = useDurationPreset({
    programSessionId,
    sessionBudgetMin,
    durationPreset: periodization?.state.prescription?.durationPreset,
    fetchExercises,
    loadPeriodization,
  });

  const refreshExercises = useCallback(() => {
    invalidatePrescriptionChanged(programSessionId).catch(() => {});
    // Let a manual refresh re-trigger client-side generation (clear the once-per-episode guard).
    prescribeFiredForRef.current = null;
    fetchExercises();
    loadPeriodization({ afterWrite: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionType, fetchExercises, programSessionId, loadPeriodization]);

  // Poll while a fresh prescription is regenerating (pre-workout screen only), so the AI
  // numbers swap in the moment they land. Bounded — on timeout we reveal the base numbers.
  // Attempt count is state (not a ref) so each tick re-runs this effect to schedule the next.
  useEffect(() => {
    if (!aiPrescriptionPending || store.mode !== "pre") {
      if (prescriptionPollAttempt !== 0) setPrescriptionPollAttempt(0);
      if (prescriptionGenTimedOut) setPrescriptionGenTimedOut(false);
      return;
    }
    if (prescriptionGenTimedOut) return;
    if (prescriptionPollAttempt >= PRESCRIPTION_POLL_MAX) {
      setPrescriptionGenTimedOut(true);
      return;
    }
    const t = setTimeout(() => {
      setPrescriptionPollAttempt(a => a + 1);
      // poll: read whether the (already-firing) generation landed — never re-trigger it.
      fetchExercises({ poll: true });
      // Also refetch the periodization card every tick: the prescription can exist server-side
      // before workout-data's aiPrescriptionPending flag flips, so refreshing only on the flag
      // transition could leave the "AI Prescription · Auto-applied" card missing until reopen.
      // afterWrite — a poll exists precisely to observe a write, so it must not be answered
      // from the route's 60s HTTP cache (the whole poll window would serve the pre-write state).
      loadPeriodization({ afterWrite: true });
    }, PRESCRIPTION_POLL_INTERVAL_MS);
    return () => clearTimeout(t);
  }, [aiPrescriptionPending, store.mode, prescriptionGenTimedOut, prescriptionPollAttempt, fetchExercises, loadPeriodization]);

  // Trigger prescription generation directly from the client when a fresh one is pending.
  // /api/workout-data also fires this as a server-side fire-and-forget self-fetch, but that
  // container→own-origin hop is unreliable in some prod networking (it silently never reaches
  // /prescribe, so generation was stuck at "couldn't generate" every session). A direct client
  // POST always reaches the server and is observable in logs. Fired once per pending episode
  // (the ref resets when pending clears), so retries/polls don't burn the route's hourly limit.
  useEffect(() => {
    if (!aiPrescriptionPending) { prescribeFiredForRef.current = null; return; }
    if (store.mode !== "pre" || !programSessionId) return;
    if (prescribeFiredForRef.current === programSessionId) return;
    prescribeFiredForRef.current = programSessionId;
    fetch(`/api/ai-periodization/session/${programSessionId}/prescribe`, { method: "POST" })
      .then((res) => {
        // Generation is synchronous here — on success the prescription now exists server-side.
        // Refresh both the base weights (poll) AND the periodization card, so a freshly-generated
        // prescription appears immediately instead of only after an app reopen.
        if (res.ok) {
          // Every other trigger site invalidates the group; this one never did, so a
          // prescription generated here (including one that auto-applied a phase transition)
          // left session-select and the done screen repainting pre-transition state from cache.
          invalidatePrescriptionChanged(programSessionId).catch(() => {});
          fetchExercises({ poll: true });
          loadPeriodization({ afterWrite: true });
        }
      })
      .catch(() => {});
  }, [aiPrescriptionPending, store.mode, programSessionId, fetchExercises, loadPeriodization]);

  useEffect(() => { fetchExercises(); }, [fetchExercises]);

  useEffect(() => {
    const loadFromApi = () =>
      cachedFetch<Injury[]>('injuries', '/api/injuries', TTL_MEDIUM,
        d => setActiveInjuries((Array.isArray(d) ? d : []).filter((i: Injury) => !i.resolvedDate)),
      ).catch(() => {});
    // Local-first: the on-device store is the source of truth (includes an
    // injury logged offline that hasn't synced yet). Fall back to the API when
    // the store is unavailable or hasn't hydrated any injuries yet.
    const store = userId ? getLocalStore(userId) : null;
    if (!store) { loadFromApi(); return; }
    store.getInjuries().then(injs => {
      const active = injs.filter(i => !i.resolvedDate && !i.deletedAt);
      if (injs.length === 0) { loadFromApi(); return; }
      setActiveInjuries(active.map(i => ({
        id: i.id, userId: userId!, muscleName: i.muscleName, notes: i.notes,
        severity: i.severity, startedDate: i.startedDate,
        resolvedDate: i.resolvedDate, createdAt: i.createdAt, updatedAt: i.updatedAt,
      })));
    }).catch(loadFromApi);
  }, [userId]);

  useEffect(() => { loadPeriodization(); }, [loadPeriodization]);

  // When a regenerating prescription lands (aiPrescriptionPending true→false), refresh the
  // periodization card too — not just the base-weight numbers the poll already refetches.
  const prevPendingRef = useRef(false);
  useEffect(() => {
    if (prevPendingRef.current && !aiPrescriptionPending) loadPeriodization({ afterWrite: true });
    prevPendingRef.current = aiPrescriptionPending;
  }, [aiPrescriptionPending, loadPeriodization]);

  // Reset stale persisted state when mounting a different session or a completed one.
  // Deliberately only depends on `sessionType` (effectively mount-only) — `store` changes
  // on every state mutation, and including it here would re-fire this effect the moment
  // `mode` flips to "done" at the end of a workout, immediately resetting back to "pre"
  // and re-showing the pre-workout screen before the done screen can be seen.
  useEffect(() => {
    if (store.mode === "done" || (store.sessionType && store.sessionType !== sessionType)) {
      store.resetSession();
      isCompletingRef.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionType]);

  // Backstop for isLoggingRef: once the terminal state of a log/complete action is
  // reached (rest phase for a per-set log, exercise-summary mode for a completion),
  // a stuck ref can never wedge a future tap — the handlers themselves already reset
  // it inline, this just guarantees a re-entry after the state transition can't be
  // blocked by a ref that somehow didn't clear.
  useEffect(() => {
    isLoggingRef.current = false;
  }, [store.mode, store.workoutPhase]);

  // Warn browser if user tries to close/refresh mid-workout
  useEffect(() => {
    if (!store.workoutStartMs || store.mode === "pre") return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [store.workoutStartMs, store.mode]);

  // ── Rest timer beep ───────────────────────────────────────────────────────

  // Sourced from the just-logged set's own restSec (lib/stores/workout-store.ts),
  // not derived from the currently-active exercise/set index — during a superset,
  // currentIdx may already point at the *other* group member by the time this
  // rest period is showing. Anchored on lastSetRestStartMs (TMR-1), not the
  // per-exercise buffered restStartMs — the latter gets clobbered by
  // switchToExercise/restoreExercise on superset handoff, which previously
  // silenced the beep/notification entirely for the exercise that was just logged.
  const currentRestSec = effectiveRestSec(store.lastSetRestSec);

  useEffect(() => {
    if (store.workoutPhase !== "rest" || store.lastSetRestStartMs === null) return;
    const delayMs = store.lastSetRestStartMs + currentRestSec * 1000 - Date.now();
    if (delayMs <= 0) return; // rest already over when (re)mounted — notification path covers it
    const id = setTimeout(() => { playBeep(); hapticSuccess(); }, delayMs);
    return () => clearTimeout(id);
  }, [store.workoutPhase, currentRestSec, store.lastSetRestStartMs]);

  // ── Rest timer notification (fires even if the app is backgrounded) ───────

  useEffect(() => {
    const action = computeRestNotificationAction(store.workoutPhase, store.lastSetRestStartMs, currentRestSec, store.currentSet);
    if (action.action === 'schedule') {
      scheduleRestCompleteNotification(action.delayMs, action.setNumber);
    } else {
      cancelRestCompleteNotification();
    }
  }, [store.workoutPhase, store.lastSetRestStartMs, currentRestSec, store.currentSet]);

  // ── Rest timer status-bar chip (Android 16 Now Bar) ──────────────────────
  // A promoted ongoing notification whose status-bar pill ticks the rest
  // countdown down while the app is backgrounded; tapping it reopens the
  // workout. Anchored on the same lastSetRestStartMs the on-screen ring uses so
  // the two never drift, and the OS renders the chronometer itself (nothing
  // ticks from the throttled WebView). Auto-clears at the rest boundary
  // (setTimeoutAfter, native) or early when the next set starts. No-op off-device.
  const restChipLabel = effectiveExercises[store.currentIdx]?.name ?? sessionDisplayName ?? "Workout";

  useEffect(() => {
    // Green "prep" pill: the initial whole-workout warm-up, and the pre-set
    // get-ready / bar-load screen (active but the set timer hasn't started). Anchored to
    // a FUTURE finish so the chip counts DOWN to the same target the on-screen bar shows
    // (then the native side flips it to green count-up if the prep runs long).
    if (store.mode === "warmup" && store.workoutStartMs != null) {
      // Count down to the same warm-up goal the on-screen bar shows — this was anchored to the
      // flat constant while the bar is now session-scaled, which would have put the notification
      // chip and the screen on different clocks (Q-212).
      startRestChip(store.workoutStartMs + warmupGoalSec * 1000, "Warm-up", "warmup");
      return () => stopRestChip();
    }
    if (store.mode === "active") {
      if (!store.timerStarted && store.workoutStartMs != null) {
        // Anchor the ramp start at when the get-ready period began, not now, so a
        // background→foreground remount doesn't reset the countdown.
        const rampStart =
          store.readyElapsedBaselineSec != null
            ? store.workoutStartMs + store.readyElapsedBaselineSec * 1000
            : Date.now();
        // Count down to the equipment-appropriate bar-load target (barbell 240s /
        // standard 120s / bodyweight 60s) — the same total the on-screen ready bar uses.
        const prepSec = transitionSecForEquipment(effectiveExercises[store.currentIdx]?.equipment);
        startRestChip(rampStart + prepSec * 1000, restChipLabel, "warmup");
        return () => stopRestChip();
      }
      // Blue working-set rest — counts down; the native side flips to red overtime.
      const finishAtMs =
        store.workoutPhase === "rest" && store.lastSetRestStartMs !== null && currentRestSec > 0
          ? store.lastSetRestStartMs + currentRestSec * 1000
          : null;
      if (finishAtMs !== null && finishAtMs > Date.now()) {
        startRestChip(finishAtMs, restChipLabel, "rest");
        return () => stopRestChip();
      }
    }
    stopRestChip();
  }, [store.mode, store.timerStarted, store.workoutStartMs, store.readyElapsedBaselineSec,
      store.workoutPhase, store.lastSetRestStartMs, currentRestSec, restChipLabel,
      store.currentIdx, effectiveExercises]);

  // ── Re-sync rest notification when app returns from background (N-DD-5) ────
  // The scheduled notification fires while backgrounded but the timer still
  // needs to be cancelled/rescheduled if the user resumes mid-rest.

  // Mount-scoped (TMR-7) — a dep-driven effect here tore down and re-registered the
  // native listener on every rest-state change (each set logged during a workout),
  // churning through repeated dynamic imports/addListener calls for no benefit since
  // the callback always reads fresh state anyway. Registered once per mount; a
  // cancelled flag guards the async addListener resolution landing after unmount.
  useEffect(() => {
    let handle: { remove: () => void } | null = null;
    let cancelled = false;
    import('@capacitor/app').then(({ App }) => {
      return App.addListener('appStateChange', ({ isActive }: { isActive: boolean }) => {
        if (!isActive) return;
        const s = useWorkoutStore.getState();
        const action = computeRestNotificationAction(
          s.workoutPhase, s.lastSetRestStartMs, effectiveRestSec(s.lastSetRestSec), s.currentSet,
        );
        if (action.action === 'schedule') {
          scheduleRestCompleteNotification(action.delayMs, action.setNumber);
        } else {
          cancelRestCompleteNotification();
        }
      });
    }).then((h: { remove: () => void }) => {
      if (cancelled) { h.remove(); return; }
      handle = h;
    }).catch(() => {});
    return () => { cancelled = true; handle?.remove(); };
  }, []);

  // ── Day rollover while foregrounded (WK-13) ───────────────────────────────
  // onRehydrateStorage resets todayLogged/revertedDeloads only at app rehydrate.
  // An app left open across local midnight would otherwise keep yesterday's "done"
  // ticks (and the Complete-Workout button) until a restart. Re-check on resume —
  // leaf-cheap, no interval timer (render-discipline rule), reads fresh state.
  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== "visible") return;
      const today = todayInTz();
      if (useWorkoutStore.getState().storedDate !== today) {
        useWorkoutStore.getState().rolloverDay(today);
      }
    };
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, []);

  // Live HR runs while the workout is physically underway (active → the
  // per-exercise summary), and stops on pre/done and unmount to spare the ring.
  // It only does real work on-device with a connected ring; a no-op otherwise.
  const liveHrRun =
    store.mode === "active" || store.mode === "exercise-summary";
  useEffect(() => {
    const mgr = getLiveHrManager();
    if (liveHrRun) {
      mgr.start().catch(() => {});
      return () => { mgr.stop().catch(() => {}); };
    }
    return;
  }, [liveHrRun]);

  // Battery lever: drive the costly on-demand HR burst through the whole active phase —
  // sets are short (~20 s) and we want the lift-effort peak on the live chart, not just the
  // rest-recovery dip. Warmup/pre coast on the light history fallback. The exercise-summary
  // screen keeps forcing so the recovery trace stays live.
  const liveHrForced =
    store.mode === "exercise-summary" || store.mode === "active";
  useEffect(() => {
    getLiveHrManager().setForced(liveHrForced);
  }, [liveHrForced]);

  // Record the full-exercise live-HR trace (set + rest) into the shared buffer so the
  // exercise-summary card can replay it with per-set markers. Writes only to the module
  // singleton (never React state) so this 1 Hz tick can't re-render the orchestrator;
  // the LiveHrChart leaves subscribe to it and re-render themselves. Keyed on
  // exerciseStartMs so a new exercise starts a fresh trace. Only genuinely-live readings
  // are recorded — a held/stale value must never fabricate a moving line.
  useEffect(() => {
    if (!liveHrRun) return;
    setTraceExercise(store.exerciseStartMs);
    if (store.exerciseStartMs == null) return;
    const id = setInterval(() => {
      const cur = getLiveHrManager().getCurrent();
      if (cur.bpm == null || cur.at == null) return;
      if (Date.now() - cur.at >= 8_000) return; // stale gap — don't extend an old reading
      recordTraceSample(cur.bpm);
    }, 1000);
    return () => clearInterval(id);
  }, [liveHrRun, store.exerciseStartMs]);

  // ── Initialise per-set weights when exercise changes ──────────────────────

  useEffect(() => {
    // A restore (superset alternation resuming a stashed group member, or resuming
    // a whole exercise after Continue Workout) already has correct per-set weights
    // — recomputing here would blow away any mid-exercise manual weight edits.
    if (skipPerSetWeightsInitRef.current) { skipPerSetWeightsInitRef.current = false; return; }
    // Don't recompute once the user is mid-exercise — a late effectiveExercises change
    // (network fetch, deload toggle) would otherwise blow away staged manual dial edits.
    // Fresh-init only happens pre-timer; an injury swap mid-exercise recomputes explicitly
    // (handleInjurySwap below), since that's a legitimate reason to reset the weights.
    if (store.timerStarted) return;
    const ex = effectiveExercises[store.currentIdx];
    if (!ex) return;
    store.setPerSetWeights(computeInitialWeights(ex, store.sets));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.currentIdx, effectiveExercises]);

  // ── Callbacks ─────────────────────────────────────────────────────────────

  const launchExercise = useCallback(
    (idx: number, solo: boolean) => {
      // Resuming the main sequential flow (not a standalone solo log) at an exercise
      // that's mid-superset (stashed while its group partner was active) restores its
      // WIP instead of wiping it back to set 0 — e.g. after "Continue Workout".
      if (!solo) {
        const restored = useWorkoutStore.getState().restoreExercise(idx);
        if (restored) {
          // The init effect only fires when currentIdx actually changes — if we're
          // restoring the SAME index (e.g. "Continue Workout" back into the exercise
          // already active), the effect won't re-fire to clear the skip flag, poisoning
          // the next legitimate index change. Clear it inline instead of setting it.
          skipPerSetWeightsInitRef.current = idx !== useWorkoutStore.getState().currentIdx;
          store.setCurrentIdx(idx);
          store.setSoloMode(false);
          store.setMode("active");
          return;
        }
      }
      const ex = effectiveExercises[idx];
      const style = ex?.progressionStyle;
      const ds = ex ? exerciseSetCount(ex) : DEFAULT_SETS;
      store.setSets(ds);
      const repsInit = style ? style.map((s) => s.reps) : Array(ds).fill(DEFAULT_REPS);
      // Pre-fill the last set one rep above target so the default log is already a small
      // 1RM gain — compounds (amrap) can push further, accessories (plus1) stay at +1.
      if (ex?.lastSetMode && repsInit.length > 0) repsInit[repsInit.length - 1] += 1;
      store.setReps(repsInit);
      store.initRpeValues(
        Array.from({ length: ds }, (_, i) =>
          defaultRpeFromPct(ex?.exerciseType === "bodyweight" ? undefined : style?.[i]?.pct)
        )
      );
      store.setCurrentIdx(idx);
      store.setSoloMode(solo);
      store.setTimerStarted(false);
      store.setCurrentSet(0);
      store.clearLapTimes();
      store.clearSetTimingArrays();
      store.clearSetWeights();
      store.clearRestTimes();
      store.setAccumulatedRestMs(0);
      store.setTimestamps({ exerciseStartMs: null, lapStartMs: null, restStartMs: null });
      store.setReadyElapsedBaselineSec(null);

      // Initialize per-set weights here directly so they're always correct, even
      // when currentIdx doesn't change (e.g. exercise 0 → warmup → exercise 0 again)
      // which would prevent the initialization useEffect from re-firing.
      store.setPerSetWeights(computeInitialWeights(ex, ds));

      store.setMode("active");
    },
    [effectiveExercises, store],
  );

  // If fresh exercise data arrives from the network after the user tapped "Start Workout"
  // but before the first set timer begins (still on the ready screen), re-initialize the
  // sets/reps so stale-cache data (normal sets) doesn't persist when the baseline phase
  // is detected asynchronously.
  useEffect(() => {
    if (store.mode !== "active" || store.timerStarted) return;
    const ex = effectiveExercises[store.currentIdx];
    if (!ex) return;
    const style = ex.progressionStyle;
    const ds = exerciseSetCount(ex);
    if (ds === store.sets) return;
    store.setSets(ds);
    const repsInit = style ? style.map((s) => s.reps) : Array(ds).fill(DEFAULT_REPS);
    if (ex.lastSetMode && repsInit.length > 0) repsInit[repsInit.length - 1] += 1;
    store.setReps(repsInit);
    store.initRpeValues(
      Array.from({ length: ds }, (_, i) =>
        defaultRpeFromPct(ex.exerciseType === "bodyweight" ? undefined : style?.[i]?.pct)
      )
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveExercises, store.currentIdx]);

  const advance = useCallback(() => {
    // The just-finished exercise's rest countdown (LastSetRestTimer, shown on the
    // summary screen) is anchored on lastSetRestStartMs. advance() always means "leave
    // that screen" — one clear here covers all three exit paths (solo-mode exit, next
    // exercise, workout complete) instead of three separate resets, and stops a stale
    // countdown/beep from bleeding into whatever comes next (the next exercise's own
    // ready screen reads this same field for its own rest ring).
    store.setTimestamps({ lastSetRestStartMs: null });
    if (store.soloMode) {
      store.setSoloMode(false);
      store.setMode("pre");
      return;
    }
    if (store.currentIdx < effectiveExercises.length - 1) {
      const nextIdx = store.currentIdx + 1;
      // A superset partner may already be mid-way through its own sets, stashed
      // while this exercise was active — resume it rather than restarting at set 0.
      const restored = useWorkoutStore.getState().restoreExercise(nextIdx);
      if (restored) {
        // Same-index guard for uniformity with the other two restore call sites (see
        // launchExercise) — advance() always moves to currentIdx + 1 so this can't
        // actually hit the same-index case, but keeping the check here means all three
        // restore paths behave identically if that ever changes.
        skipPerSetWeightsInitRef.current = nextIdx !== useWorkoutStore.getState().currentIdx;
      } else {
        const nextEx = effectiveExercises[nextIdx];
        const nextStyle = nextEx?.progressionStyle;
        const ds = nextEx ? exerciseSetCount(nextEx) : DEFAULT_SETS;
        store.setSets(ds);
        store.setReps(nextStyle ? nextStyle.map((s) => s.reps) : Array(ds).fill(DEFAULT_REPS));
        store.initRpeValues(
          Array.from({ length: ds }, (_, i) =>
            defaultRpeFromPct(nextEx?.exerciseType === "bodyweight" ? undefined : nextStyle?.[i]?.pct)
          )
        );
        store.setTimerStarted(false);
        store.setCurrentSet(0);
        store.clearLapTimes();
        store.clearSetTimingArrays();
        store.clearSetWeights();
        store.clearRestTimes();
        store.setAccumulatedRestMs(0);
        store.setTimestamps({ exerciseStartMs: null, lapStartMs: null, restStartMs: null });
        store.setReadyElapsedBaselineSec(null);
      }
      store.setCurrentIdx(nextIdx);
      store.setSummaryData(null);
      store.setWorkoutPhase("rest");
      store.setMode("active");
    } else {
      if (isCompletingRef.current) return;
      isCompletingRef.current = true;
      const snapLog = [...useWorkoutStore.getState().sessionLog]; // fresh, not the stale closure
      completeWorkout();
      recordXpEarned();
      hapticSuccess();
      handleAddToCalendar(snapLog);
      store.setMode("done");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.currentIdx, effectiveExercises, store.soloMode]);

  // This-session-only swap — never mutates the stored program. Keeps sets/reps/
  // style/rest from the slot. The per-set-weight init effect only recomputes
  // pre-timer (WK-7 guard), so a swap mid-exercise (timer already running) needs
  // an explicit recompute here — both right away (est1rm still null, falls to
  // manual/default) and again once the history fetch resolves a real 1RM.
  const handleInjurySwap = useCallback((exerciseIndex: number, alt: ExerciseLibraryEntry | null) => {
    if (alt === null) {
      // "Skip" reuses the same forward-advance path as the regular Skip button —
      // this exercise is simply never logged, no array mutation needed.
      advance();
      return;
    }
    const swapped = (ex: WorkoutExercise): WorkoutExercise => ({
      ...ex,
      name: alt.name,
      mainMuscles: alt.muscles.filter(m => m.role === "main").map(m => m.muscle),
      secondaryMuscles: alt.muscles.filter(m => m.role === "secondary").map(m => m.muscle),
      equipment: alt.equipment,
      exerciseType: alt.exerciseType,
      // No 1RM basis yet for the new exercise until the history fetch below
      // resolves — falls through to manual entry (default 60kg) in the meantime.
      estimated1rm: null,
      target80: null,
      latestWeight: null,
      lastSetWeights: [],
      lastDate: null,
      lastSets: null,
      lastReps: [],
    });
    setExercises(prev => prev.map((ex, i) => {
      if (i !== exerciseIndex) return ex;
      const next = swapped(ex);
      if (exerciseIndex === useWorkoutStore.getState().currentIdx && useWorkoutStore.getState().timerStarted) {
        useWorkoutStore.getState().setPerSetWeights(computeInitialWeights(next, useWorkoutStore.getState().sets));
      }
      return next;
    }));
    fetch(`/api/exercise-history?name=${encodeURIComponent(alt.name)}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { entries?: { estimated1rm: number | null }[] } | null) => {
        const est1rm = d?.entries?.[0]?.estimated1rm ?? null;
        if (est1rm == null) return;
        setExercises(prev => prev.map((ex, i) => {
          if (i !== exerciseIndex) return ex;
          const next = { ...ex, estimated1rm: est1rm };
          if (exerciseIndex === useWorkoutStore.getState().currentIdx && useWorkoutStore.getState().timerStarted) {
            useWorkoutStore.getState().setPerSetWeights(computeInitialWeights(next, useWorkoutStore.getState().sets));
          }
          return next;
        }));
      })
      .catch(() => {});
  }, [advance]);

  const handleRepChange = useCallback((setIndex: number, value: number) => {
    // reps is no longer in the orchestrator's reactive pick — read the current value at call time.
    store.setReps(useWorkoutStore.getState().reps.map((r, i) => i === setIndex ? value : r));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleWeightChange = useCallback((setIndex: number, value: number) => {
    store.updatePerSetWeight(setIndex, value);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStart = useCallback(() => {
    const now = Date.now();
    // Bar-load / prep time: session-elapsed at first Start minus the elapsed captured when the
    // ready screen was entered (readyElapsedBaselineSec) = time spent getting set up. Null when
    // either anchor is missing (e.g. resumed after a remount).
    const st = useWorkoutStore.getState();
    prepSecRef.current =
      st.readyElapsedBaselineSec != null && st.workoutStartMs != null
        ? Math.max(0, Math.round((now - st.workoutStartMs) / 1000) - st.readyElapsedBaselineSec)
        : null;
    store.setTimestamps({ exerciseStartMs: now, lapStartMs: now, restStartMs: null, lastSetRestStartMs: null });
    store.appendSetStartMs(now);
    store.setAccumulatedRestMs(0);
    store.setTimerStarted(true);
    store.setWorkoutPhase("set");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStartSet = useCallback(() => {
    const now = Date.now();
    const restMs = store.restStartMs !== null ? now - store.restStartMs : 0;
    store.addAccumulatedRestMs(restMs);
    // Clamp negatives (a clock-skew/NTP step can make `now` read before restStartMs)
    // to 0 rather than a negative — a negative value fails the server's min(0) bound
    // and the outbox must never queue a payload the schema will reject (poison-pill rule).
    store.appendRestTime(Math.max(0, Math.round(restMs / 1000)));
    store.setTimestamps({ lapStartMs: now, restStartMs: null, lastSetRestStartMs: null });
    store.appendSetStartMs(now);
    store.setWorkoutPhase("set");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.restStartMs]);

  // Hands the active flat buffer over to another exercise mid-superset: stashes
  // whatever is currently loaded (so this exercise's own progress isn't lost),
  // then either resumes targetIdx's own stashed WIP or, on its first visit,
  // initializes it fresh (mirrors launchExercise, minus the session-level resets).
  const switchToExercise = useCallback((targetIdx: number) => {
    const s = useWorkoutStore.getState();
    s.stashExercise(s.currentIdx);
    const restored = s.restoreExercise(targetIdx);
    if (restored) {
      // Same-index guard — see launchExercise's comment on this pattern.
      skipPerSetWeightsInitRef.current = targetIdx !== s.currentIdx;
    } else {
      const ex = effectiveExercises[targetIdx];
      const style = ex?.progressionStyle;
      const ds = ex ? exerciseSetCount(ex) : DEFAULT_SETS;
      const repsInit = style ? style.map((st) => st.reps) : Array(ds).fill(DEFAULT_REPS);
      if (ex?.lastSetMode && repsInit.length > 0) repsInit[repsInit.length - 1] += 1;
      s.setSets(ds);
      s.setReps(repsInit);
      s.initRpeValues(
        Array.from({ length: ds }, (_, i) =>
          defaultRpeFromPct(ex?.exerciseType === "bodyweight" ? undefined : style?.[i]?.pct)
        )
      );
      s.setTimerStarted(false);
      s.setCurrentSet(0);
      s.clearLapTimes();
      s.clearSetTimingArrays();
      s.clearSetWeights();
      s.clearRestTimes();
      s.setAccumulatedRestMs(0);
      s.setTimestamps({ exerciseStartMs: null, lapStartMs: null, restStartMs: null });
      s.setReadyElapsedBaselineSec(null);
    }
    s.setCurrentIdx(targetIdx);
  }, [effectiveExercises]);

  const handleLogCurrentSet = useCallback(() => {
    if (store.currentSet >= store.sets) return;
    if (isLoggingRef.current) return;
    isLoggingRef.current = true;
    const now = Date.now();
    const completedSetIndex = store.currentSet;
    const ex = effectiveExercises[store.currentIdx];
    // Clamp negatives (a clock-skew/NTP step can make `now` read before lapStartMs)
    // to 0 — the outbox must never queue a payload the server's min(0) bound rejects.
    const lapTime =
      store.lapStartMs !== null
        ? Math.max(0, Math.round((now - store.lapStartMs) / 1000))
        : undefined;
    // perSetWeights isn't in this component's reactive subscription (it mutates
    // on every weight-dial detent — see the ActiveWorkoutScreen self-subscription
    // note above), so read the current value fresh here rather than closing over
    // a stale/removed field.
    store.appendSetWeight(useWorkoutStore.getState().perSetWeights[completedSetIndex] ?? 60);
    if (lapTime !== undefined) store.appendLapTime(lapTime);
    store.appendSetEndMs(now);
    // Record the set boundary into the HR trace at log time — the store's setEndMsArray is
    // cleared the moment the summary opens (commitExerciseSummary), so the summary chart
    // can't read it back from there.
    recordTraceBoundary(now);
    store.setLastSetRestSec(ex?.progressionStyle?.[completedSetIndex]?.restSec ?? 0);
    store.setTimestamps({ lapStartMs: null, restStartMs: now, lastSetRestStartMs: now });
    store.setCurrentSet(completedSetIndex + 1);
    store.setWorkoutPhase("rest");

    // After logging this set, check whether the superset sequence hands the next set to a
    // different (grouped) exercise — this must run even on THIS exercise's last set, or the
    // longer partner's remaining sets are orphaned when the shorter member finishes first.
    // Gated to same-supersetGroup targets only: buildSetSequence flattens every exercise's
    // steps into one array with no boundary marker, so nextStep() on a SOLO exercise's last
    // set (or a superset group's collectively-last set) also resolves to the next unrelated
    // exercise's first step — that transition must go through Complete/exercise-summary via
    // advance(), not an in-place switchToExercise, or the summary screen gets skipped.
    const isLastSetOfExercise = completedSetIndex + 1 >= store.sets;
    const currentGroup = ex?.supersetGroup ?? null;
    const step = nextStep(sequence, { exerciseIndex: store.currentIdx, setIndex: completedSetIndex });
    let handedOff = false;
    if (step && step.exerciseIndex !== store.currentIdx && currentGroup != null
        && effectiveExercises[step.exerciseIndex]?.supersetGroup === currentGroup) {
      switchToExercise(step.exerciseIndex);
      handedOff = true;
    } else if (isLastSetOfExercise) {
      // this exercise is done AND the sequence has no next grouped set for it — but an EARLIER
      // group member may still hold stashed sets (its own sequence turns already passed while it
      // was inactive). Resume the lowest-index buffered exercise before letting advance() finish.
      const buffers = useWorkoutStore.getState().exerciseBuffers;
      const pending = Object.keys(buffers).map(Number).sort((a, b) => a - b)[0];
      if (pending != null) { switchToExercise(pending); handedOff = true; }
    }
    isLoggingRef.current = false;
    // Genuinely the last set, nothing else picked up the baton — go straight to the
    // exercise summary instead of leaving the "all sets logged, tap Complete" hold
    // screen up. That screen's rest ring was getting reflexively spam-tapped while the
    // owner was just trying to rest (2026-07-28); the countdown now lives ON the
    // summary screen (LastSetRestTimer), so nothing about rest tracking is lost — the
    // "Next Exercise" button is the same forward-progress action "Complete" was.
    if (isLastSetOfExercise && !handedOff) handleCompleteSet();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.currentSet, store.sets, store.lapStartMs, store.currentIdx, effectiveExercises, sequence, switchToExercise]);

  const handleCompleteSet = useCallback(async () => {
    const ex = effectiveExercises[store.currentIdx];
    // Read currentSet fresh: handleLogCurrentSet now calls this synchronously in the
    // same tick as store.setCurrentSet(...) for the auto-advance-to-summary path, and
    // the closed-over `store.currentSet` above wouldn't reflect that update yet (this
    // component hasn't re-rendered) — reading it stale would wrongly bail out here.
    if (!ex || useWorkoutStore.getState().currentSet < store.sets) return;
    if (isLoggingRef.current) return;
    isLoggingRef.current = true;
    // Snapshot before any await. reps/setWeights/lap/rest are no longer in the reactive pick —
    // read them from the live store at call time.
    const hot = useWorkoutStore.getState();
    const snapWeights = [...hot.setWeights];
    const snapReps = [...hot.reps];
    const snapLapTimes = [...hot.lapTimes];
    const snapSetStartTimes = [...store.setStartMsArray];
    const snapSetEndTimes = [...store.setEndMsArray];
    const snapRestTimes = [...hot.restTimes];
    // The last set's rest (last-set log → "Complete →" tap) was never recorded: restTimes only
    // gets an entry when the NEXT set starts, and the final set has no next set — so that rest
    // (the timer the user watches on the all-sets-logged screen) vanished. Capture it here and
    // append it so it counts against the last set instead of going nowhere.
    const lastSetRestSec = hot.restStartMs != null
      ? Math.max(0, Math.round((Date.now() - hot.restStartMs) / 1000))
      : null;
    const snapRestTimesFull = lastSetRestSec != null ? [...snapRestTimes, lastSetRestSec] : snapRestTimes;
    const snapAccRestMs = store.accumulatedRestMs;
    const snapExerciseStartMs = store.exerciseStartMs;
    const snapLastExerciseEndMs = store.lastExerciseEndMs;
    // Not in this component's reactive subscription — see the perSetWeights note above.
    const snapRpeValues = [...useWorkoutStore.getState().rpeValues];

    store.clearSetWeights();

    // The no-laps fallback previously used the raw wall-clock delta since exercise
    // start, which includes any rest taken between sets — subtract the accumulated
    // rest so it reflects actual working time, floored at 0 (TMR-8).
    const totalTime =
      snapLapTimes.length > 0
        ? snapLapTimes.reduce((a, b) => a + b, 0)
        : snapExerciseStartMs !== null
          ? Math.max(0, Math.round((Date.now() - snapExerciseStartMs) / 1000) - Math.round(snapAccRestMs / 1000))
          : undefined;

    // Single shared estimator entry point (mirrors the server in lib/workout/log-exercise.ts)
    // so the summary's 1RM matches what gets stored — a baseline (AMRAP) weighted exercise
    // routes to the AMRAP-scaled averaging estimator internally, same as bodyweight.
    const isBaseline = phaseStatus?.isBaseline ?? false;
    // Mirrors the server's deloaded gate (Q-115): a session-level static deload phase or an
    // AI per-exercise/whole-session deload must never feed the 1RM estimate, baseline excepted.
    const isAnyDeload = deload || (phaseStatus?.isDeloadActive ?? false);
    const { estimated1rm: newEst1rm, target80 } = estimateOneRm(
      snapWeights.map((w, i) => ({ weightKg: w, reps: snapReps[i] ?? 0 })),
      {
        exerciseType: ex.exerciseType === "bodyweight" ? "bodyweight" : "weighted",
        style: ex.progressionStyle,
        isBaseline,
        deloaded: ex.deloaded === true || (isAnyDeload && !isBaseline),
      },
    );
    // User-tz datetime (not device-local) so the whole completion flow anchors on a
    // single tz basis — a set logged near midnight on a non-AEST device stamps the
    // user's calendar day, matching the server's own todayInTz recompute (WK-16).
    const loggedAt = nowDatetimeInTz();

    // Inter-exercise rest: time from last set end of previous exercise to "Begin Exercise"
    // tap. Undefined (not recorded) for a grouped/superset exercise — the next
    // exercise's clock can start while this one's last set is still being logged
    // (that's the point of alternating), so "transition time" has no clean meaning
    // mid-superset and would otherwise go negative.
    const interExerciseRestSec =
      ex.supersetGroup == null && snapLastExerciseEndMs !== null && snapExerciseStartMs !== null
        ? Math.round((snapExerciseStartMs - snapLastExerciseEndMs) / 1000)
        : undefined;

    // Generate stable client-side ids so local and server rows share the same PK —
    // prevents pullDelta from duplicating rows on re-sync.
    const clientExerciseLogId = crypto.randomUUID();
    const clientSetLogIds = snapWeights.map(() => crypto.randomUUID());

    // Outbox label date in the user's timezone (YYYY-MM-DD) — matches the
    // complete_workout mutation's date basis (WK-16), one tz source per flow.
    const rawDate = todayInTz();

    const logPayload = {
      workoutSessionId: store.workoutSessionId,
      exerciseLogId: clientExerciseLogId,
      setLogIds: clientSetLogIds,
      sessionName: sessionDisplayName || sessionType,
      sessionId: programSessionId ?? undefined,
      exercise: ex.name,
      weights: snapWeights,
      sets: store.sets,
      reps: snapReps,
      localDate: loggedAt,
      timeToCompleteSet: totalTime,
      setTimes: snapLapTimes.length > 0 ? snapLapTimes : undefined,
      restTimes: snapRestTimesFull.length > 0 ? snapRestTimesFull : undefined,
      setStartTimes: snapSetStartTimes.length > 0 ? snapSetStartTimes : undefined,
      setEndTimes: snapSetEndTimes.length > 0 ? snapSetEndTimes : undefined,
      interExerciseRestSec,
      // Prep/bar-load only for solo exercises — a superset shares one setup, so per-exercise prep
      // has no clean meaning (same reason interExerciseRestSec is gated above).
      prepTimeSec: ex.supersetGroup == null ? (prepSecRef.current ?? undefined) : undefined,
      progressionStyle: ex.progressionStyle ?? undefined,
      styleName: ex.styleName ?? undefined,
      styleId: ex.styleId,
      muscleGroups: ex.muscleGroups?.length ? ex.muscleGroups : undefined,
      workoutStartedAt: useWorkoutStore.getState().workoutStartMs ?? undefined,
      warmupEndedAtMs: store.warmupEndedMs ?? undefined,
      rpeValues: snapRpeValues.length > 0 ? snapRpeValues : undefined,
      estimated1rm: newEst1rm,
      target80,
      ...(deload ? { intensityMode: 'deload' as const } : {}),
      ...(wasOverride ? { wasOverride: true } : {}),
      ...(ex.deloaded ? { exerciseDeloaded: true } : {}),
    };

    const store_ = userId ? getLocalStore(userId) : null;

    // Best-effort local write for instant reads + optimistic PR. Wrapped so its
    // failure (e.g. an unapplied SQLite migration on-device) can never block or
    // break the server send below.
    // Mirrors the server's shouldCountTowardPr gate (log-exercise.ts), which also excludes
    // an active session-level deload unless this is a baseline session — otherwise the
    // client flashes a "new PR" the server will reject. isAnyDeload computed above, alongside
    // the estimateOneRm call it also gates.
    if (store_) {
      store_.logWorkoutLocally(logPayload, 'pending').catch((err) => console.warn('logWorkoutLocally failed:', err));
      if (newEst1rm > 0 && (!isAnyDeload || isBaseline) && !ex.deloaded) {
        store_.getPersonalRecord(ex.name)
          .then((prevPR) => {
            if (!prevPR || newEst1rm > prevPR.estimated1rm) {
              store.addNewPR(ex.name);
            }
          })
          .catch(() => {});
      }
    }

    // Primary send: POST directly to the proven server route. Reliable when online
    // and independent of the on-device outbox / sync-push path (which can fail
    // silently). On failure, queue to the outbox so it retries on the next sync.
    fetch("/api/log-exercise", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(logPayload),
    })
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          if (data.isPR && data.exercise) {
            store.addNewPR(data.exercise);
          }
          store_?.markWorkoutSynced(logPayload.workoutSessionId, logPayload.exerciseLogId).catch(() => {});
        } else {
          store_?.queueMutation({ userId: userId!, domain: 'workout_log', date: rawDate, payload: logPayload }).catch(() => {});
        }
      })
      .catch(() => {
        store_?.queueMutation({ userId: userId!, domain: 'workout_log', date: rawDate, payload: logPayload }).catch(() => {});
      });

    invalidateExerciseLogged(programSessionId).catch(() => {});
    // Touch feedback fires synchronously with the local write, never waiting on the
    // network round-trip — saves feel instant (log-exercise pattern, UI-2).
    hapticLight();
    setLoggedCount((c) => c + 1);
    store.addTodayLogged(programSessionId ?? sessionType.toLowerCase(), ex.name);
    store.appendSessionLog({ name: ex.name, setWeights: snapWeights, reps: snapReps });
    // lastExerciseEndMs must be captured HERE, before commitExerciseSummary clears
    // setEndMsArray — advance() used to read it later and always got null (the bug
    // behind inter_exercise_rest_sec being silently absent on every exercise_logs
    // row past the first, since the column shipped in migration 015).
    store.setTimestamps({ lastExerciseEndMs: snapSetEndTimes[snapSetEndTimes.length - 1] ?? null });
    // Q-87: the exercise coming up next, so the rest-countdown screen can show it.
    // computeInitialWeights(nextEx, 1)[0] is the exact set-1 weight that exercise will
    // open with — same formula the per-set-weights init effect uses, not last-logged weight.
    const nextEx = effectiveExercises[store.currentIdx + 1];
    const nextExercise = nextEx
      ? { name: nextEx.name, startingWeight: computeInitialWeights(nextEx, 1)[0] ?? 0, exerciseType: nextEx.exerciseType }
      : null;
    store.commitExerciseSummary({
      exName: ex.name,
      setWeights: snapWeights,
      sets: store.sets,
      reps: snapReps,
      lapTimes: snapLapTimes,
      restSec: snapAccRestMs > 0 ? Math.round(snapAccRestMs / 1000) : 0,
      prevEst1rm: ex.estimated1rm ?? null,
      allTimePr1rm: ex.allTimePr1rm ?? null,
      newEst1rm: newEst1rm,
      target80: target80,
      progressionStyle: ex.progressionStyle?.map((s) => ({ pct: s.pct, reps: s.reps })),
      exerciseType: ex.exerciseType,
      nextExercise,
    });
    isLoggingRef.current = false;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveExercises, store.currentIdx, store.currentSet, store.sets,
      sessionType, sessionDisplayName, programSessionId, store.accumulatedRestMs,
      store.setStartMsArray, store.setEndMsArray, store.exerciseStartMs,
      store.lastExerciseEndMs, store.workoutSessionId, store.workoutStartMs, store.warmupEndedMs, phaseStatus, deload]);

  // ── Screen keep-awake ─────────────────────────────────────────────────────

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const screen = (window as any).AndroidScreen as { setKeepAwake: (v: boolean) => void } | undefined
    const active = store.mode === 'active' || store.mode === 'exercise-summary'
    screen?.setKeepAwake(active)
    return () => { screen?.setKeepAwake(false) }
  }, [store.mode])

  // ── PiP phase sync + action handlers ─────────────────────────────────────

  // Tell the native layer which phase we're in so it shows the right buttons.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bridge = (window as any).AndroidPip as { updatePhase: (p: string) => void } | undefined
    if (!bridge) return
    let phase: string
    if (store.mode === 'exercise-summary') {
      phase = 'summary'
    } else if (store.mode === 'active') {
      if (store.workoutPhase === 'set') {
        phase = 'set'
      } else if (store.currentSet >= store.sets) {
        phase = 'complete'
      } else {
        phase = 'rest'
      }
    } else if (store.mode === 'done') {
      phase = 'done'
    } else {
      // 'pre' and any other non-active mode — PiP should not open
      phase = 'pre'
    }
    bridge.updatePhase(phase)
  }, [store.mode, store.workoutPhase, store.currentSet, store.sets])

  usePipActions({
    onWeightUp: () => {
      const idx = store.currentSet
      const w = useWorkoutStore.getState().perSetWeights[idx] ?? 60
      const step = weightStepFor(effectiveExercises[store.currentIdx]?.equipment)
      handleWeightChange(idx, mroundStep(w + step, step))
    },
    onWeightDown: () => {
      const idx = store.currentSet
      const w = useWorkoutStore.getState().perSetWeights[idx] ?? 60
      const step = weightStepFor(effectiveExercises[store.currentIdx]?.equipment)
      handleWeightChange(idx, mroundStep(Math.max(step, w - step), step))
    },
    onRepsUp: () => {
      const idx = store.currentSet
      handleRepChange(idx, (useWorkoutStore.getState().reps[idx] ?? 10) + 1)
    },
    onRepsDown: () => {
      const idx = store.currentSet
      handleRepChange(idx, Math.max(1, (useWorkoutStore.getState().reps[idx] ?? 10) - 1))
    },
    onLog: () => {
      if (store.mode === 'exercise-summary') {
        advance()
      } else if (store.mode === 'active') {
        if (store.workoutPhase === 'set') {
          handleLogCurrentSet()
        } else if (store.currentSet >= store.sets) {
          handleCompleteSet()
        } else if (!store.timerStarted) {
          handleStart()
        } else {
          handleStartSet()
        }
      }
    },
  })

  const handleAddToCalendar = useCallback(
    async (log: SessionLogEntry[]) => {
      if (!log.length) return;
      if (typeof window !== "undefined" && localStorage.getItem("ta_pref_calendar_sync") === "false") return;
      const { workoutEndMs, workoutStartMs } = useWorkoutStore.getState();
      const endMs = workoutEndMs ?? Date.now();
      const startMs = Math.min(workoutStartMs ?? endMs, endMs - 60_000);
      setCalendarLoading(true);
      try {
        const res = await fetch("/api/log-calendar-event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // E1-1: `sessionType` is the DB session UUID (nav is id-based), so the raw
          // prop would title the event "<uuid> · TrainingAI". Send the resolved name,
          // mirroring completeWorkout's `sessionDisplayName || sessionType`.
          body: JSON.stringify({ sessionType: sessionDisplayName || sessionType, startMs, endMs, exercises: log }),
        });
        const data = await res.json();
        if (data.code === "CALENDAR_SCOPE_MISSING") {
          toast.error("Calendar permission missing — sign out and reconnect to grant it.");
        } else if (data.success) {
          setCalendarAdded(true);
        } else {
          toast.error("Failed to add to calendar");
        }
      } catch {
        toast.error("Failed to add to calendar");
      } finally {
        setCalendarLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionType, sessionDisplayName, store.workoutEndMs, store.workoutStartMs],
  );

  const completeWorkout = useCallback(() => {
    const endMs = Date.now();
    store.setTimestamps({ workoutEndMs: endMs });
    invalidateWorkoutDataImmediate().catch(() => {});

    // Optimistic paint: stamp today's session into the streak/calendar payloads so home
    // shows it trained immediately. Read the cached values BEFORE invalidation (which
    // clears these same keys), await the invalidation, then setCached the stamped values
    // back in — updateCache would silently no-op on an already-cleared key.
    // User-tz slash-format key to match getCalendarData's YYYY/MM/DD keys (adapter.ts)
    // — device-local localDateString() lands on the wrong day on a non-AEST device
    // near midnight, so the optimistic stamp wouldn't line up with the server (WK-16).
    const todayKey = toAestDateStr(new Date());
    const name = sessionDisplayName || sessionType;
    const stampTrainedDay = (trainedDays: Record<string, string[]>) => {
      const existing = trainedDays[todayKey] ?? [];
      return existing.includes(name)
        ? trainedDays
        : { ...trainedDays, [todayKey]: [...existing, name] };
    };
    const now = new Date();
    const calendarKey = `calendar-data:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const cachedCal = readCacheSync<{ trainedDays: Record<string, string[]>; activityDays: Record<string, string[]> }>(calendarKey);
    const cachedStreak = readCacheSync<{ trainedDays: Record<string, string[]> }>('streak-data');
    void (async () => {
      await invalidateWorkoutSummaries().catch(() => {});
      if (cachedCal) await setCached(calendarKey, { ...cachedCal, trainedDays: stampTrainedDay(cachedCal.trainedDays ?? {}) }, TTL_MEDIUM).catch(() => {});
      if (cachedStreak) await setCached('streak-data', { ...cachedStreak, trainedDays: stampTrainedDay(cachedStreak.trainedDays ?? {}) }, TTL_LONG).catch(() => {});
    })();

    // Local-first: stamp completed_at before the network round-trip, so the
    // session reads as complete even fully offline. Mirrors the log-exercise
    // reference pattern — POST is the primary send, outbox is the fallback.
    const wsId = useWorkoutStore.getState().workoutSessionId;
    const store_ = userId ? getLocalStore(userId) : null;
    if (store_ && wsId) {
      store_.completeWorkoutLocally(wsId, new Date(endMs).toISOString())
        .catch((err) => console.warn('completeWorkoutLocally failed:', err));
    }

    fetch("/api/complete-workout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workoutSessionId: wsId, completedAtMs: endMs }),
    })
      .then((res) => {
        if (res.ok) {
          if (wsId) store_?.markSessionSynced(wsId).catch(() => {});
        } else if (wsId && userId) {
          store_?.queueMutation({ userId, domain: 'complete_workout', date: todayInTz(), payload: { workoutSessionId: wsId, completedAtMs: endMs } }).catch(() => {});
        }
      })
      .catch(() => {
        if (wsId && userId) {
          store_?.queueMutation({ userId, domain: 'complete_workout', date: todayInTz(), payload: { workoutSessionId: wsId, completedAtMs: endMs } }).catch(() => {});
        }
      });

    // Generate the NEXT prescription now, at completion, so it's cached and loads instantly
    // when this session is reopened — no "Preparing your AI workout…" wait. Client-fired for
    // reliability: the server's /api/complete-workout route also fires this, but that
    // container→own-origin self-fetch is unreliable in prod (same reason the open-time trigger
    // moved client-side). Invalidate the prescription caches once it lands so the next open and
    // the done screen's next-workout card read the fresh one. ai_dynamic programs only.
    if (programSessionId && programPhaseMode === 'ai_dynamic') {
      const psid = programSessionId;
      fetch(`/api/ai-periodization/session/${psid}/prescribe`, { method: "POST" })
        .then((res) => { if (res.ok) invalidatePrescriptionChanged(psid).catch(() => {}); })
        .catch(() => {});
    }

    // Detect phase change by fetching fresh phase data after cache invalidation —
    // routed through cachedFetch on the just-invalidated key so it re-warms the
    // cache instead of the same heavy payload being re-fetched bare on next mount (CCH-7).
    cachedFetch<{ phaseStatus?: PhaseStatus }>(
      `workout-data:${sessionType.toLowerCase()}`,
      `/api/workout-data?tab=${encodeURIComponent(sessionType.toLowerCase())}`,
      TTL_LONG,
      (d) => {
        const oldPhase = phaseAtWorkoutStart.current?.phase?.name
        const newPhase = d?.phaseStatus?.phase?.name
        if (newPhase && oldPhase && newPhase !== oldPhase) {
          setPhaseCompletionBanner({ from: oldPhase, to: newPhase })
        }
      },
    ).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.workoutSessionId, sessionType, sessionDisplayName, programSessionId, programPhaseMode]);

  const handleBack = useCallback(() => {
    store.setSoloMode(false);
    store.setCurrentSet(0);
    store.clearLapTimes();
    // Any stashed superset partner is abandoned along with the current exercise's
    // own in-progress sets — consistent with Back already discarding those.
    store.clearExerciseBuffers();
    store.setTimestamps({ lapStartMs: null });
    store.setMode("pre");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Derive todayLogged as Set<string> for child components, scoped to this program session
  // so an exercise logged in another session today (e.g. shared Tricep Cable Combo in
  // both Push and Upper) doesn't show as "done" here too.
  const todayLoggedKey = programSessionId ?? sessionType.toLowerCase();
  const todayLoggedSet = useMemo(
    () => new Set(store.todayLogged[todayLoggedKey] ?? []),
    [store.todayLogged, todayLoggedKey],
  );

  // Resumes a mid-workout session at the next un-logged exercise, sequentially
  // (solo=false) — keeps the existing workoutSessionId/timers instead of the
  // "Start Workout" path, which would mint a fresh session.
  const handleContinueWorkout = useCallback(() => {
    const idx = effectiveExercises.findIndex(ex => !todayLoggedSet.has(ex.name) && !ex.loggedTodayInSession);
    if (idx !== -1) launchExercise(idx, false);
  }, [effectiveExercises, todayLoggedSet, launchExercise]);

  // ── Route to the active screen ─────────────────────────────────────────────

  // The navigated session id is stale (program edited elsewhere; offline mirror was out of
  // sync). We've forced an id-based re-sync above — prompt a reselect rather than guessing a
  // session by name or silently loading the wrong one.
  if (sessionStale) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-6 pt-safe pb-safe text-center">
        <p className="text-base font-semibold">This session was updated</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          Your program changed, so this link is out of date. We&apos;ve refreshed it — reopen the session from your list.
        </p>
        <a
          href="/session-select"
          className="mt-2 inline-flex h-12 items-center justify-center rounded-xl bg-brand px-6 text-base font-semibold text-brand-foreground"
        >
          Back to sessions
        </a>
      </div>
    );
  }

  if (loadError) {
    return <WorkoutLoadError onRetry={() => { setLoading(true); fetchExercises(); }} />;
  }

  if (store.mode === "pre") {
    return (
      <PreWorkoutScreen
        sessionType={sessionDisplayName}
        exercises={effectiveExercises}
        loading={loading}
        todayLogged={todayLoggedSet}
        sessionLog={store.sessionLog}
        workoutActive={!!store.workoutStartMs}
        onLeaveWorkout={store.resetSession}
        onContinueWorkout={handleContinueWorkout}
        onLaunchExercise={launchExercise}
        onStartWorkout={() => { store.startWorkout(sessionType); phaseAtWorkoutStart.current = phaseStatus; cancelWorkoutReminder(); }}
        onRefresh={refreshExercises}
        periodization={periodization}
        periodizationLoading={programPhaseMode === 'ai_dynamic' ? periodizationLoading : false}
        prescriptionPending={(aiPrescriptionPending || durationSwitching) && !prescriptionGenTimedOut}
        prescriptionGenTimedOut={aiPrescriptionPending && prescriptionGenTimedOut}
        sessionBudgetMin={sessionBudgetMin}
        onDurationPresetChange={programPhaseMode === 'ai_dynamic' ? handleDurationPresetChange : undefined}
        deload={deload}
        deloadRecommended={deloadRecommended}
        onDeloadChange={programPhaseMode === 'ai_dynamic' ? setDeload : undefined}
        onPrescriptionStatusChange={(newStatus) => {
          if (periodization) {
            setPeriodization({ ...periodization, state: { ...periodization.state, prescriptionStatus: newStatus } });
          }
          // A status change can flip whether the prescription drives the loaded weights
          // (accept/auto-apply applies the AI pct; dismiss reverts to the base style),
          // so refetch the exercises to re-resolve the per-set progression.
          refreshExercises();
        }}
        onToggleDeloadRevert={(name) => store.toggleDeloadRevert(sessionKey, name)}
        onPhaseChanged={() => {
          if (!programSessionId || programPhaseMode !== 'ai_dynamic') return;
          // Advancing a phase clears the prescription server-side. `refreshExercises` already does
          // everything this needs — invalidate the group, refetch the exercises so the bar reverts
          // to the base style, and re-read the periodization state with `afterWrite` (i.e.
          // `cache: 'no-store'`, past the route's 60s max-age).
          //
          // It used to ALSO fire a bare `fetch` of the same endpoint here. That was strictly worse
          // than redundant: no cache seed, no `no-store`, no cache write-back, no 404 stranded-id
          // recovery — and crucially no `periodizationReqRef` guard, so it could resolve *after*
          // the correct request and overwrite fresh state with a 60s-stale HTTP-cached response.
          refreshExercises();
        }}
        onCompleteWorkout={() => {
          if (isCompletingRef.current) return;
          isCompletingRef.current = true;
          completeWorkout();
          recordXpEarned();
          hapticSuccess();
          store.setMode("done");
          handleAddToCalendar(store.sessionLog);
        }}
      />
    );
  }

  if (store.mode === "warmup") {
    return (
      <WarmupScreen
        sessionType={sessionDisplayName}
        exercises={effectiveExercises}
        workoutStartMs={store.workoutStartMs}
        warmupGoalSec={warmupGoalSec}
        onBeginExercises={() => {
          store.setTimestamps({ warmupEndedMs: Date.now() });
          launchExercise(0, false);
        }}
        onBack={() => {
          store.setTimestamps({ workoutStartMs: null });
          store.setMode("pre");
        }}
      />
    );
  }

  if (store.mode === "exercise-summary" && store.summaryData) {
    if (isPip) {
      // The last set still earns a rest period, and the on-screen summary shows it live
      // (LastSetRestTimer). This branch was a static placeholder that never read
      // lastSetRestStartMs, so backgrounding into PiP during that rest lost the countdown
      // entirely — the one moment PiP is most useful. Route it through the same PipView the
      // active branch below uses; `currentSet >= sets` here, which PipView already renders as
      // "done". Once advance() clears the anchor there is genuinely nothing to count, so the
      // placeholder stays for that case.
      if (store.lastSetRestStartMs !== null) {
        return (
          <PipView
            exerciseName={store.summaryData.exName}
            workoutPhase="rest"
            currentSet={store.currentSet}
            sets={store.sets}
            currentRestSec={currentRestSec}
            lapStartMs={null}
            restStartMs={store.lastSetRestStartMs}
          />
        )
      }
      return (
        <div className="fixed inset-0 bg-black flex flex-col items-center justify-center gap-2 select-none">
          <p className="text-white/50 text-xs uppercase tracking-widest font-semibold">Done</p>
          <p className="text-white text-lg font-bold text-center px-6 leading-snug">{store.summaryData.exName}</p>
          <p className="text-white/30 text-[10px] uppercase tracking-widest">Tap Next to continue</p>
        </div>
      )
    }
    return (
      <ExerciseSummaryScreen
        summaryData={store.summaryData}
        workoutStartMs={store.workoutStartMs}
        onNext={advance}
        userId={userId}
      />
    );
  }

  if (store.mode === "done") {
    const durationMinutes =
      store.workoutStartMs && store.workoutEndMs
        ? Math.round((store.workoutEndMs - store.workoutStartMs) / 60000)
        : null;
    const totalVolumeKg = Math.round(
      store.sessionLog.reduce((sum, entry) =>
        sum + entry.setWeights.reduce((s, w, i) => s + w * (entry.reps[i] ?? 0), 0), 0)
    );
    const totalSets = store.sessionLog.reduce((sum, entry) => sum + entry.setWeights.length, 0);
    return (
      <DoneScreen
        exercises={effectiveExercises}
        todayLogged={todayLoggedSet}
        workoutStartMs={store.workoutStartMs}
        calendarLoading={calendarLoading}
        calendarAdded={calendarAdded}
        durationMinutes={durationMinutes}
        newPRs={store.newPRs}
        xpEarned={store.xpEarned}
        phaseCompletionBanner={phaseCompletionBanner}
        totalVolumeKg={totalVolumeKg > 0 ? totalVolumeKg : undefined}
        totalSets={totalSets > 0 ? totalSets : undefined}
        workoutSessionId={store.workoutSessionId ?? undefined}
        userId={userId}
      />
    );
  }

  // mode === "active"
  if (isPip) {
    return (
      <PipView
        exerciseName={effectiveExercises[store.currentIdx]?.name}
        workoutPhase={store.workoutPhase}
        currentSet={store.currentSet}
        sets={store.sets}
        currentRestSec={currentRestSec}
        lapStartMs={store.lapStartMs}
        restStartMs={store.lastSetRestStartMs}
      />
    )
  }

  return (
    <>
    <ActiveWorkoutScreen
      exercise={effectiveExercises[store.currentIdx]}
      exerciseIndex={store.currentIdx}
      totalExercises={effectiveExercises.length}
      soloMode={store.soloMode}
      timerStarted={store.timerStarted}
      sets={store.sets}
      onWeightChange={handleWeightChange}
      currentSet={store.currentSet}
      lapStartMs={store.lapStartMs}
      workoutPhase={store.workoutPhase}
      restStartMs={store.lastSetRestStartMs}
      currentRestSec={currentRestSec}
      exerciseStartMs={store.exerciseStartMs}
      workoutStartMs={store.workoutStartMs}
      onRepChange={handleRepChange}
      onStartSet={handleStartSet}
      onLogCurrentSet={handleLogCurrentSet}
      onCompleteSet={handleCompleteSet}
      onStart={handleStart}
      onBack={handleBack}
      onSkip={advance}
      sessionName={sessionDisplayName || sessionType}
      phaseStatus={phaseStatus}
      isBaseline={phaseStatus?.isBaseline ?? false}
      activeInjuries={activeInjuries}
      onRpeChange={store.setRpeValue}
      onRequestInjurySwap={(exerciseIndex, injuredMuscles) => setInjurySwapTarget({ exerciseIndex, injuredMuscles })}
      userId={userId}
    />
    <InjurySwapSheet
      open={injurySwapTarget != null}
      onOpenChange={(o) => { if (!o) setInjurySwapTarget(null); }}
      original={injurySwapTarget ? {
        name: effectiveExercises[injurySwapTarget.exerciseIndex]?.name ?? "",
        mainMuscles: effectiveExercises[injurySwapTarget.exerciseIndex]?.mainMuscles ?? [],
      } : null}
      injuredMuscles={injurySwapTarget?.injuredMuscles ?? []}
      onSwap={(alt) => {
        if (injurySwapTarget) handleInjurySwap(injurySwapTarget.exerciseIndex, alt);
        setInjurySwapTarget(null);
      }}
    />
    </>
  );
}
