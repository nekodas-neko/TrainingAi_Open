"use client";

import { memo, useEffect, useState } from "react";
import { HeartPulse, Info, TriangleAlert } from "lucide-react";
import { Sparkline } from "@/components/ui/sparkline";
import { cachedFetch, readCacheSync } from "@/lib/sqlite/cache";
import { EXERCISE_HR_TREND_TTL } from "@trainingai/shared/cache-ttl";
import type { ExerciseHrTrend } from "@trainingai/shared/workout/exercise-hr-trend";
import { formatHrChange as hrChange } from "@trainingai/shared/health/hr-change-display";

// Heart & Recovery card for the exercise-history sheet (plan 2026-07-21-per-set-hr-metrics).
// Reads the per-exercise HR trend (per-set snapshots rolled up server-side) and shows peak HR + the
// beat-drop-during-rest ("recovery") over time, plus a per-%1RM breakdown. Cache-seeded (no skeleton),
// memoised. Renders nothing until there's at least some covered HR data for the exercise.
//
// IMPORTANT: the recovery/adequacy signal is CARDIOVASCULAR only — it says nothing about CNS or
// neuromuscular readiness. The disclaimer below is load-bearing, not decoration.

interface Props {
  exerciseName: string;
}

function ExerciseHrTrendCardInner({ exerciseName }: Props) {
  const [trend, setTrend] = useState<ExerciseHrTrend | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setTrend(readCacheSync<ExerciseHrTrend>(`exercise-hr-trend:${exerciseName}`));
    cachedFetch<ExerciseHrTrend>(
      `exercise-hr-trend:${exerciseName}`,
      `/api/workout/exercise-hr-trend?exerciseName=${encodeURIComponent(exerciseName)}`,
      EXERCISE_HR_TREND_TTL,
      d => { if (!cancelled) setTrend(d ?? null); },
      // Q-499: without `onError` a non-ok response leaves `trend` null, which this card already
      // uses to mean "no HR recorded for this exercise yet" — so a rate limit reads as an honest
      // absence and the card just is not there.
      { onError: () => { if (!cancelled) setFailed(true); } },
    );
    return () => { cancelled = true; };
  }, [exerciseName]);

  if (failed && !trend) {
    return (
      <div className="rounded-xl border border-border bg-muted/20 p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <TriangleAlert className="h-4 w-4 flex-none" aria-hidden />
          Couldn&rsquo;t load heart-rate history — pull to refresh.
        </div>
      </div>
    );
  }
  if (!trend || trend.coveredSets === 0) return null;

  const peakSeries = trend.sessions.map(s => s.avgPeakBpm).filter((v): v is number => v != null);
  const dropSeries = trend.sessions.map(s => s.avgDrop60).filter((v): v is number => v != null);
  const latest = [...trend.sessions].reverse().find(s => s.avgPeakBpm != null || s.avgDrop60 != null);
  const recovery = hrChange(latest?.avgDrop60);

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <HeartPulse className="h-3 w-3 text-muted-foreground" />
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Heart &amp; Recovery</p>
      </div>

      {/* Key stats */}
      <div className="flex gap-2">
        <div className="flex-1 rounded-xl border border-border bg-muted/40 p-3 text-center">
          <p className="text-xl font-bold tabular-nums" style={{ color: "var(--color-brand)" }}>
            {latest?.avgPeakBpm ?? "—"}
            <span className="text-[10px] font-normal text-muted-foreground ml-1">bpm</span>
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Peak HR / set</p>
        </div>
        <div className="flex-1 rounded-xl border border-border bg-muted/40 p-3 text-center">
          <p className="text-xl font-bold tabular-nums" style={recovery.color ? { color: recovery.color } : undefined}>
            {recovery.text}
            <span className="text-[10px] font-normal text-muted-foreground ml-1">bpm</span>
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">HR settled in 60s rest</p>
        </div>
        {latest?.avgPctHrrAtRestEnd != null && (
          <div className="flex-1 rounded-xl border border-border bg-muted/40 p-3 text-center">
            <p className="text-xl font-bold tabular-nums">{latest.avgPctHrrAtRestEnd}
              <span className="text-[10px] font-normal text-muted-foreground ml-1">%</span>
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Recovered by next set</p>
          </div>
        )}
      </div>

      {/* Direction legend — makes the ↓/↑ arrows self-explanatory */}
      <p className="text-[9px] text-muted-foreground mt-1.5 text-center leading-tight">
        <span style={{ color: "var(--accent-cyan)" }}>↓</span> HR fell during rest (recovering) ·{" "}
        <span style={{ color: "var(--accent-amber)" }}>↑</span> still climbing
      </p>

      {/* Recovery curve — how far HR has dropped at each point in the rest (2m needs a ≥2min rest) */}
      {latest && (latest.avgDrop30 != null || latest.avgDrop90 != null || latest.avgDrop120 != null) && (
        <div className="mt-2 rounded-xl bg-muted/40 border border-border px-3 py-2">
          <p className="text-[9px] text-muted-foreground mb-1.5">Recovery curve · HR drop into rest</p>
          <div className="flex justify-around">
            {([["30s", latest.avgDrop30], ["1m", latest.avgDrop60], ["90s", latest.avgDrop90], ["2m", latest.avgDrop120]] as const).map(([label, val]) => {
              const c = hrChange(val);
              return (
                <div key={label} className="text-center">
                  <p className="text-sm font-bold tabular-nums" style={c.color ? { color: c.color } : undefined}>{c.text}</p>
                  <p className="text-[9px] text-muted-foreground mt-0.5">{label}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Trends over time */}
      {(peakSeries.length >= 2 || dropSeries.length >= 2) && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {peakSeries.length >= 2 && (
            <div className="rounded-xl bg-muted/40 border border-border p-3">
              <p className="text-[9px] text-muted-foreground mb-1">Peak HR each session</p>
              <Sparkline values={peakSeries} responsive fill color="var(--color-brand)" height={36} />
            </div>
          )}
          {dropSeries.length >= 2 && (
            <div className="rounded-xl bg-muted/40 border border-border p-3">
              <p className="text-[9px] text-muted-foreground mb-1">HR settled in 60s rest</p>
              <Sparkline values={dropSeries} responsive fill color="var(--accent-cyan)" height={36} />
            </div>
          )}
        </div>
      )}

      {/* Per-%1RM breakdown */}
      {trend.byIntensity.length > 0 && (
        <div className="mt-2 rounded-xl bg-muted/40 border border-border overflow-hidden">
          <div className="grid grid-cols-[64px_1fr_1fr] px-3 py-2 border-b border-border/60">
            {["%1RM", "Settled/60s", "Peak HR"].map(h => (
              <p key={h} className="text-[9px] text-muted-foreground">{h}</p>
            ))}
          </div>
          {trend.byIntensity.map(b => {
            const chg = hrChange(b.avgDrop60);
            return (
              <div key={b.label} className="grid grid-cols-[64px_1fr_1fr] px-3 py-2 border-b border-border/30 last:border-0">
                <p className="text-xs font-medium tabular-nums">{b.label}</p>
                <p className="text-xs tabular-nums" style={chg.color ? { color: chg.color } : undefined}>
                  {chg.text}
                  <span className="text-[9px] ml-1 text-muted-foreground">×{b.n}</span>
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">{b.avgPeakBpm ?? "—"}<span className="text-[9px] ml-0.5">bpm</span></p>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-start gap-1 mt-1.5">
        <Info className="h-2.5 w-2.5 text-muted-foreground mt-0.5 flex-none" />
        <p className="text-[9px] text-muted-foreground leading-tight">
          A bigger drop = your heart settles faster between sets (better cardio fitness). This is
          cardiovascular recovery only — not CNS or muscular readiness.
        </p>
      </div>
    </div>
  );
}

export const ExerciseHrTrendCard = memo(ExerciseHrTrendCardInner);
