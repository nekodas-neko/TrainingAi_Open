"use client";

import { memo, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type { StrengthTrendEntry } from "@/app/api/strength-trend/route";
import { Sparkline } from "@/components/ui/sparkline";
import { projectRm } from "@trainingai/shared/health/strength-projection";
import { displayOneRm, displayOneRmSeries, oneRmUnit } from "@trainingai/shared/1rm";
import { formatDayShort } from "@trainingai/shared/date-utils";

interface Props {
  exercises: StrengthTrendEntry[];
  loading: boolean;
}

function gainColor(gainPct: number | null): string {
  if (gainPct == null) return "var(--color-muted-foreground)";
  if (gainPct > 0) return "#22c55e";
  if (gainPct < 0) return "#ef4444";
  return "#f59e0b";
}

export const StrengthTrendCard = memo(function StrengthTrendCard({ exercises, loading }: Props) {
  const [idx, setIdx] = useState(0);

  if (loading) {
    return (
      <div className="rounded-2xl bg-muted/60 border border-border p-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Strength Trend</p>
        <div className="h-28 rounded-xl bg-muted animate-pulse" />
      </div>
    );
  }

  if (exercises.length === 0) return null;

  const ex = exercises[Math.min(idx, exercises.length - 1)];
  // Bodyweight `rm` values are BW_REF-relative, so the whole card renders in reps.
  const unit = oneRmUnit(ex.exerciseType);
  const unitSuffix = unit === "RM" ? " reps" : " kg";
  const values = displayOneRmSeries(ex.history.map(h => h.rm), ex.exerciseType);
  // `new Date(isoDay + 'T00:00:00Z')` is UTC midnight, so west of UTC it rendered the previous
  // day — correct on a Brisbane device, off by one everywhere behind UTC (the Q-130 class).
  // formatDayShort constructs component-wise and is the one place this format lives.
  const labels = ex.history.map(h => formatDayShort(h.date));

  const color = gainColor(ex.gainPct);
  const brandColor = "var(--color-brand)";
  const projection = ex.history.length >= 4 ? projectRm(ex.history) : null;

  return (
    <div className="rounded-2xl bg-muted/60 border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Strength Trend</p>
        <p className="text-[10px] text-muted-foreground">90 days</p>
      </div>

      {/* Exercise navigator */}
      <div className="flex items-center gap-2 mb-3">
        <button
          type="button"
          onClick={() => setIdx(i => Math.max(0, i - 1))}
          disabled={idx === 0}
          aria-label="Previous exercise"
          className="flex-none p-1 rounded-md text-muted-foreground disabled:opacity-30 hover:text-foreground transition-colors"
        >
          <ChevronLeftIcon className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-0 text-center">
          <p className="text-sm font-semibold truncate">{ex.name}</p>
          <div className="flex items-center justify-center gap-2 mt-0.5">
            <span className="text-lg font-black tabular-nums" style={{ color: brandColor }}>
              {unit === "RM" ? displayOneRm(ex.currentRm, ex.exerciseType).text : `${ex.currentRm.toFixed(1)} kg`}
            </span>
            {ex.gainPct != null && (
              <span className="text-xs font-semibold tabular-nums" style={{ color }}>
                {ex.gainPct > 0 ? "+" : ""}{ex.gainPct}%
              </span>
            )}
          </div>
          {projection && (
            <div className="flex items-center justify-center gap-1.5 mt-1">
              <span className="text-[10px] text-muted-foreground">
                → ~{displayOneRm(projection.projectedRm, ex.exerciseType).value}{unitSuffix} in 30d
              </span>
              {projection.plateau && (
                <span className="text-[9px] font-semibold rounded-full px-1.5 py-0.5 bg-amber-500/15 text-amber-500">
                  Plateau
                </span>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setIdx(i => Math.min(exercises.length - 1, i + 1))}
          disabled={idx >= exercises.length - 1}
          aria-label="Next exercise"
          className="flex-none p-1 rounded-md text-muted-foreground disabled:opacity-30 hover:text-foreground transition-colors"
        >
          <ChevronRightIcon className="h-4 w-4" />
        </button>
      </div>

      <Sparkline values={values} width={280} height={64} color={brandColor} fill responsive />

      <div className="flex justify-between text-[10px] text-muted-foreground mt-2">
        <span>90d low: {values.length > 0 ? (unit === "RM" ? Math.min(...values) : Math.min(...values).toFixed(1)) : '—'}{unitSuffix}</span>
        <span>Peak: {unit === "RM" ? displayOneRm(ex.peakRm, ex.exerciseType).value : ex.peakRm.toFixed(1)}{unitSuffix}</span>
      </div>

      {/* Dot pagination */}
      {exercises.length > 1 && (
        <div className="flex justify-center items-center gap-[18px] mt-3">
          {exercises.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setIdx(i)}
              aria-label={`Go to ${exercises[i].name}`}
              // Not CarouselDots: this indicator is a horizontal pill (16×1.5) rather than the
              // vertical dot that component draws. It takes the same touch area, though.
              className="tap-dense tap-target-dot h-1.5 rounded-full transition-all"
              style={{
                width: i === idx ? "16px" : "6px",
                background: i === idx ? "var(--color-brand)" : "var(--color-muted-foreground)",
                opacity: i === idx ? 1 : 0.35,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
})
