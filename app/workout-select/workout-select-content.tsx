"use client";

import { useEffect, useLayoutEffect, useState, useCallback, useRef, useMemo } from "react";
import { useTransitionRouter } from "@/lib/view-transition";
import { useTabVisibility } from "@/components/shell/tab-visibility";
import { RefreshCwIcon, CalendarIcon, HeartPulse, ChevronRight, SlidersHorizontal, Dumbbell } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { motion, AnimatePresence } from "motion/react";
import type { ProgramSession, ExerciseLibraryEntry } from "@trainingai/shared/types/program";
import { getPaletteEntry } from "@trainingai/shared/session-palette";
import { cn } from "@trainingai/shared/utils";
import { MuscleHeatmap, type MuscleActivation } from "@/components/muscle-heatmap";
import { CompletedStamp } from "@/components/workout/completed-stamp";
import { CarouselDots } from "@/components/ui/carousel-dots";
import { hapticTick } from "@/lib/haptics";
import { daysBetweenDateStrs, dayKeyInTz } from "@trainingai/shared/date-utils";
import { useUserTimezone } from "@/components/shell/user-timezone-provider";
import { cachedFetch, cachedFetchToday, readCacheSync, readTodayCacheSync, isWorkoutDataToday, setCached } from "@/lib/sqlite/cache";
import { TTL_LONG, MUSCLE_RECOVERY_TTL, NEXT_SESSION_TTL } from '@trainingai/shared/cache-ttl';
import { MuscleRecoveryCard } from "@/components/workout/muscle-recovery-card";
import type { MuscleRecoveryEntry } from "@/app/api/muscle-recovery/route";
import { useCachedValue } from "@/lib/hooks/use-cached-value";
import type { NextSessionRecommendation } from "@trainingai/shared/types/program";

// Module-level so the no-data fallback keeps one identity across renders — `recoveryMuscles`
// feeds a useMemo dependency list.
const EMPTY_RECOVERY: MuscleRecoveryEntry[] = [];


function getLastTrainedLabel(session: ProgramSession, tz: string): string {
  try {
    const data = readCacheSync<{ dataDate?: string; exercises: Array<{ lastDate: string | null; loggedTodayInSession?: boolean }> }>(`workout-card:${session.id}`);
    if (!data) return "";
    const exercises: Array<{ lastDate: string | null; loggedTodayInSession?: boolean }> = data.exercises ?? [];
    if (exercises.length === 0) return "";
    if (isWorkoutDataToday(data, tz) && exercises.some((e) => e.loggedTodayInSession)) return "Trained today";
    const todayKey = dayKeyInTz(tz, 0);
    const dates = exercises
      .map((e) => e.lastDate)
      .filter((d): d is string => Boolean(d) && d !== todayKey);
    if (!dates.length) return "Never trained";
    const maxDate = dates.reduce((a, b) => (a > b ? a : b));
    const days = daysBetweenDateStrs(maxDate, todayKey);
    if (days === 1) return "Yesterday";
    return `${days} days ago`;
  } catch { return ""; }
}

function buildMuscleActivations(session: ProgramSession, library: ExerciseLibraryEntry[]): MuscleActivation[] {
  const byName = new Map(library.map((e) => [e.name.toLowerCase(), e]));
  const seen = new Map<string, "main" | "secondary">();
  for (const ex of session.exercises) {
    const entry = byName.get(ex.exerciseName.toLowerCase());
    if (entry) {
      for (const m of entry.muscles) {
        if (!seen.has(m.muscle) || m.role === "main") seen.set(m.muscle, m.role);
      }
    } else {
      // Library miss — fall back to the DB muscle groups stored on the exercise
      for (const m of ex.muscleGroups ?? []) {
        if (!seen.has(m)) seen.set(m, "main");
      }
    }
  }
  return Array.from(seen.entries()).map(([muscle, role]) => ({ muscle, role }));
}

export default function WorkoutSelectContent() {
  const tz = useUserTimezone();
  const router = useTransitionRouter();
  const { epoch: tabEpoch } = useTabVisibility();
  const [sessions, setSessions] = useState<ProgramSession[]>([]);
  // `sessions: []` means two different things — "still loading" and "this account has no program" —
  // and rendering the second as the first is what left a new user staring at an empty card with a
  // dead Start button (Q-451). Set only from a cache seed or a settled fetch, never in a `finally`:
  // telling someone with a program "No program yet" because their network dropped is a worse
  // failure than holding the skeleton.
  const [programLoaded, setProgramLoaded] = useState(false);
  const [library, setLibrary] = useState<ExerciseLibraryEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [dataEpoch, forceUpdate] = useState(0);

  const N = sessions.length;

  // Current session index + swipe direction for AnimatePresence
  const [currentIdx, setCurrentIdx] = useState(0);
  const [hasSeeded, setHasSeeded] = useState(false);
  const [recommendedId, setRecommendedId] = useState<string | null>(null);
  const [direction, setDirection] = useState(0); // -1 = swiped up (next), 1 = swiped down (prev)
  const recovery = useCachedValue<{ muscles: MuscleRecoveryEntry[] }>(
    'muscle-recovery', '/api/muscle-recovery', MUSCLE_RECOVERY_TTL,
  );
  const recoveryMuscles = recovery?.muscles ?? EMPTY_RECOVERY;
  const [phaseStatus, setPhaseStatus] = useState<import('@/app/api/workout-data/route').PhaseStatus | null>(null);
  const [perSessionPhaseStatus, setPerSessionPhaseStatus] = useState<import('@/app/api/workout-data/route').PerSessionPhaseStatus[]>([]);

  const currentSession = sessions[currentIdx] ?? sessions[0];
  const p = getPaletteEntry(currentSession?.position ?? 0);
  // getLastTrainedLabel does a raw readCacheSync('workout-card:<id>') read internally rather than
  // taking the card data as an argument — so this memo also needs dataEpoch as a dependency.
  // Completing a workout invalidates and repopulates that cache entry via the workout-data:all
  // batch fetch below, which only bumps dataEpoch (forceUpdate) rather than changing
  // currentSession's object reference — without dataEpoch here, "Trained today" stayed frozen at
  // whatever the cache held when sessions was first set, until an unrelated remount (Q-89).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const lastTrained = useMemo(() => getLastTrainedLabel(currentSession, tz), [currentSession, dataEpoch, tz]);
  const trainedToday = lastTrained === "Trained today";
  const exCount = currentSession?.exercises.length ?? 0;
  const estMin = Math.round(exCount * 9);

  const muscleActivations = useMemo(
    () => (library.length > 0 && currentSession ? buildMuscleActivations(currentSession, library) : []),
    [currentSession, library],
  );

  const sessionRecoveryMuscles = useMemo(() => {
    if (muscleActivations.length === 0) return [];
    const recoveryByMuscle = new Map(recoveryMuscles.map(m => [m.muscle.toLowerCase(), m]));
    return muscleActivations
      .filter(a => a.role === "main")
      .map(a => recoveryByMuscle.get(a.muscle.toLowerCase()) ?? { muscle: a.muscle.toLowerCase(), pct: 100, hoursAgo: 168 })
      .sort((a, b) => a.pct - b.pct);
  }, [recoveryMuscles, muscleActivations]);

  // Phase for the currently displayed session — falls back to leader phaseStatus
  const currentSessionPhase = useMemo(() => {
    if (!currentSession || perSessionPhaseStatus.length === 0) return phaseStatus
    return perSessionPhaseStatus.find(p => p.sessionId === currentSession.id)?.phaseStatus ?? phaseStatus
  }, [currentSession, perSessionPhaseStatus, phaseStatus])

  // ── Data ─────────────────────────────────────────────────────────────────

  useLayoutEffect(() => {
    const meta = readCacheSync<{ program?: { sessions?: ProgramSession[] }; phaseStatus?: import('@/app/api/workout-data/route').PhaseStatus | null; perSessionPhaseStatus?: import('@/app/api/workout-data/route').PerSessionPhaseStatus[] }>("workout-data:meta");
    if (meta) setProgramLoaded(true);
    if (meta?.program?.sessions?.length) {
      const loaded = meta.program.sessions;
      setSessions(loaded);
      // Default carousel to today's recommended session
      const rec = readTodayCacheSync<NextSessionRecommendation>('next-session');
      if (rec?.session) {
        setRecommendedId(rec.session.id);
        const idx = loaded.findIndex(s => s.id === rec.session!.id);
        if (idx >= 0) { setCurrentIdx(idx); setHasSeeded(true); }
      }
    }
    if (meta?.phaseStatus) setPhaseStatus(meta.phaseStatus);
    if (meta?.perSessionPhaseStatus) setPerSessionPhaseStatus(meta.perSessionPhaseStatus);
    const lib = readCacheSync<{ exercises: ExerciseLibraryEntry[] }>("exercise-library");
    if (lib?.exercises?.length) setLibrary(lib.exercises);
  }, []);

  const fetchData = useCallback(async () => {
    setRefreshing(true);
    try {
      let loaded: ProgramSession[] = [];
      await Promise.all([
        cachedFetch<{ program?: { sessions?: ProgramSession[] }; phaseStatus?: import('@/app/api/workout-data/route').PhaseStatus | null; perSessionPhaseStatus?: import('@/app/api/workout-data/route').PerSessionPhaseStatus[] }>(
          "workout-data:meta", "/api/workout-data?tab=meta", TTL_LONG,
          (meta) => { loaded = meta?.program?.sessions ?? []; setSessions(loaded); setProgramLoaded(true); setPhaseStatus(meta?.phaseStatus ?? null); setPerSessionPhaseStatus(meta?.perSessionPhaseStatus ?? []); },
        ),
        cachedFetchToday<NextSessionRecommendation>(
          'next-session', '/api/next-session', NEXT_SESSION_TTL,
          (rec) => {
            setRecommendedId(rec?.session?.id ?? null);
            setHasSeeded(prev => {
              if (!prev && rec?.session && loaded.length > 0) {
                const idx = loaded.findIndex(s => s.id === rec.session!.id);
                if (idx >= 0) setCurrentIdx(idx);
              }
              return true;
            });
          },
        ),
        cachedFetch<{ exercises: ExerciseLibraryEntry[] }>(
          "exercise-library", "/api/exercise-library", TTL_LONG,
          (lib) => { if (lib?.exercises) setLibrary(lib.exercises); },
          { freshWithinTtl: true },
        ),
      ]);
      // One batch request seeds every session's `workout-card:<id>` — collapses the old
      // N+1 per-session prefetch fan-out. The batch (?tab=all) is strictly read-only server-side
      // (fires no /prescribe, does no DB writes); the seed shape matches the single-tab response
      // exactly so opening a tab paints from it. freshWithinTtl invalidation proof: both
      // `workout-data:all` and each `workout-card:<id>` are invalidated by invalidateWorkoutSummaries
      // (workout completion), invalidateExerciseLogged (mid-session log),
      // invalidatePrescriptionChanged (accept/dismiss/transition, refreshExercises, and confirming
      // an early deload — Q-117, previously missing), invalidateInjuryWrites (add/edit/resolve/
      // delete an injury — Q-117, previously missing), and invalidateProgramStructure (config
      // edits) — every write that changes this payload goes through one of those groups.
      await cachedFetch<{ perSession?: Record<string, unknown> }>(
        'workout-data:all', '/api/workout-data?tab=all', TTL_LONG,
        (data) => {
          const perSession = data?.perSession ?? {};
          for (const [id, card] of Object.entries(perSession)) {
            setCached(`workout-card:${id}`, card, TTL_LONG).catch(() => {});
          }
        },
        { freshWithinTtl: true },
      ).catch(() => {});
      forceUpdate((n) => n + 1);
    } catch { /* silent */ }
    finally { setRefreshing(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData, tabEpoch]);

  // ── Touch gesture ─────────────────────────────────────────────────────────

  const containerRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);
  const touchPrevY = useRef(0);
  const touchPrevTime = useRef(0);
  const touchVelocity = useRef(0);

  // Non-passive so preventDefault works
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const fn = (e: TouchEvent) => e.preventDefault();
    el.addEventListener("touchmove", fn, { passive: false });
    return () => el.removeEventListener("touchmove", fn);
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStartY.current = t.clientY;
    touchPrevY.current = t.clientY;
    touchPrevTime.current = Date.now();
    touchVelocity.current = 0;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    const now = Date.now();
    const dt = now - touchPrevTime.current;
    if (dt > 0) touchVelocity.current = (t.clientY - touchPrevY.current) / dt;
    touchPrevY.current = t.clientY;
    touchPrevTime.current = now;
  }, []);

  const handleTouchEnd = useCallback(() => {
    const delta = touchPrevY.current - touchStartY.current; // negative = swiped up
    const v = touchVelocity.current; // px/ms, negative = moving up
    const isFlick = Math.abs(v) > 0.2;

    if (delta < -50 || (isFlick && v < -0.2)) {
      // Swipe up → next session
      setDirection(-1);
      setCurrentIdx((i) => (i + 1) % N);
      hapticTick();
    } else if (delta > 50 || (isFlick && v > 0.2)) {
      // Swipe down → previous session
      setDirection(1);
      setCurrentIdx((i) => (i - 1 + N) % N);
      hapticTick();
    }
  }, [N]);

  // Warm whichever session is currently showing — the carousel means exactly one is
  // startable at a time, so this is one payload, re-warmed as the user swipes. A button
  // push gets none of <Link>'s automatic prefetching, so otherwise the fetch begins on
  // tap with the transition already waiting on it (#919).
  // /cardio is the other exit from this screen (the cardio tile), and it had no prefetch while the
  // strength one did — so picking cardio waited on the network and picking a lift did not.
  useEffect(() => { router.prefetch('/cardio'); }, [router]);
  useEffect(() => {
    if (!currentSession?.id) return;
    router.prefetch(`/workout?session=${encodeURIComponent(currentSession.id)}`);
  }, [router, currentSession?.id]);

  const handleStart = (session: ProgramSession) => {
    document.cookie = `ta_session=${encodeURIComponent(session.name)}; path=/; max-age=${60 * 60 * 24 * 7}`;
    router.push(`/workout?session=${encodeURIComponent(session.id)}`);
  };

  // Slide variants for header content
  const slideVariants = {
    enter: (d: number) => ({ opacity: 0, y: d < 0 ? -24 : 24 }),
    center: { opacity: 1, y: 0 },
    exit:  (d: number) => ({ opacity: 0, y: d < 0 ? 24 : -24 }),
  };

  return (
    <div
      className="flex flex-col bg-page pb-nav-safe"
      style={{ height: "100dvh" }}
    >
      <header className="flex-none px-4 pt-safe pb-3 border-b border-border flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Workout</h1>
          <p className="text-sm text-muted-foreground">Choose a session to start</p>
        </div>
        <div className="flex items-center gap-1">
          {/* Program structure is the most workout-central configuration in the app and used to be
              two containers away, under a More sub-tab also called "Workout" (Q-235). */}
          <button
            onClick={() => router.push('/program')}
            className="rounded-xl p-2.5 text-muted-foreground hover:bg-muted transition"
            aria-label="Program"
          >
            <SlidersHorizontal className="h-4 w-4" />
          </button>
          <button
            onClick={fetchData}
            disabled={refreshing}
            className="rounded-xl p-2.5 text-muted-foreground hover:bg-muted transition"
            aria-label="Refresh"
          >
            <RefreshCwIcon className={cn("h-4 w-4", refreshing && "animate-spin")} />
          </button>
        </div>
      </header>

      <div className="flex-1 flex flex-col min-h-0 py-4 gap-3">
        {N === 0 && !programLoaded ? (
          /* Nothing is known yet — no cache seed and no settled fetch. A repeat visit never lands
             here: the layout effect seeds `sessions` synchronously before paint, so the card is
             already on screen. This is the genuine cold first load. */
          <Skeleton className="flex-1 min-h-0 mx-4 rounded-2xl" />
        ) : N === 0 ? (
          /* No program on the account. This used to render the carousel anyway — a ~1,400 px card
             showing position-0's palette emoji as a stand-in for absent content, under a full-width
             "Start Workout" button whose onClick short-circuited on the missing session and did
             nothing at all (Q-451). `/program` already handled the same account properly, so the
             fix is to say the same thing on the screen the user is actually dropped on. */
          <div className="flex-1 min-h-0 mx-4">
            <div className="h-full rounded-2xl border border-border bg-muted/40 p-6 flex flex-col items-center justify-center gap-4 text-center">
              <Dumbbell className="h-10 w-10 text-muted-foreground" aria-hidden />
              <div>
                <p className="text-base font-semibold">No program yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Create one to get a session to start. Cardio and one-off activities work without a program.
                </p>
              </div>
              <button
                type="button"
                onClick={() => router.push("/program")}
                className="rounded-xl px-5 py-3 text-sm font-bold text-brand-foreground active:scale-95 transition-transform"
                style={{ background: "var(--color-brand)" }}
              >
                Create a program
              </button>
            </div>
          </div>
        ) : (
        /* Single card — body diagram stays, only text/button animates */
        <div
          ref={containerRef}
          className="flex-1 min-h-0 mx-4"
          style={{ touchAction: "none", userSelect: "none" }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div
            className={cn("h-full rounded-2xl border p-4 flex flex-col gap-3 overflow-hidden", p.bgClass, p.borderClass, trainedToday && "ring-1 ring-green-500/40")}
            style={{ willChange: 'transform' }}
          >

            {/* Header — slides in from swipe direction */}
            <div className="flex-none overflow-hidden" style={{ minHeight: "3.5rem" }}>
              <AnimatePresence mode="popLayout" initial={false} custom={direction}>
                <motion.div
                  key={currentSession?.id}
                  custom={direction}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-3xl">{currentSession?.icon ?? p.emoji}</span>
                    <div className="min-w-0">
                      <p className={cn("text-xl font-bold truncate", p.textClass)}>
                        {currentSession?.name}
                      </p>
                      {currentSession?.id === recommendedId && (
                        <span
                          className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold text-brand-foreground mt-0.5"
                          style={{ background: "var(--color-brand)" }}
                        >
                          Recommended today
                        </span>
                      )}
                      {lastTrained && !trainedToday && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <CalendarIcon className="h-3 w-3 flex-none" />{lastTrained}
                        </p>
                      )}
                      {currentSessionPhase && !currentSessionPhase.isDeloadActive && (
                        <p className="text-xs text-muted-foreground">
                          {currentSessionPhase.openEnded
                            ? `${currentSessionPhase.phase.name} · Session ${currentSessionPhase.phaseSessionNumber}`
                            : `${currentSessionPhase.phase.name} · Cycle ${currentSessionPhase.cycleInPhase}/${currentSessionPhase.totalPhaseCycles}`}
                        </p>
                      )}
                      {currentSessionPhase?.isDeloadActive && (
                        <p className="text-xs text-amber-600 dark:text-amber-400">
                          {currentSessionPhase.phase.phaseType === 'deload' ? 'Deload Week' : 'Recovery Week'}
                        </p>
                      )}
                    </div>
                  </div>
                  {exCount > 0 && (
                    <div className="flex flex-col items-end gap-0.5 flex-none text-xs text-muted-foreground">
                      <span>{exCount} exercises</span>
                      <span>~{estMin} min</span>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* The "done" state is now the stamp over the muscle diagram below (Q-97-followup),
                not a banner in this lane. Kept here for screen readers, which get nothing from a
                decorative graphic. */}
            {trainedToday && <span className="sr-only">Completed today</span>}

            {/* Muscle diagram — always mounted, props update in place.
                `overflow-hidden` is load-bearing, not tidiness: the heatmap's SVGs are
                width-driven (`[&_svg]:w-full h-auto` inside MuscleHeatmap), so their height is
                fixed by the card's width and cannot shrink when this lane is squeezed. Without
                clipping they overflow the lane in BOTH directions (items-center) and collide with
                the session header above — which is exactly what happened when the recovery chips
                went from a one-line marquee to a wrapping row. Clipping trims equal slivers of the
                figures' empty margin instead, which is invisible. */}
            <div className="flex-1 min-h-0 flex items-center overflow-hidden">
              <div className="relative w-full">
                {muscleActivations.length > 0 ? (
                  <MuscleHeatmap assignments={muscleActivations} className="w-full" />
                ) : exCount > 0 ? (
                  <div className="w-full h-24 rounded-xl bg-muted/30 animate-pulse" />
                ) : null}
                {trainedToday && muscleActivations.length > 0 && <CompletedStamp />}
              </div>
            </div>
            <MuscleRecoveryCard muscles={sessionRecoveryMuscles} />

            {/* Start button — fades on session change */}
            <AnimatePresence mode="wait" initial={false}>
              <motion.button
                key={`btn-${currentSession?.id}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                onClick={() => currentSession && handleStart(currentSession)}
                className={cn(
                  "flex-none w-full rounded-xl py-3 text-sm font-bold hover:opacity-90 active:scale-95 transition-transform",
                  trainedToday ? "bg-muted border border-green-500/40 text-foreground" : "text-brand-foreground",
                )}
                style={!trainedToday ? { background: "var(--color-brand)" } : {}}
              >
                {trainedToday ? "Start Again" : "Start Workout"}
              </motion.button>
            </AnimatePresence>

          </div>
        </div>
        )}

        {/* Dot indicators */}
        {N > 0 && (
          <CarouselDots
            className="flex-none"
            count={N}
            activeIndex={currentIdx}
            onSelect={setCurrentIdx}
            label={i => `Session ${i + 1}${sessions[i]?.name ? `: ${sessions[i].name}` : ""}`}
            activeColor="var(--color-brand)"
            inactiveColor={i => (sessions[i]?.id === recommendedId ? "var(--color-muted-foreground)" : "var(--color-border)")}
          />
        )}

        {/* Gym Workout is the carousel above; everything non-gym lives behind the cardio hub.
            Styled as a sibling of the workout card — same `mx-4` inset, same `rounded-2xl` — rather
            than a full-bleed control beneath it. The old treatment was a grey slab that named a
            destination and described nothing: behind this sit the running plan, the weekly
            zone-minute quota, steps, the heart profile and trends. Naming the three destinations is
            the cheapest way to stop it reading as a footer.

            The card flexes (`flex-1 min-h-0`), so this row's extra height cannot overflow the
            screen — it costs the muscle diagram 26dp, which is the one element inside the card
            designed to absorb it. */}
        <div className="flex-none mx-4">
          <button
            onClick={() => router.push('/cardio')}
            className="flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left transition active:scale-[0.985]"
            style={{
              background: 'linear-gradient(160deg, color-mix(in oklch, var(--accent-cyan) 20%, transparent), color-mix(in oklch, var(--accent-cyan) 7%, transparent))',
              borderColor: 'color-mix(in oklch, var(--accent-cyan) 30%, transparent)',
            }}
          >
            <span
              className="grid h-10 w-10 flex-none place-items-center rounded-xl"
              style={{ background: 'color-mix(in oklch, var(--accent-cyan) 18%, transparent)', color: 'var(--accent-cyan)' }}
            >
              <HeartPulse className="h-5 w-5" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-base font-bold tracking-tight">Cardio Hub</span>
              <span className="text-xs text-muted-foreground">Run · Walk · Log anything</span>
            </span>
            <ChevronRight className="h-[18px] w-[18px] flex-none text-muted-foreground" />
          </button>
        </div>
      </div>
    </div>
  );
}
