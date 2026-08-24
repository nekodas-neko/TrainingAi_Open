"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { CalendarIcon, CheckIcon, SparklesIcon, ShareIcon, DumbbellIcon, TrophyIcon, NotebookTextIcon, FlameIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HrRecoveryChart } from "./hr-recovery-chart";
import { ZoneBreakdown } from "@/components/health/zone-breakdown";
import { NextWorkoutCard } from "./next-workout-card";
import type { WorkoutExercise } from "@/app/api/workout-data/route";
import { formatTime } from "./utils";
import { useCountUp } from "@/lib/hooks/use-count-up";
import { todayInTz } from "@trainingai/shared/date-utils";
import { TrainingStressBadge } from "@/components/workout/training-stress-badge";
import { TimeSummaryCard } from "@/components/workout/time-summary-card";
import { cachedFetch } from "@/lib/sqlite/cache";
import { aggregateHrRecoveryByExercise, formatRecoveryRate } from "@trainingai/shared/health/hr-recovery-by-exercise";
import { WORKOUT_RECAP_TTL, WORKOUT_ENERGY_TTL, WORKOUT_HR_TTL, HR_PROFILE_TTL } from "@trainingai/shared/cache-ttl";
import { COMMON_WORKOUT_ACTIVITIES, DEFAULT_ACTIVITY_ID } from "@trainingai/shared/health/workout-activities";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";


// Leaf-scoped so the ~60fps rAF count-up re-renders only this stat cell, not the
// whole DoneScreen tree (stats grid, share-text IIFE, PR list) on every frame —
// mirrors ScoreDisplay in health-score-detail.tsx.
function VolumeStat({ totalVolumeKg }: { totalVolumeKg?: number }) {
  const displayVolumeKg = useCountUp(totalVolumeKg ?? null);
  return (
    <div className="rounded-2xl bg-muted/60 border border-border px-4 py-3 text-center">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Volume</p>
      <p className="text-xl font-bold tabular-nums mt-0.5" style={{ color: "var(--color-brand)" }}>
        {displayVolumeKg != null ? `${Math.round(displayVolumeKg).toLocaleString()} kg` : "—"}
      </p>
    </div>
  );
}

interface DoneScreenProps {
  exercises: WorkoutExercise[];
  todayLogged: Set<string>;
  workoutStartMs: number | null;
  calendarLoading: boolean;
  calendarAdded: boolean;
  durationMinutes?: number | null;
  newPRs?: string[];
  xpEarned?: number;
  phaseCompletionBanner?: { from: string; to: string } | null;
  totalVolumeKg?: number;
  totalSets?: number;
  workoutSessionId?: string;
}

interface HrData {
  hasData: boolean
  workoutHrvMs?: number | null
  startedAt: string
  readings: { timestamp: string; bpm: number }[]
  setStats: {
    exerciseName: string; setNumber: number; loggedAt: string | null
    setStartMs: number | null; setEndMs: number | null
    peakBpm: number | null; hrr1: number | null; adequate: boolean | null
  }[]
}

export function DoneScreen({
  exercises,
  todayLogged,
  workoutStartMs,
  calendarLoading,
  calendarAdded,
  durationMinutes,
  newPRs,
  xpEarned,
  phaseCompletionBanner,
  totalVolumeKg,
  totalSets,
  workoutSessionId,
}: DoneScreenProps) {
  const router = useRouter();

  // Warm /session-select before the tap — see oura-score-chip-row for the pattern. Every workout
  // ends on this screen and the only way forward is back to session select, so this is the most
  // predictable navigation in the app: a button push gets no automatic prefetch (#919), and the
  // user is reading their summary while it warms.
  useEffect(() => { router.prefetch('/session-select'); }, [router]);
  const [hrData, setHrData]     = useState<HrData | null>(null);
  const [hrProfile, setHrProfile] = useState<{ maxHr: number; restingHr: number } | null>(null);
  const [hrLoading, setHrLoading] = useState(false);
  const [hrAttempted, setHrAttempted] = useState(false);
  const [hrError, setHrError] = useState(false);
  const [energy, setEnergy] = useState<{ kcal: number | null; intensity: string; source: 'hr' | 'met' } | null>(null);
  const [activityId, setActivityId] = useState<number>(DEFAULT_ACTIVITY_ID);
  const [recap, setRecap] = useState<string | null>(null);
  const [recapLoading, setRecapLoading] = useState(false);
  const [recapError, setRecapError] = useState(false);

  // A completed session's recap never changes, so it is cache-seeded like every other
  // screen in the app: re-opening the done screen paints the previous text immediately
  // instead of re-running a ~3s AI call. cachedFetch swallows !res.ok, so the failure
  // state comes from onError (CLAUDE.md: self-fetching cards need an explicit one).
  const loadRecap = useCallback(async () => {
    if (!workoutSessionId) return;
    setRecapLoading(true);
    setRecapError(false);
    await cachedFetch<{ recap?: string }>(
      `workout-recap:${workoutSessionId}`,
      `/api/workout-sessions/${workoutSessionId}/recap`,
      WORKOUT_RECAP_TTL,
      (data) => {
        if (data.recap) setRecap(data.recap);
        else setRecapError(true);
        setRecapLoading(false);
      },
      { onError: () => { setRecapError(true); setRecapLoading(false); } },
    );
  }, [workoutSessionId]);

  const loadEnergy = useCallback(async () => {
    if (!workoutSessionId) return;
    const durSec =
      durationMinutes != null
        ? durationMinutes * 60
        : workoutStartMs !== null
          ? Math.floor((Date.now() - workoutStartMs) / 1000)
          : null;
    if (durSec == null || durSec <= 0) return;
    const qs = new URLSearchParams({ durationMin: String(durSec / 60), activityId: String(activityId) });
    // No `rpe` param (Q-420): the prompt that used to supply it is gone. `estSessionKcal` treats a
    // missing RPE as 'moderate' intensity, and heart rate (when the session has one) overrides it
    // entirely regardless — deriving intensity from set RPEs is Q-422/Tuning's, not this entry's.
    await cachedFetch<{ kcal: number | null; intensity?: string; source?: 'hr' | 'met' }>(
      `workout-energy:${workoutSessionId}:${activityId}`,
      `/api/workout-sessions/${workoutSessionId}/energy?${qs}`,
      WORKOUT_ENERGY_TTL,
      (data) => {
        if (data.kcal != null) {
          setEnergy({ kcal: data.kcal, intensity: data.intensity ?? "moderate", source: data.source ?? "met" });
        }
      },
      // The estimate is a nice-to-have — no error state, same as before.
      { onError: () => {} },
    );
  }, [workoutSessionId, durationMinutes, workoutStartMs, activityId]);

  const loadHr = useCallback(async () => {
    if (!workoutSessionId) return;
    setHrLoading(true);
    setHrError(false);
    try {
      // BLE HR is captured server-side into oura_heartrate during the workout — no
      // separate sync call needed here (the legacy Oura Cloud hr-sync POST this used
      // to fire is dead since the ring re-key; the Cloud gets no new data at all, see
      // CLAUDE.md's Oura Direct-BLE section).
      // SHORT TTL, unlike the recap/timing keys: BLE heart rate lands asynchronously, so an
      // early read legitimately returns ready:false and must not stick for hours.
      await cachedFetch<{ ready?: boolean; hasData?: boolean } & Partial<HrData>>(
        `workout-hr:${workoutSessionId}`,
        `/api/oura/hr-data?sessionId=${workoutSessionId}`,
        WORKOUT_HR_TTL,
        (data) => {
          if (data.ready && data.hasData) setHrData(data as HrData);
          setHrLoading(false);
          setHrAttempted(true);
        },
        { onError: () => { setHrError(true); setHrLoading(false); setHrAttempted(true); } },
      );
    } catch {
      setHrError(true);
      setHrLoading(false);
      setHrAttempted(true);
    }
  }, [workoutSessionId]);

  useEffect(() => { loadEnergy(); }, [loadEnergy]);

  // Zone profile for the time-in-zone breakdown (same source as /api/hr-profile).
  useEffect(() => {
    cachedFetch<{ maxHr: number; restingHr: number }>(
      'hr-profile', '/api/hr-profile', HR_PROFILE_TTL,
      (p) => { if (p) setHrProfile({ maxHr: p.maxHr, restingHr: p.restingHr }); },
      { onError: () => {} },
    ).catch(() => {});
  }, []);

  useEffect(() => {
    import("canvas-confetti").then(({ default: confetti }) => {
      confetti({
        particleCount: 140,
        spread: 80,
        origin: { y: 0.35 },
        colors: ["#22c55e", "#16a34a", "#4ade80", "#86efac", "#ffffff"],
      });
    });
  }, []);

  const workoutDurationSec =
    durationMinutes != null
      ? durationMinutes * 60
      : workoutStartMs !== null
        ? Math.floor((Date.now() - workoutStartMs) / 1000)
        : null;

  const doneExercises = exercises.filter(
    (ex) => todayLogged.has(ex.name) || ex.loggedTodayInSession,
  );

  const estSets = doneExercises.reduce((sum, ex) => sum + (ex.lastSets ?? ex.defaultSets), 0);
  const displaySets = totalSets ?? estSets;

  const STATS = [
    { label: "Exercises",  value: `${doneExercises.length}/${exercises.length}` },
    { label: "Duration",   value: workoutDurationSec != null ? formatTime(workoutDurationSec) : "—" },
    { label: "Sets",       value: String(displaySets) },
  ];

  const shareText = (() => {
    const parts = [
      `💪 Workout complete!`,
      `${doneExercises.length} exercise${doneExercises.length !== 1 ? "s" : ""}`,
      workoutDurationSec != null ? formatTime(workoutDurationSec) : null,
      `${displaySets} sets`,
      totalVolumeKg != null ? `${totalVolumeKg.toLocaleString()} kg` : null,
    ].filter(Boolean);
    const prLine = newPRs?.length ? `🏆 New PRs: ${newPRs.join(", ")}` : null;
    return [parts.join(" · "), prLine].filter(Boolean).join("\n");
  })();

  const handleShare = async () => {
    if (navigator.share) {
      await navigator.share({ text: shareText }).catch(() => {});
    } else {
      await navigator.clipboard.writeText(shareText).catch(() => {});
    }
  };

  const handleSharePR = async (prName: string) => {
    const text = `🏆 New personal record on ${prName}! #TrainingAI`;
    if (navigator.share) {
      await navigator.share({ text }).catch(() => {});
    } else {
      await navigator.clipboard.writeText(text).catch(() => {});
    }
  };

  return (
    <>
      <div className="flex h-full flex-col bg-page">
      <div className="flex-1 overflow-y-auto">
      <div className="min-h-full flex flex-col items-center justify-center gap-5 px-6 pt-safe pb-8 text-center">
        <div
          className="flex h-24 w-24 items-center justify-center rounded-full border"
          style={{
            background: "var(--brand-card-bg)",
            borderColor: "var(--brand-card-border)",
            boxShadow: "0 0 40px var(--brand-glow), 0 0 80px var(--brand-glow)",
            color: "var(--color-brand)",
          }}
        >
          <CheckIcon className="h-12 w-12" />
        </div>

        <div>
          <h2 className="flex items-center justify-center gap-2 text-3xl font-bold">You crushed it! <DumbbellIcon className="h-7 w-7" /></h2>
          {calendarLoading && (
            <p className="mt-2 text-xs text-muted-foreground flex items-center justify-center gap-1.5">
              <CalendarIcon className="h-3 w-3 animate-pulse" />
              Saving to Calendar…
            </p>
          )}
          {calendarAdded && (
            <p className="mt-2 text-xs text-green-600 dark:text-green-400 flex items-center justify-center gap-1.5">
              <CalendarIcon className="h-3 w-3" />
              Added to Google Calendar
            </p>
          )}
        </div>

        {/* Phase completion banner */}
        {phaseCompletionBanner && (
          <div className="w-full max-w-xs rounded-2xl p-4" style={{ background: 'color-mix(in oklch, var(--color-brand) 12%, transparent)', border: '1px solid color-mix(in oklch, var(--color-brand) 30%, transparent)' }}>
            <p className="text-sm font-semibold" style={{ color: 'var(--color-brand)' }}>
              {phaseCompletionBanner.from} complete!
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Next workout starts {phaseCompletionBanner.to}
            </p>
          </div>
        )}

        {/* Personal records trophy card */}
        {newPRs && newPRs.length > 0 && (
          <div
            className="w-full max-w-xs rounded-2xl px-4 py-3"
            style={{
              border: "1px solid color-mix(in oklch, var(--accent-amber) 30%, transparent)",
              background: "color-mix(in oklch, var(--accent-amber) 10%, transparent)",
            }}
          >
            <div className="flex items-center justify-between mb-1">
              <p className="flex items-center gap-1 text-xs font-semibold" style={{ color: "var(--accent-amber)" }}><TrophyIcon className="w-3.5 h-3.5" /> Personal Records</p>
              <button
                type="button"
                onClick={handleShare}
                aria-label="Share personal records"
                className="opacity-70 hover:opacity-100 transition-opacity"
                style={{ color: "var(--accent-amber)" }}
              >
                <ShareIcon className="h-3.5 w-3.5" />
              </button>
            </div>
            {newPRs.map(name => (
              <button
                key={name}
                type="button"
                onClick={() => handleSharePR(name)}
                className="w-full text-left flex items-center justify-between group py-0.5"
              >
                <span className="text-sm font-medium" style={{ color: "var(--accent-amber)" }}>{name}</span>
                <ShareIcon className="h-3 w-3 opacity-60 group-hover:opacity-100 transition-opacity flex-none" style={{ color: "var(--accent-amber)" }} />
              </button>
            ))}
          </div>
        )}

        {xpEarned != null && xpEarned > 0 && (
          <div
            className="xp-pop-badge w-full max-w-xs rounded-2xl border px-4 py-3 text-center"
            style={{
              borderColor: "color-mix(in oklch, var(--color-brand) 30%, transparent)",
              background: "color-mix(in oklch, var(--color-brand) 8%, transparent)",
              animation: "xp-pop 0.5s cubic-bezier(0.34,1.56,0.64,1) both",
            }}
          >
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">XP Earned</p>
            <p className="text-2xl font-black tabular-nums" style={{ color: "var(--color-brand)" }}>+{xpEarned}</p>
          </div>
        )}

        {/* 2×2 stats grid */}
        <div className="grid grid-cols-2 gap-2 w-full max-w-xs">
          {STATS.map(stat => (
            <div key={stat.label} className="rounded-2xl bg-muted/60 border border-border px-4 py-3 text-center">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{stat.label}</p>
              <p className="text-xl font-bold tabular-nums mt-0.5" style={{ color: "var(--color-brand)" }}>
                {stat.value}
              </p>
            </div>
          ))}
          <VolumeStat totalVolumeKg={totalVolumeKg} />
        </div>

        {/* Time summary — actual vs planned set-work and rest, with the rest-budget headline */}
        {workoutSessionId && <TimeSummaryCard workoutSessionId={workoutSessionId} />}

        {/* Energy estimate (Q-420: the session-RPE prompt that used to sit above this was removed
            — the owner can't judge a session as one number, and the derived-intensity replacement
            is Q-422/Tuning's, not a client-side change) */}
        {workoutSessionId && energy?.kcal != null && (
          <div className="w-full max-w-xs rounded-2xl bg-muted/40 border border-border p-4">
            <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <FlameIcon className="h-3 w-3" style={{ color: "var(--accent-amber)" }} />
                {/*
                  "{intensity} effort" is the MET tier, and naming it beside a figure heart rate
                  produced would credit the wrong input — the same trap the route already guards
                  by returning a null `met` on the HR path (Q-421). So the suffix follows the
                  basis rather than always reading as the tier.
                */}
                ~{energy.kcal.toLocaleString()} kcal · {energy.source === 'hr' ? 'from heart rate' : `${energy.intensity} effort`}
              </span>
              <TrainingStressBadge date={todayInTz()} />
              <Select value={String(activityId)} onValueChange={(v) => setActivityId(Number(v))}>
                <SelectTrigger className="h-7 w-auto gap-1 rounded-lg border-border/60 px-2 py-0 text-[11px]" aria-label="Workout activity type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMMON_WORKOUT_ACTIVITIES.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)} className="text-xs">{a.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {/* Session recap — never auto-fires; the user is leaving this screen. */}
        {workoutSessionId && (
          <div className="w-full max-w-xs rounded-2xl bg-muted/40 border border-border p-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                <NotebookTextIcon className="h-3.5 w-3.5" />
                Session recap
              </p>
              {!recap && (
                <button
                  type="button"
                  onClick={loadRecap}
                  disabled={recapLoading}
                  className="text-[10px] text-muted-foreground hover:text-foreground transition"
                >
                  {recapLoading ? "Generating…" : "Generate"}
                </button>
              )}
            </div>
            {recap ? (
              <p className="text-sm text-left">{recap}</p>
            ) : recapError ? (
              <p className="text-[10px] text-muted-foreground">Couldn&apos;t generate a recap — tap Generate to retry.</p>
            ) : (
              <p className="text-[10px] text-muted-foreground">
                {recapLoading ? "Reviewing your session…" : "Tap Generate for a short AI review of this session."}
              </p>
            )}
          </div>
        )}

        {/* HR Recovery card */}
        {workoutSessionId && (
          <div className="w-full max-w-xs rounded-2xl bg-muted/40 border border-border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">HR Recovery</p>
              <button
                type="button"
                onClick={loadHr}
                disabled={hrLoading}
                className="text-[10px] text-muted-foreground hover:text-foreground transition"
              >
                {hrLoading ? 'Loading…' : hrData ? 'Refresh' : 'Load'}
              </button>
            </div>

            {hrData ? (
              <>
                <HrRecoveryChart
                  readings={hrData.readings.map(r => ({ timestamp: new Date(r.timestamp), bpm: r.bpm }))}
                  sets={hrData.setStats.map(s => ({ exerciseName: s.exerciseName, setNumber: s.setNumber, loggedAt: s.loggedAt ? new Date(s.loggedAt) : null, setStartMs: s.setStartMs, setEndMs: s.setEndMs }))}
                  sessionStartedAt={new Date(hrData.startedAt)}
                />
                {hrData.readings.length > 1 && (
                  <ZoneBreakdown readings={hrData.readings} profile={hrProfile} />
                )}
                {hrData.workoutHrvMs != null && (
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-muted-foreground">Workout HRV (rest-window rMSSD)</span>
                    <span className="text-foreground font-medium">{Math.round(hrData.workoutHrvMs)} ms</span>
                  </div>
                )}
                {/* Per exercise, not per set: set-level readings are too noisy to act on
                    (most rows carry coverage_ok=false) and six of them in a row don't say
                    anything a lifter can use. See lib/health/hr-recovery-by-exercise.ts. */}
                <div className="space-y-1">
                  {aggregateHrRecoveryByExercise(hrData.setStats).map(ex => (
                    <div key={ex.exerciseName} className="flex items-center justify-between text-[10px]">
                      <span className="text-muted-foreground truncate max-w-[55%]">
                        {ex.exerciseName}
                        <span className="opacity-60"> · {ex.sampleCount}/{ex.totalSets} sets</span>
                      </span>
                      <span className={ex.adequate === false ? 'text-red-400' : ex.adequate ? 'text-green-400' : 'text-muted-foreground'}>
                        {formatRecoveryRate(ex.medianHrr1)}
                        {ex.adequate === true ? ' ✓' : ex.adequate === false ? ' ✗' : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : hrError ? (
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] text-red-400">Couldn&apos;t load HR data.</p>
                <button
                  type="button"
                  onClick={loadHr}
                  className="tap-dense text-[10px] text-muted-foreground hover:text-foreground transition underline underline-offset-2"
                >
                  Retry
                </button>
              </div>
            ) : (
              <p className="text-[10px] text-muted-foreground">
                {hrLoading
                  ? 'Loading HR data…'
                  : hrAttempted
                    ? 'No HR data for this session — wear the chest strap (or the ring) during the workout; ring data arrives via its background sync'
                    : 'Tap Load to check for ring HR data from this workout'}
              </p>
            )}
          </div>
        )}

        <NextWorkoutCard />

        <div className="flex w-full max-w-xs flex-col gap-3 pb-safe-action-lg">
          <Link
            href="/coach"
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand text-brand-foreground font-semibold hover:opacity-90 transition"
          >
            <SparklesIcon className="h-4 w-4" />
            Ask AI Coach
          </Link>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="h-12 flex-1"
              onClick={handleShare}
            >
              <ShareIcon className="h-4 w-4 mr-1.5" />
              Share
            </Button>
            <Button variant="outline" className="h-12 flex-1" onClick={() => router.push("/session-select")}>
              Done
            </Button>
          </div>
        </div>
      </div>
      </div>
      </div>
    </>
  );
}
