"use client";

import { useEffect, useState } from "react";
import { useUserTimezone } from "@/components/shell/user-timezone-provider";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { ExerciseHistoryEntry, ExerciseHistoryResponse } from "@/app/api/exercise-history/route";
import { displayOneRmSeries, oneRmLabel, oneRmUnit } from "@trainingai/shared/1rm";
import type { MuscleAssignment } from "@trainingai/shared/types/program";
import { MuscleHeatmap } from "@/components/muscle-heatmap";
import { ExerciseHrTrendCard } from "@/components/workout/exercise-hr-trend-card";
import { cachedFetch } from "@/lib/sqlite/cache";
import { EXERCISE_HISTORY_TTL } from '@trainingai/shared/cache-ttl';
import { getLocalStore } from "@/lib/local-store";
import { todayInTz, shiftDateStr } from "@trainingai/shared/date-utils";
import { rpeTrendFromSets } from "@trainingai/shared/ai-periodization/expected-rpe";

interface ExerciseHistorySheetProps {
  exerciseName: string | null;
  muscles?: MuscleAssignment[];
  userId?: string;
  onClose: () => void;
}

export function ExerciseHistorySheet({ exerciseName, muscles = [], userId, onClose }: ExerciseHistorySheetProps) {
  const tz = useUserTimezone();
  const [entries, setEntries] = useState<ExerciseHistoryEntry[]>([]);
  const [exerciseType, setExerciseType] = useState<'weighted' | 'bodyweight'>('weighted');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!exerciseName) { setEntries([]); setExerciseType('weighted'); return; }
    let cancelled = false;
    setLoading(true);

    // Seed from local store before the network resolves
    const store = userId ? getLocalStore(userId) : null;
    if (store) {
      const cutoffStr = shiftDateStr(todayInTz(tz), -90);
      store.getWorkoutHistory(cutoffStr).then(history => {
        if (cancelled) return;
        const localEntries: ExerciseHistoryEntry[] = [];
        for (const { session, exerciseLogs } of history) {
          for (const el of exerciseLogs) {
            if (el.exerciseName !== exerciseName) continue;
            const activeSets = el.sets.filter(s => !s.deletedAt);
            if (activeSets.length === 0) continue;
            localEntries.push({
              date: el.loggedAt,
              sessionName: session.sessionName,
              sets: activeSets.length,
              weightKg: activeSets.map(s => s.weightKg),
              reps: activeSets.map(s => s.reps),
              estimated1rm: el.estimated1rm,
              volume: el.volume,
              isDeload: false,
              rpeDelta: rpeTrendFromSets(activeSets.map(s => ({ rpe: s.rpe, intensityPct: s.intensityPct, reps: s.reps })))?.delta ?? null,
            });
          }
        }
        localEntries.sort((a, b) => b.date.localeCompare(a.date));
        if (localEntries.length > 0 && !cancelled) {
          setEntries(localEntries);
          setLoading(false);
        }
      }).catch(() => {});
    }

    cachedFetch<ExerciseHistoryResponse>(
      `exercise-history:${exerciseName}`,
      `/api/exercise-history?name=${encodeURIComponent(exerciseName)}`,
      EXERCISE_HISTORY_TTL,
      d => {
        if (cancelled) return;
        setEntries(d?.entries ?? []);
        setExerciseType(d?.exerciseType ?? 'weighted');
        setLoading(false);
      },
    ).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [exerciseName, userId, tz]);

  // Bodyweight estimates are BW_REF-relative, so the whole panel — stat, chart and delta —
  // works in reps (audit finding Q-12). Converting up front keeps the chart and the numbers
  // above it on one basis.
  const unit = oneRmUnit(exerciseType);
  const unitSuffix = unit === 'RM' ? 'reps' : 'kg';
  const rms = displayOneRmSeries(
    entries.map(e => e.estimated1rm).filter((v): v is number => v != null && v > 0),
    exerciseType,
  );
  const hasChart = rms.length >= 2;
  const maxRm = hasChart ? Math.max(...rms) : 0;
  const minRm = hasChart ? Math.min(...rms) : 0;
  const range = maxRm - minRm || 1;
  const W = 280; const H = 60; const PAD = 4;
  const chartPoints = rms
    .slice()
    .reverse()
    .map((v, i, arr) => {
      const x = PAD + (i / Math.max(arr.length - 1, 1)) * (W - PAD * 2);
      const y = H - PAD - ((v - minRm) / range) * (H - PAD * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
  const pointsStr = chartPoints.join(" ");

  const best1rm = rms.length > 0 ? Math.max(...rms) : null;
  const latest1rm = rms[0] ?? null;
  const gainThisMonth = rms.length >= 2
    ? parseFloat((rms[0] - rms[rms.length - 1]).toFixed(1))
    : null;

  const muscleActivations = muscles.map(m => ({ muscle: m.muscle, role: m.role }));
  const mainMuscles = muscles.filter(m => m.role === "main");
  const secondaryMuscles = muscles.filter(m => m.role === "secondary");

  return (
    <Sheet open={!!exerciseName} onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent side="bottom" className="max-h-[90dvh] flex flex-col">
        <SheetHeader className="flex-none px-1">
          <SheetTitle>{exerciseName}</SheetTitle>
          <p className="text-xs text-muted-foreground">
            {entries.length} sessions
            {mainMuscles.length > 0 && ` · ${mainMuscles.map(m => m.muscle).join(", ")}`}
          </p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-1 space-y-4 pb-2">
          {loading && (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <div key={i} className="h-10 animate-pulse rounded-xl bg-muted" />)}
            </div>
          )}

          {!loading && entries.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">No history in the last 90 days.</p>
          )}

          {/* ── Key stats ── */}
          {!loading && (latest1rm != null || best1rm != null) && (
            <div className="flex gap-2">
              <div className="flex-1 rounded-xl border p-3 text-center"
                style={{ background: "color-mix(in oklch, var(--color-brand) 7%, transparent)", borderColor: "color-mix(in oklch, var(--color-brand) 14%, transparent)" }}>
                <p className="text-xl font-bold tabular-nums" style={{ color: "var(--color-brand)" }}>
                  {latest1rm ?? best1rm}
                  <span className="text-[10px] font-normal text-muted-foreground ml-1">{unitSuffix}</span>
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{oneRmLabel(exerciseType)}</p>
              </div>
              {gainThisMonth != null && (
                <div className="flex-1 rounded-xl bg-muted/60 border border-border p-3 text-center">
                  <p className="text-xl font-bold tabular-nums" style={{ color: gainThisMonth >= 0 ? "var(--color-brand)" : "#ef4444" }}>
                    {gainThisMonth >= 0 ? "+" : ""}{gainThisMonth}
                    <span className="text-[10px] font-normal text-muted-foreground ml-1">{unitSuffix}</span>
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Progress</p>
                </div>
              )}
              <div className="flex-1 rounded-xl bg-muted/60 border border-border p-3 text-center">
                <p className="text-xl font-bold tabular-nums">{entries.length}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Sessions</p>
              </div>
            </div>
          )}

          {/* ── 1RM Trend ── */}
          {hasChart && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">1RM Trend</p>
              <div className="rounded-xl bg-muted/40 border border-border p-3">
                <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="overflow-visible">
                  <defs>
                    <linearGradient id="rm-fill-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-brand)" stopOpacity="0.28" />
                      <stop offset="100%" stopColor="var(--color-brand)" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {/* Grid lines */}
                  {[0, H / 2, H].map(y => (
                    <line key={y} x1="0" y1={y} x2={W} y2={y} stroke="currentColor" strokeOpacity="0.04" strokeWidth="1"/>
                  ))}
                  <polygon
                    points={`${PAD},${H} ${pointsStr} ${W - PAD},${H}`}
                    fill="url(#rm-fill-grad)"
                  />
                  <polyline
                    points={pointsStr}
                    fill="none"
                    stroke="var(--color-brand)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {/* Dots */}
                  {chartPoints.map((pt, i) => {
                    const [x, y] = pt.split(",").map(Number);
                    const isLast = i === chartPoints.length - 1;
                    return (
                      <g key={i}>
                        <circle cx={x} cy={y} r={isLast ? 4 : 2.5} fill="var(--color-brand)" opacity={isLast ? 1 : 0.45}/>
                        {isLast && <circle cx={x} cy={y} r="7" fill="none" stroke="var(--color-brand)" strokeOpacity="0.28" strokeWidth="1"/>}
                      </g>
                    );
                  })}
                </svg>
                <div className="flex justify-between mt-1">
                  <span className="text-[9px] text-muted-foreground">{entries[entries.length - 1]?.date?.slice(0, 10) ?? "—"}</span>
                  <span className="text-[9px] text-muted-foreground">{entries[0]?.date?.slice(0, 10) ?? "—"}</span>
                </div>
              </div>
            </div>
          )}

          {/* ── Heart & Recovery (per-set HR trend) ── */}
          {exerciseName && <ExerciseHrTrendCard exerciseName={exerciseName} />}

          {/* ── Session Log ── */}
          {!loading && entries.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Session Log</p>
              <div className="rounded-xl bg-muted/40 border border-border overflow-hidden">
                {/* Header */}
                <div className="grid grid-cols-[56px_1fr_52px_44px] px-3 py-2 border-b border-border/60">
                  {["Date", "Weight", "Sets", "Vol"].map(h => (
                    <p key={h} className="text-[9px] text-muted-foreground">{h}</p>
                  ))}
                </div>
                {entries.map((entry, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[56px_1fr_52px_44px] px-3 py-2 border-b border-border/30 last:border-0"
                    style={i === 0 ? { background: "color-mix(in oklch, var(--color-brand) 5%, transparent)" } : {}}
                  >
                    <p className="text-xs text-muted-foreground">{entry.date.slice(5, 10).replace("-", " ")}</p>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <p className="text-xs font-bold tabular-nums" style={i === 0 ? { color: "var(--color-brand)" } : {}}>
                        {entry.weightKg[0] == null
                          ? "—"
                          : unit === "RM"
                            ? (entry.weightKg[0] > 0 ? `BW +${entry.weightKg[0]} kg` : "BW")
                            : `${entry.weightKg[0]} kg`}
                      </p>
                      {entry.isDeload && (
                        <span
                          className="flex-none text-[9px] font-semibold rounded px-1.5 py-0.5 leading-none"
                          style={{
                            background: "color-mix(in oklch, var(--accent-amber) 15%, transparent)",
                            color: "var(--accent-amber)",
                          }}
                        >
                          Deload
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {entry.sets}×{entry.reps[0] ?? "?"}
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums text-right">
                      {entry.volume != null ? Math.round(entry.volume) : "—"}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Muscle Map ── */}
          {muscleActivations.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Primary Muscles</p>
              <div className="rounded-xl bg-muted/40 border border-border p-3 flex items-center gap-4">
                <MuscleHeatmap assignments={muscleActivations} className="w-16 flex-none" />
                <div>
                  <div className="flex flex-wrap gap-1.5">
                    {mainMuscles.map(m => (
                      <span key={m.muscle} className="text-[11px] rounded-lg px-2.5 py-1 font-medium"
                        style={{
                          background: "color-mix(in oklch, var(--color-brand) 10%, transparent)",
                          color: "var(--color-brand)",
                          border: "1px solid color-mix(in oklch, var(--color-brand) 22%, transparent)",
                        }}>
                        {m.muscle}
                      </span>
                    ))}
                    {secondaryMuscles.map(m => (
                      <span key={m.muscle} className="text-[11px] rounded-lg border border-border bg-muted px-2.5 py-1 text-muted-foreground font-medium">
                        {m.muscle}
                      </span>
                    ))}
                  </div>
                  {mainMuscles.length > 0 && (
                    <p className="text-[10px] text-muted-foreground mt-2">
                      Compound · {mainMuscles[0]?.muscle} pattern
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
