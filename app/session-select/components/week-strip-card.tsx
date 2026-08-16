"use client";

import { memo } from "react";
import { cn } from "@trainingai/shared/utils";
import { getPaletteEntry } from "@trainingai/shared/session-palette";
import type { ProgramSession } from "@trainingai/shared/types/program";

interface WeekDay {
  label: string;
  dateKey: string;
  dayNum: number;
  sessions: string[];
  isToday: boolean;
  isFuture: boolean;
}

interface WeekStripCardProps {
  weekStrip: WeekDay[];
  activeSessions: ProgramSession[];
  onDayClick: (dateKey: string) => void;
}

function WeekStripCardComponent({ weekStrip, activeSessions, onDayClick }: WeekStripCardProps) {
  return (
    <div className="px-4 pb-3">
      <div className="flex justify-between gap-1">
        {weekStrip.map(day => {
          const sessionIdx = activeSessions.findIndex(s => day.sessions.includes(s.name));
          const palette = sessionIdx >= 0 ? getPaletteEntry(sessionIdx) : null;
          const sessionName = day.sessions[0] ?? null;
          return (
            <button
              key={day.dateKey}
              disabled={day.isFuture}
              onClick={() => onDayClick(day.dateKey)}
              aria-label={`${day.label}${day.isToday ? ", today" : ""}${
                day.sessions.length > 0
                  ? `, trained ${day.sessions[0]}`
                  : ", rest day"
              }`}
              className="flex flex-1 flex-col items-center gap-1 disabled:cursor-default"
            >
              <span
                className={`text-xs font-medium text-shadow-bg ${
                  day.isToday ? "text-brand" : "text-muted-foreground"
                }`}
              >
                {day.label}
              </span>
              <div
                className={cn(
                  "h-8 w-8 rounded-xl flex items-center justify-center text-[10px] font-bold border transition",
                  day.isToday && day.sessions.length > 0 && palette
                    ? `${palette.dotClass} border-transparent text-primary-foreground`
                    : day.isToday
                    ? "border-2 text-foreground"
                    : day.isFuture
                    ? "bg-muted/30 border-border/30 text-muted-foreground/30"
                    : day.sessions.length > 0 && palette
                    ? `${palette.dotClass} border-transparent text-primary-foreground`
                    : "bg-muted/40 border-border/40 text-muted-foreground",
                )}
                style={
                  day.isToday && day.sessions.length === 0
                    ? { borderColor: "var(--color-brand)", background: "var(--brand-card-bg)" }
                    : {}
                }
              >
                {day.isFuture ? (
                  <span>{day.dayNum}</span>
                ) : day.sessions.length > 0 ? (
                  <div className="w-2 h-2 rounded-full bg-current" />
                ) : day.isToday ? (
                  <span className="font-bold">{day.dayNum}</span>
                ) : (
                  <span className="text-xs">rest</span>
                )}
              </div>
              <span
                className={`text-xs text-shadow-bg ${
                  day.isToday ? "text-foreground font-semibold" : "text-muted-foreground"
                }`}
              >
                {day.isFuture ? "—" : sessionName ?? (day.isToday ? "today" : "—")}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export const WeekStripCard = memo(WeekStripCardComponent);
