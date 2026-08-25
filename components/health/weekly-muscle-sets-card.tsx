"use client";

import { memo, useState } from "react";
import type { MuscleSetsEntry } from "@/app/api/weekly-muscle-sets/route";
import type { MuscleTonnageTrendResponse } from "@/app/api/muscle-tonnage-trend/route";
import { MuscleHeatmap } from "@/components/muscle-heatmap";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Sparkline } from "@/components/ui/sparkline";
import { cachedFetch, readCacheSync } from "@/lib/sqlite/cache";
import { volumeVerdict } from "@/components/health/volume-band";
import { TTL_LONG } from "@trainingai/shared/cache-ttl";

const MIN_TARGET = 10;
const MAX_TARGET = 20;

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function barColor(sets: number): string {
  if (sets >= 15) return "var(--color-brand)";
  if (sets >= MIN_TARGET) return "#22c55e";
  if (sets >= 6) return "#f59e0b";
  return "#ef4444";
}

interface Props {
  muscles: MuscleSetsEntry[];
  loading: boolean;
  title?: string;
  /** The active program's training goal, which SCALES the landmark table (Q-305). Absent → the
   *  generic 10–20 band, which is what every muscle used to be measured against. */
  trainingGoal?: string;
}

export const WeeklyMuscleSetsCard = memo(function WeeklyMuscleSetsCard({ muscles, loading, title = "{title}", trainingGoal }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [trend, setTrend] = useState<MuscleTonnageTrendResponse | null>(null);

  function toggleExpanded(muscle: string) {
    const next = expanded === muscle ? null : muscle;
    setExpanded(next);
    if (next && !trend) {
      const cached = readCacheSync<MuscleTonnageTrendResponse>("muscle-tonnage-trend");
      if (cached) setTrend(cached);
      cachedFetch<MuscleTonnageTrendResponse>("muscle-tonnage-trend", "/api/muscle-tonnage-trend", TTL_LONG, d => {
        if (d) setTrend(d);
      });
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl bg-muted/60 border border-border p-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">{title}</p>
        <div className="space-y-2.5">
          {[80, 60, 70, 50].map(w => (
            <Skeleton key={w} className="h-5" style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
    );
  }

  if (muscles.length === 0) {
    return (
      <div className="rounded-2xl bg-muted/60 border border-border p-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">{title}</p>
        <EmptyState title="No sets logged this week yet" />
      </div>
    );
  }

  // When the active program supplies per-muscle targets, show progress toward them; otherwise
  // fall back to the generic 10–20 band. (The builder's projection has no targets → generic.)
  const hasTargets = muscles.some(m => m.target != null);
  const maxSets = Math.max(...muscles.map(m => Math.max(m.sets, m.target ?? 0)), MAX_TARGET);
  // Q-305: with a goal, each muscle is measured against its OWN landmarks rather than one generic
  // band. A program target still wins — that is the user's own number, not a reference range.
  const useLandmarks = !hasTargets && trainingGoal != null;

  return (
    <div className="rounded-2xl bg-muted/60 border border-border p-4">
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{title}</p>
        <p className="text-[10px] text-muted-foreground">
          {hasTargets
            ? "vs your program target"
            : useLandmarks
              ? "vs MEV–MRV for your goal"
              : `Target: ${MIN_TARGET}–${MAX_TARGET} sets`}
        </p>
      </div>

      <MuscleHeatmap volumes={muscles} compact className="mb-3" />

      <div className="space-y-2">
        {muscles.map(({ muscle, sets, target }) => {
          const verdict = useLandmarks ? volumeVerdict(trainingGoal, muscle, sets) : null;
          const markSets = target ?? verdict?.mev ?? MIN_TARGET;
          const barPct = (sets / maxSets) * 100;
          const targetLinePct = (markSets / maxSets) * 100;
          const ceilingPct = verdict ? (verdict.mrv / maxSets) * 100 : null;
          const color = target != null
            ? (sets >= target ? "#22c55e" : sets >= target * 0.6 ? "#f59e0b" : "#ef4444")
            : verdict?.color ?? barColor(sets);
          const tonnageValues = trend?.muscles[muscle];
          return (
            <div key={muscle}>
              <div
                role="button"
                tabIndex={0}
                className="cursor-pointer"
                onClick={() => toggleExpanded(muscle)}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleExpanded(muscle); } }}
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-xs font-medium">{capitalize(muscle)}</span>
                  <span className="flex items-baseline gap-1.5">
                    {/* The band in words beside the colour: two of the four bands are red and they
                        mean opposite things — too little and too much. */}
                    {verdict && (
                      <span className="text-[10px] text-muted-foreground">{verdict.label}</span>
                    )}
                    <span className="text-xs tabular-nums font-semibold" style={{ color }}>
                      {sets}{target != null ? ` / ${target}` : ""} set{sets !== 1 ? "s" : ""}
                    </span>
                  </span>
                </div>
                <div className="relative h-2 rounded-full bg-muted overflow-visible">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${barPct}%`, background: color }}
                  />
                  {/* Target marker — the program's target, or MEV when the landmarks are in use. */}
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-0.5 h-3 rounded-full bg-muted-foreground/40"
                    style={{ left: `${targetLinePct}%` }}
                  />
                  {/* The ceiling. Without it a bar past MRV looks like a bar that is simply long. */}
                  {ceilingPct != null && ceilingPct <= 100 && (
                    <div
                      className="absolute top-1/2 -translate-y-1/2 w-0.5 h-3 rounded-full bg-muted-foreground/70"
                      style={{ left: `${ceilingPct}%` }}
                    />
                  )}
                </div>
              </div>
              {expanded === muscle && (
                <div className="mt-1.5 pl-1 flex items-center gap-2">
                  {tonnageValues && tonnageValues.length >= 2 ? (
                    <>
                      <Sparkline values={tonnageValues} width={100} height={28} color={color} responsive />
                      <span className="text-[10px] text-muted-foreground shrink-0">6-wk tonnage (kg)</span>
                    </>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">Loading trend…</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-muted-foreground mt-3">
        {hasTargets
          ? "Vertical line = your weekly target · Green = at or above target"
          : useLandmarks
            // The legend has to move with the bands. Left as-is it would keep describing a 10-set
            // minimum while the bars were coloured against per-muscle, goal-scaled landmarks —
            // a caption that disagrees with the chart above it is worse than no caption.
            ? "Lines = MEV (minimum effective) and MRV (maximum recoverable), scaled to your training goal."
            : `Vertical line = ${MIN_TARGET}-set minimum. Green = ${MIN_TARGET}–14 sets · Blue = 15+ sets.`}
      </p>
    </div>
  );
})
