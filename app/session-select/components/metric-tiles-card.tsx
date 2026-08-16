"use client";

import { memo } from "react";
import type { LucideIcon } from "lucide-react";
import { accentCardStyle } from "@trainingai/shared/utils";
import type { BodyMetaRow } from "@/app/api/body-metadata/route";

type MetaKey = "weightKg" | "steps" | "calories" | "protein" | "carb" | "fat" | "distanceKm" | "waterIntake";

interface WidgetDef {
  key: MetaKey;
  label: string;
  unit: string;
  icon: LucideIcon;
  color: string;
}

interface MetricTilesCardProps {
  visibleDefs: WidgetDef[];
  metaToday: BodyMetaRow | null;
  metaRecent: BodyMetaRow[];
  metaLoading: boolean;
  pillColors: Record<string, string>;
  weekToDate: { steps: number; calories: number; waterMl: number } | null;
  waterGoal: number | null;
  waterGoalType: "daily" | "weekly";
  onTileClick: () => void;
  onLogTile: (def: WidgetDef) => void;
  onLogWater: () => void;
}

function MetricTilesCardComponent({
  visibleDefs,
  metaToday,
  metaRecent,
  metaLoading,
  pillColors,
  weekToDate,
  waterGoal,
  waterGoalType,
  onTileClick,
  onLogTile,
  onLogWater,
}: MetricTilesCardProps) {
  if (visibleDefs.length === 0) return null;

  const dailyReset: MetaKey[] = ["steps", "calories", "distanceKm", "waterIntake"];

  return (
    <div className="px-4 pb-3">
      <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        {visibleDefs.map(def => {
          const todayVal =
            def.key === "waterIntake"
              ? (metaToday as (typeof metaToday & { waterMl?: number | null }) | null)?.waterMl ??
                undefined
              : metaToday?.[def.key as Exclude<MetaKey, "waterIntake">];

          const recentVal =
            !dailyReset.includes(def.key) && todayVal == null
              ? (metaRecent.find(r => r[def.key as keyof typeof r] != null)?.[
                  def.key as keyof BodyMetaRow
                ] ?? null)
              : null;

          const val = todayVal ?? recentVal;
          const tileColor = pillColors[def.key] ?? def.color;

          const waterWeeklyPct =
            def.key === "waterIntake" && waterGoalType === "weekly" && waterGoal
              ? Math.min(((weekToDate?.waterMl ?? 0) / (waterGoal * 7)) * 100, 100)
              : null;

          return (
            <div
              key={def.key}
              onClick={onTileClick}
              role="button"
              tabIndex={0}
              aria-label={`${def.label}: ${metaLoading ? "loading" : val != null ? val : "no data"} ${
                def.unit || ""
              } — tap to view`}
              className="flex-none flex flex-col items-center gap-1 rounded-2xl px-4 py-3 min-w-[76px] transition active:scale-95 relative cursor-pointer overflow-hidden"
              style={accentCardStyle(tileColor)}
            >
              <button
                onClick={e => {
                  e.stopPropagation();
                  if (def.key === "waterIntake") {
                    onLogWater();
                  } else {
                    onLogTile(def);
                  }
                }}
                className="absolute top-0.5 right-0.5 min-h-11 flex items-center text-[10px] font-bold px-2.5 py-2 rounded-full bg-foreground/10 border border-border/50 leading-none"
                aria-label={`Log ${def.label}`}
              >
                Log
              </button>
              <def.icon className="h-4 w-4" style={{ color: tileColor }} />
              <span className="text-sm font-bold tabular-nums">
                {metaLoading ? "…" : val != null ? val : "—"}
              </span>
              <span className="text-[10px] text-muted-foreground">{def.unit || def.label}</span>
              {waterWeeklyPct !== null && (
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-foreground/10">
                  <div
                    className="h-full transition-all"
                    style={{ width: `${waterWeeklyPct}%`, background: tileColor }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const MetricTilesCard = memo(MetricTilesCardComponent);
