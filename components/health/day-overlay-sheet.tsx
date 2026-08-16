"use client";

import dynamic from "next/dynamic";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { EmptyState } from "@/components/ui/empty-state";
import { cn, shortSessionName } from "@trainingai/shared/utils";
import { modalWeight, avgReps } from "@/components/workout/utils";
import { formatTime12h } from "@trainingai/shared/date-utils";
import { getPaletteEntry } from "@trainingai/shared/session-palette";
import { getActivityIcon } from "@trainingai/shared/constants/activity-icons";
import { hrEmptyMessage, type SessionHrData, type HrSessionState } from "@trainingai/shared/workout/hr-session-state";
import { ChevronDownIcon, ChevronRightIcon, PencilIcon, Trash2Icon, WeightIcon, FootprintsIcon, FlameIcon } from "lucide-react";
import type { DayLogResult, DayExercise } from "@/app/api/day-log/route";
import type { ActivityLog, ActivityType } from "@trainingai/shared/types";
import type { ProgramSession } from "@trainingai/shared/types/program";
import { aggregateHrRecoveryByExercise, formatRecoveryRate } from '@trainingai/shared/health/hr-recovery-by-exercise'

const HrRecoveryChart = dynamic(
  () => import('@/components/workout/hr-recovery-chart').then(m => ({ default: m.HrRecoveryChart })),
  { ssr: false, loading: () => <div className="h-24 animate-pulse rounded-xl bg-muted" /> },
);

export type DayOverlayState = {
  date: string;
  data: DayLogResult | null;
  loading: boolean;
  expanded: string | null;
} | null;

interface Props {
  dayOverlay: DayOverlayState;
  setDayOverlay: (updater: (prev: DayOverlayState) => DayOverlayState) => void;
  onClose: () => void;
  activeSessions: ProgramSession[];
  activityTypes: ActivityType[];
  sessionHrData: Record<string, HrSessionState>;
  loadSessionHr: (workoutSessionId: string) => void;
  onEditExercise: (payload: { ex: DayExercise; weights: number[]; reps: number[] }) => void;
  onDeleteExercise: (ex: DayExercise) => void;
  /** Tap an exercise name → open its history sheet (1RM trend + Heart & Recovery + session log). */
  onExerciseTap: (exerciseName: string) => void;
  onDeleteSession: (payload: { id: string; name: string }) => void;
  onSelectActivity: (log: ActivityLog) => void;
  onDeleteActivity: (log: ActivityLog) => void;
}

// The day-overlay sheet (tap a calendar/history day to see what happened) —
// extracted from health-content.tsx (Task 4.4) as a pure move, no behaviour change.
export function DayOverlaySheet({
  dayOverlay, setDayOverlay, onClose, activeSessions, activityTypes, sessionHrData,
  loadSessionHr, onEditExercise, onDeleteExercise, onExerciseTap, onDeleteSession, onSelectActivity, onDeleteActivity,
}: Props) {
  return (
    <Sheet open={dayOverlay !== null} onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent side="bottom" className="max-h-[85dvh] flex flex-col">
        <SheetHeader className="flex-none">
          <SheetTitle>
            {dayOverlay?.date
              ? (() => {
                  const [y, m, d] = dayOverlay.date.split("/").map(Number);
                  return new Date(y, m - 1, d).toLocaleDateString("en-AU", {
                    weekday: "long", day: "numeric", month: "long",
                  });
                })()
              : ""}
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 pb-2 space-y-3">
          {dayOverlay?.loading && (
            <div className="space-y-2 pt-2">
              {[1, 2, 3].map(i => <div key={i} className="h-12 animate-pulse rounded-xl bg-muted" />)}
            </div>
          )}
          {!dayOverlay?.loading && dayOverlay?.data && (() => {
            const { exercises: dayExercises, bodyMeta, workoutDurations, activityLogs } = dayOverlay.data;
            const sessionNames = Array.from(new Set(dayExercises.map(e => e.sessionName)));
            const iconByType = new Map(activityTypes.map(t => [t.id, t.icon]));
            return (
              <div className="content-fade-in space-y-3">
                {sessionNames.length > 0 && (
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-1">Exercise</p>
                )}
                {sessionNames.map(sessionName => {
                  const sessIdx = activeSessions.findIndex(s => s.name === sessionName);
                  const palette = getPaletteEntry(sessIdx >= 0 ? sessIdx : 0);
                  const sessExercises = dayExercises.filter(e => e.sessionName === sessionName);
                  const expandKey = `workout-${sessionName}`;
                  const isExpanded = dayOverlay.expanded === expandKey;
                  const workoutSessionId = sessExercises[0]?.workoutSessionId ?? null;
                  const hrState = workoutSessionId ? sessionHrData[workoutSessionId] : undefined;
                  return (
                    <div key={sessionName} className={cn("rounded-xl border overflow-hidden", palette.bgClass)}>
                      <div
                        role="button"
                        tabIndex={0}
                        className="w-full flex items-center justify-between px-4 py-3 text-left"
                        onClick={() => {
                          const expanding = !isExpanded;
                          setDayOverlay(prev => prev ? { ...prev, expanded: expanding ? expandKey : null } : prev);
                          if (expanding && workoutSessionId) loadSessionHr(workoutSessionId);
                        }}
                        onKeyDown={e => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            const expanding = !isExpanded;
                            setDayOverlay(prev => prev ? { ...prev, expanded: expanding ? expandKey : null } : prev);
                            if (expanding && workoutSessionId) loadSessionHr(workoutSessionId);
                          }
                        }}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-lg">{palette.emoji}</span>
                          <div className="min-w-0">
                            <p className={cn("text-sm font-bold truncate", palette.textClass)}>{shortSessionName(sessionName)}</p>
                            {workoutDurations[sessionName] && (
                              <p className="text-xs text-muted-foreground tabular-nums">
                                {workoutDurations[sessionName]!.start} → {workoutDurations[sessionName]!.end} · {workoutDurations[sessionName]!.minutes} min
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 flex-none">
                          {workoutSessionId && (
                            <>
                              <button
                                aria-label="Edit session"
                                onClick={e => {
                                  e.stopPropagation();
                                  if (!isExpanded) {
                                    setDayOverlay(prev => prev ? { ...prev, expanded: expandKey } : prev);
                                    if (workoutSessionId) loadSessionHr(workoutSessionId);
                                  }
                                }}
                                className="rounded p-1.5 hover:bg-muted text-muted-foreground"
                              >
                                <PencilIcon className="h-4 w-4" />
                              </button>
                              <button
                                aria-label="Delete session"
                                onClick={e => {
                                  e.stopPropagation();
                                  onDeleteSession({ id: workoutSessionId, name: shortSessionName(sessionName) });
                                }}
                                className="rounded p-1.5 hover:bg-muted text-muted-foreground"
                              >
                                <Trash2Icon className="h-4 w-4" />
                              </button>
                            </>
                          )}
                          <ChevronDownIcon className={cn("h-4 w-4 text-muted-foreground transition-transform", isExpanded && "rotate-180")} />
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="px-4 pb-3 space-y-1 border-t border-border/40">
                          {sessExercises.map(ex => (
                            <div key={ex.exerciseLogId} className="flex items-center gap-2 py-1.5">
                              <button
                                type="button"
                                onClick={() => onExerciseTap(ex.name)}
                                className="flex flex-1 min-w-0 items-center gap-1 text-left rounded hover:bg-muted/50"
                                aria-label={`${ex.name} history and heart-rate trends`}
                              >
                                <span className="flex-1 min-w-0">
                                  <span className="text-sm font-medium truncate block">{ex.name}</span>
                                  <span className="text-xs text-muted-foreground tabular-nums">
                                    {(() => {
                                      const reps = avgReps(ex.reps);
                                      const weight = modalWeight(ex.setWeights) ?? ex.weightKg;
                                      const setCount = ex.reps.length;
                                      if (reps == null) return `${setCount} set${setCount !== 1 ? "s" : ""}`;
                                      const load = weight != null ? `${reps} × ${weight}kg` : `${reps} reps`;
                                      return `${setCount} × ${load}`;
                                    })()}
                                  </span>
                                </span>
                                <ChevronRightIcon className="h-4 w-4 text-muted-foreground flex-none" />
                              </button>
                              <button aria-label="Edit exercise" onClick={() => onEditExercise({ ex, weights: [...ex.setWeights], reps: [...ex.reps] })} className="rounded p-1 hover:bg-muted text-muted-foreground flex-none">
                                <PencilIcon className="h-3.5 w-3.5" />
                              </button>
                              <button aria-label="Delete exercise" onClick={() => onDeleteExercise(ex)} className="rounded p-1 hover:bg-muted text-muted-foreground flex-none">
                                <Trash2Icon className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                          {/* HR Recovery for this session */}
                          <div className="mt-2 pt-2 border-t border-border/30">
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">HR Recovery</p>
                            {hrState === 'loading' && <div className="h-24 animate-pulse rounded-xl bg-muted" />}
                            {(hrState === 'none' || hrState === 'incomplete') && <p className="text-[10px] text-muted-foreground">{hrEmptyMessage(hrState)}</p>}
                            {hrState && hrState !== 'loading' && hrState !== 'none' && hrState !== 'incomplete' && (hrState as SessionHrData).hasData && (
                              <>
                                <HrRecoveryChart
                                  readings={(hrState as SessionHrData).readings.map(r => ({ timestamp: new Date(r.timestamp), bpm: r.bpm }))}
                                  sets={(hrState as SessionHrData).setStats.map(s => ({ exerciseName: s.exerciseName, setNumber: s.setNumber, loggedAt: s.loggedAt ? new Date(s.loggedAt) : null }))}
                                  sessionStartedAt={new Date((hrState as SessionHrData).startedAt)}
                                />
                                {/* Same per-exercise aggregation as the done screen — one
                                    helper, so the two surfaces can't drift. */}
                                <div className="space-y-0.5 mt-2">
                                  {aggregateHrRecoveryByExercise((hrState as SessionHrData).setStats).map(ex => (
                                    <div key={ex.exerciseName} className="flex items-center justify-between text-[10px]">
                                      <span className="text-muted-foreground truncate max-w-[55%]">
                                        {ex.exerciseName}
                                        <span className="opacity-60"> · {ex.sampleCount}/{ex.totalSets} sets</span>
                                      </span>
                                      <span className={ex.adequate === false ? 'text-red-600 dark:text-red-400' : ex.adequate ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}>
                                        {formatRecoveryRate(ex.medianHrr1)}{ex.adequate === true ? ' ✓' : ex.adequate === false ? ' ✗' : ''}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {activityLogs.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-1">Activities</p>
                    {activityLogs.map(log => {
                      const Icon = getActivityIcon(iconByType.get(log.activityType) ?? 'DotsThreeCircle');
                      return (
                        <div key={log.id} className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3">
                          <button
                            type="button"
                            onClick={() => onSelectActivity(log)}
                            className="flex flex-1 items-center gap-3 min-w-0 text-left"
                          >
                            <Icon size={20} className="flex-none text-muted-foreground" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{log.title}</p>
                              <p className="text-xs text-muted-foreground tabular-nums">
                                {[
                                  log.startTime ? formatTime12h(log.startTime) : null,
                                  log.durationMin != null ? `${Math.round(log.durationMin)} min` : null,
                                  log.distanceKm != null ? `${Number(log.distanceKm).toFixed(2)} km` : null,
                                  log.caloriesBurned != null ? `${Math.round(log.caloriesBurned)} kcal` : null,
                                ].filter(Boolean).join(" · ")}
                              </p>
                            </div>
                          </button>
                          <button onClick={() => onDeleteActivity(log)} className="rounded p-1 hover:bg-muted text-muted-foreground flex-none">
                            <Trash2Icon className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {bodyMeta && (bodyMeta.calories != null || bodyMeta.weightKg != null || bodyMeta.steps != null) && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-1">Body Data</p>
                    <div className="grid grid-cols-3 gap-2">
                      {bodyMeta.weightKg != null && (
                        <div className="flex flex-col items-center rounded-xl bg-muted px-2 py-2 text-center">
                          <WeightIcon className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm font-bold tabular-nums">{bodyMeta.weightKg} kg</span>
                          <span className="text-[10px] text-muted-foreground">Weight</span>
                        </div>
                      )}
                      {bodyMeta.steps != null && (
                        <div className="flex flex-col items-center rounded-xl bg-muted px-2 py-2 text-center">
                          <FootprintsIcon className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm font-bold tabular-nums">{bodyMeta.steps.toLocaleString()}</span>
                          <span className="text-[10px] text-muted-foreground">Steps</span>
                        </div>
                      )}
                      {bodyMeta.calories != null && (
                        <div className="flex flex-col items-center rounded-xl bg-muted px-2 py-2 text-center">
                          <FlameIcon className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm font-bold tabular-nums">{bodyMeta.calories}</span>
                          <span className="text-[10px] text-muted-foreground">kcal</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {dayExercises.length === 0 && activityLogs.length === 0 && !bodyMeta && (
                  <EmptyState title="No data for this day." />
                )}
              </div>
            );
          })()}
        </div>
      </SheetContent>
    </Sheet>
  );
}
