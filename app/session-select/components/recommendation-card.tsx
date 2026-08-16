"use client";

import { memo, useMemo } from "react";
import Link from "next/link";
import { Clock, Dumbbell, Calendar, MessageCircle, Moon, BedDouble, TriangleAlertIcon, PartyPopperIcon } from "lucide-react";
import type { ProgramSession, NextSessionRecommendation } from "@trainingai/shared/types/program";
import type { MoodLog } from "@trainingai/shared/types/mood";
import type { PhaseStatus, PerSessionPhaseStatus } from "@/app/api/workout-data/route";
import { getPaletteEntry } from "@trainingai/shared/session-palette";
import { getSessionIcon } from "@/lib/session-icon";
import { ColorSwatchPicker } from "@/components/ui/color-swatch-picker";
import { CARD_DEFAULT_COLORS } from "../constants";
import { readableOn } from "@trainingai/shared/utils";
import { readCacheSync } from "@/lib/sqlite/cache";
import { daysBetweenDateStrs } from "@trainingai/shared/date-utils";
import { DeloadExplanation } from "./deload-explanation";

function lastSessionDay(
  sessionId: string,
  dayKey: (daysAgo?: number) => string,
): string {
  try {
    const data = readCacheSync<{ exercises: Array<{ lastDate: string | null }> }>(`workout-card:${sessionId}`);
    if (!data) return "—";
    const exercises: Array<{ lastDate: string | null }> = data.exercises ?? [];
    const dates = exercises.map(e => e.lastDate).filter((d): d is string => Boolean(d));
    if (!dates.length) return "—";
    const maxDate = dates.reduce((a, b) => (a > b ? a : b)).slice(0, 10);
    const todayKey = dayKey(0);
    const days = daysBetweenDateStrs(maxDate, todayKey);
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    // Component-wise: `new Date(iso + 'T00:00:00Z')` is UTC midnight, which renders the previous
    // weekday on any device behind UTC (Q-130).
    const [y, mo, dd] = maxDate.replace(/\//g, "-").split("-").map(Number);
    return new Date(y, mo - 1, dd).toLocaleDateString("en-AU", { weekday: "short" });
  } catch { return "—"; }
}

interface RecommendationCardProps {
  recommendation: NextSessionRecommendation | null;
  todaySessionName: string | null;
  activeSessions: ProgramSession[];
  moodLog: MoodLog | null | undefined;
  phaseStatus: PhaseStatus | null;
  perSessionPhaseStatus: PerSessionPhaseStatus[];
  cardColors: Record<string, string>;
  sectionEditMode: boolean;
  dayKey: (daysAgo?: number) => string;
  // Bumped by the caller each time the `workout-data:all` batch seeds `workout-card:<id>` —
  // that seed is a setCached side effect outside React state, so without this the memo'd card
  // never re-renders to pick up a "Last: —" whose first paint landed before the batch resolved.
  workoutCardEpoch: number;
  onStartWorkout: (session: ProgramSession) => void;
  onRestDay: () => void;
  onLogMood: () => void;
  onColorChange: (hex: string) => void;
}

function RecommendationCardComponent({
  recommendation,
  todaySessionName,
  activeSessions,
  moodLog,
  phaseStatus,
  perSessionPhaseStatus,
  cardColors,
  sectionEditMode,
  dayKey,
  workoutCardEpoch,
  onStartWorkout,
  onRestDay,
  onLogMood,
  onColorChange,
}: RecommendationCardProps) {
  const todaySessionObj = todaySessionName
    ? activeSessions.find(s => s.name === todaySessionName)
    : null;
  const displaySession = todaySessionObj ?? recommendation?.session;
  const displaySessionPhase = displaySession
    ? (perSessionPhaseStatus.find(p => p.sessionId === displaySession.id)?.phaseStatus ?? phaseStatus)
    : phaseStatus;
  const isTrainedToday = todaySessionName !== null;
  // lastSessionDay does a raw readCacheSync('workout-card:<id>') read internally rather than
  // taking the card data as an argument, so this memo needs workoutCardEpoch as a dependency —
  // the workout-data:all batch fetch only bumps that counter (a setCached side effect outside
  // React state), not displaySession's object reference (Q-106, same class as Q-89).
  const lastTrained = useMemo(
    () => displaySession ? lastSessionDay(displaySession.id, dayKey) : "—",
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [displaySession?.id, dayKey, workoutCardEpoch],
  );

  const _rtColor = cardColors["recommendedToday"] ?? CARD_DEFAULT_COLORS.recommendedToday;
  const _rtR = parseInt(_rtColor.slice(1, 3), 16);
  const _rtG = parseInt(_rtColor.slice(3, 5), 16);
  const _rtB = parseInt(_rtColor.slice(5, 7), 16);

  return (
    <div className="px-4 pb-3 pt-2 relative">
      {sectionEditMode && (
        <div className="absolute top-3 right-3 z-20" onClick={e => e.stopPropagation()}>
          <ColorSwatchPicker
            value={_rtColor}
            label="Recommended Today"
            onChange={onColorChange}
          />
        </div>
      )}
      {recommendation === null && !todaySessionName ? (
        <div className="h-[160px] animate-pulse rounded-2xl bg-muted" />
      ) : !isTrainedToday && recommendation?.isRestDay ? (
        <div className="rounded-2xl bg-muted/60 border border-border p-4 flex items-center gap-4">
          <Moon className="h-9 w-9 text-indigo-400 flex-none" />
          <div>
            <p className="font-bold text-lg">Rest Day</p>
            <p className="text-sm text-muted-foreground">{recommendation.reason}</p>
          </div>
        </div>
      ) : displaySession ? (
        <div
          className="rounded-2xl p-4 flex flex-col gap-3"
          style={{
            backgroundColor: "color-mix(in oklch, var(--muted) 60%, transparent)",
            backgroundImage: isTrainedToday
              ? "linear-gradient(135deg, rgba(34,197,94,0.06), rgba(34,197,94,0.02))"
              : `linear-gradient(135deg, rgba(${_rtR},${_rtG},${_rtB},0.25), rgba(${_rtR},${_rtG},${_rtB},0.08))`,
            border: isTrainedToday
              ? "1px solid rgba(34,197,94,0.25)"
              : `1px solid rgba(${_rtR},${_rtG},${_rtB},0.4)`,
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <p
              className="text-[10px] font-bold uppercase tracking-widest"
              style={{ color: isTrainedToday ? "#22c55e" : _rtColor }}
            >
              {isTrainedToday ? "Trained Today" : "Recommended Today"}
            </p>
            <button
              onClick={onLogMood}
              className="flex items-center gap-1 active:scale-90 transition-transform flex-none"
              aria-label="Edit exercise readiness"
            >
              {moodLog ? (
                <>
                  <span className="text-base leading-none">
                    {({ drained: "😴", low: "😑", ok: "😐", good: "😊", pumped: "⚡" } as Record<string, string>)[moodLog.energyLevel] ?? "😐"}
                  </span>
                  {moodLog.soreMuscles.length > 0 && (
                    <span
                      className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full leading-none"
                      style={{ background: "rgba(255,106,26,0.18)", color: "#ff6a1a" }}
                    >
                      <TriangleAlertIcon className="w-2.5 h-2.5" /> {moodLog.soreMuscles.join(", ")}
                    </span>
                  )}
                </>
              ) : (
                <MessageCircle className="h-5 w-5" style={{ color: "#fbbf24" }} />
              )}
            </button>
          </div>
          <div className="flex items-center gap-3 min-w-0">
            {(() => {
              const Icon = getSessionIcon(displaySession.icon, displaySession.position);
              return <Icon className="h-8 w-8 flex-none" style={{ color: _rtColor }} />;
            })()}
            <div className="flex flex-col min-w-0">
              <p className="font-bold text-2xl leading-tight truncate">{displaySession.name}</p>
              {!isTrainedToday && recommendation?.session && (
                <Link
                  href={`/session-explain?sessionId=${encodeURIComponent(displaySession.id)}`}
                  className="text-xs text-muted-foreground/70 hover:text-muted-foreground mt-0.5 w-fit"
                  onClick={e => e.stopPropagation()}
                >
                  Why this? →
                </Link>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" /> ~{Math.round(displaySession.exercises.length * 9)} min
            </span>
            <span className="flex items-center gap-1">
              <Dumbbell className="h-3 w-3" /> {displaySession.exercises.length} exercises
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" /> Last: {lastTrained}
            </span>
          </div>
          {displaySessionPhase && (
            displaySessionPhase.blockComplete ? (
              <div className="flex items-center justify-between text-xs rounded-xl bg-muted/50 px-3 py-2">
                <span className="flex items-center gap-1 font-semibold"><PartyPopperIcon className="w-3.5 h-3.5" /> Block complete!</span>
                <a href="/config" className="font-medium" style={{ color: _rtColor }}>
                  Start new block →
                </a>
              </div>
            ) : displaySessionPhase.openEnded ? (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="font-medium">
                  {displaySessionPhase.phase.name} · Session {displaySessionPhase.phaseSessionNumber}
                </span>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-medium">
                    {displaySessionPhase.phase.name} · Cycle {displaySessionPhase.cycleInPhase}/
                    {displaySessionPhase.totalPhaseCycles}
                  </span>
                  {displaySessionPhase.approxWeeksRemaining != null &&
                    displaySessionPhase.approxWeeksRemaining > 0 && (
                      <span>~{displaySessionPhase.approxWeeksRemaining}w left</span>
                    )}
                </div>
                <div
                  className="w-full rounded-full h-1"
                  style={{ background: `rgba(${_rtR},${_rtG},${_rtB},0.14)` }}
                >
                  <div
                    className="h-1 rounded-full transition-all"
                    style={{
                      width: (() => {
                        const total = displaySessionPhase.totalPhaseCycles;
                        const done = displaySessionPhase.cycleInPhase - 1;
                        return `${Math.min(100, total > 0 ? (done / total) * 100 : 0).toFixed(1)}%`;
                      })(),
                      background: _rtColor,
                    }}
                  />
                </div>
              </div>
            )
          )}
          {isTrainedToday ? (
            <div className="flex items-center gap-2 rounded-xl border border-green-500/40 bg-green-500/10 px-4 py-2.5">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="7" stroke="#22c55e" strokeWidth="1.5" />
                <path
                  d="M5 8l2 2 4-4"
                  stroke="#22c55e"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="text-sm font-semibold text-green-500">Completed Today</span>
            </div>
          ) : recommendation?.deloadOrRestRecommended ? (
            <div className="flex flex-col gap-2">
              {recommendation.deloadStrength !== 'soft' && (
                <p className="text-xs text-muted-foreground text-center">
                  {recommendation.temperatureAlert
                    ? 'Body temp elevated'
                    : `${recommendation.consecutiveTrainingDays} sessions in a row`}
                </p>
              )}
              <DeloadExplanation recommendation={recommendation} />
              {/* Deload used to be a third choice here (Q-109-followup moved it). It now lives on
                  the pre-workout screen beside the session-length picker — the same place the rest
                  of the session's shape is decided, and the only screen where the AI-dynamic path
                  that honours it is actually in play. Home keeps the two choices that are about
                  whether to train at all. */}
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={onRestDay}
                  className="rounded-xl py-3 text-xs font-bold flex flex-col items-center gap-1.5 transition active:scale-95"
                  style={{
                    background: recommendation.deloadStrength === 'strong' ? 'rgba(99,102,241,0.20)' : 'rgba(99,102,241,0.12)',
                    border: '1px solid rgba(99,102,241,0.35)',
                    color: '#818cf8',
                  }}
                >
                  <BedDouble className="h-4 w-4" />
                  Rest
                </button>
                <button
                  onClick={() => displaySession && onStartWorkout(displaySession)}
                  className="rounded-xl py-3 text-xs font-bold flex flex-col items-center gap-1.5 transition active:scale-95"
                  style={{
                    opacity: recommendation.deloadStrength === 'strong' ? 0.55 : 0.8,
                    background: `rgba(${_rtR},${_rtG},${_rtB},0.12)`,
                    border: `1px solid rgba(${_rtR},${_rtG},${_rtB},0.25)`,
                    color: _rtColor,
                  }}
                >
                  <Dumbbell className="h-4 w-4" />
                  Full
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => onStartWorkout(displaySession)}
              className="w-full rounded-xl py-3 text-sm font-bold transition hover:opacity-90 active:scale-95 flex items-center justify-center gap-2"
              style={{ background: _rtColor, color: readableOn(_rtColor) }}
            >
              Start Workout{" "}
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path
                  d="M2.5 6.5h8M7.5 3.5l3 3-3 3"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

export const RecommendationCard = memo(RecommendationCardComponent);
