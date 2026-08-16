"use client";

import { memo } from "react";
import { cn, accentCardStyle } from "@trainingai/shared/utils";
import { ColorSwatchPicker } from "@/components/ui/color-swatch-picker";
import { CARD_DEFAULT_COLORS } from "../constants";

interface StreakCardProps {
  streak: number;
  weekSessionCount: number;
  weeklyTarget: number;
  calendarDays: Record<string, string[]>;
  cardColors: Record<string, string>;
  sectionEditMode: boolean;
  dayKey: (daysAgo?: number) => string;
  onNavigateStats: () => void;
  onColorChangeLeft: (hex: string) => void;
  onColorChangeRight: (hex: string) => void;
  consecutiveRestDays?: number;
  streakWarning?: boolean;
  streakBroken?: boolean;
  isAiDynamic?: boolean;
}

function StreakCardComponent({
  streak,
  weekSessionCount,
  weeklyTarget,
  calendarDays,
  cardColors,
  sectionEditMode,
  dayKey,
  onNavigateStats,
  onColorChangeLeft,
  onColorChangeRight,
  consecutiveRestDays,
  streakWarning,
  streakBroken,
  isAiDynamic,
}: StreakCardProps) {
  const _slColor = cardColors["streakLeft"] ?? CARD_DEFAULT_COLORS.streakLeft;
  const _srColor = cardColors["streakRight"] ?? CARD_DEFAULT_COLORS.streakRight;

  return (
    <div className="px-4 pb-3 pt-1 relative flex flex-col gap-2">
      {sectionEditMode && (
        <>
          <div
            className="absolute top-3 left-[calc(25%-10px)] z-20"
            onClick={e => e.stopPropagation()}
          >
            <ColorSwatchPicker
              value={_slColor}
              label="Streak"
              onChange={onColorChangeLeft}
            />
          </div>
          <div className="absolute top-3 right-10 z-20" onClick={e => e.stopPropagation()}>
            <ColorSwatchPicker
              value={_srColor}
              label="This Week"
              onChange={onColorChangeRight}
            />
          </div>
        </>
      )}
      <div className="flex gap-2">
      <div
        role="button"
        tabIndex={0}
        onClick={() => { if (!sectionEditMode) onNavigateStats(); }}
        className={cn(
          "flex-1 rounded-2xl px-4 py-3 text-left active:scale-95 transition cursor-pointer",
          sectionEditMode && "pointer-events-none",
        )}
        style={accentCardStyle(_slColor)}
      >
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
          Streak
        </p>
        <p className="text-2xl font-bold tabular-nums leading-none" style={{ color: "var(--color-brand)" }}>
          {streak > 0 ? streak : "—"}
          <span className="text-xs font-normal text-muted-foreground ml-1">days</span>
        </p>
        <div className="flex gap-0.5 mt-2">
          {Array.from({ length: 10 }, (_, i) => {
            const trained = (calendarDays[dayKey(9 - i)] ?? []).length > 0;
            return (
              <div
                key={i}
                className="h-2 w-2 rounded-[2px]"
                style={{
                  background: trained
                    ? "var(--color-brand)"
                    : "color-mix(in oklch, var(--color-brand) 14%, transparent)",
                }}
              />
            );
          })}
        </div>
      </div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => { if (!sectionEditMode) onNavigateStats(); }}
        className={cn(
          "flex-1 rounded-2xl px-4 py-3 text-left active:scale-95 transition cursor-pointer",
          sectionEditMode && "pointer-events-none",
        )}
        style={accentCardStyle(_srColor)}
      >
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
          This Week
        </p>
        <p className="text-2xl font-bold tabular-nums leading-none">
          {weekSessionCount}
          {!isAiDynamic && (
            <span className="text-xs font-normal text-muted-foreground ml-1">/ {weeklyTarget}</span>
          )}
        </p>
        {isAiDynamic ? (
          <p className="text-xs text-muted-foreground mt-2">sessions this week</p>
        ) : (
          <>
            <div className="h-1.5 rounded-full overflow-hidden mt-2 bg-muted">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min((weekSessionCount / weeklyTarget) * 100, 100)}%`,
                  background:
                    "linear-gradient(90deg, var(--color-brand), color-mix(in oklch, var(--color-brand) 60%, #00d4ff))",
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">sessions done</p>
          </>
        )}
      </div>
      </div>
      {consecutiveRestDays != null && consecutiveRestDays >= 1 && (
        <div
          className="rounded-lg px-3 py-1.5 text-xs font-medium text-center"
          style={{
            background: streakBroken ? 'rgba(239,68,68,0.12)' : streakWarning ? 'rgba(251,191,36,0.12)' : 'rgba(148,163,184,0.12)',
            color: streakBroken ? '#ef4444' : streakWarning ? '#fbbf24' : '#94a3b8',
            border: `1px solid ${streakBroken ? 'rgba(239,68,68,0.25)' : streakWarning ? 'rgba(251,191,36,0.25)' : 'rgba(148,163,184,0.20)'}`,
          }}
        >
          {streakBroken
            ? 'Resting today breaks your streak'
            : streakWarning
              ? 'Rest again tomorrow and your streak breaks'
              : 'Day 1 of 2 rest days — streak safe'}
        </div>
      )}
    </div>
  );
}

export const StreakCard = memo(StreakCardComponent);
