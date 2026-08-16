"use client";

import { memo } from "react";
import { MoonIcon } from "lucide-react";
import type { ReadinessScoreResponse } from "@/app/api/readiness-score/route";
import type { MoodLog } from "@trainingai/shared/types/mood";
import { restDayGuidance } from "@trainingai/shared/health/rest-day-guidance";

interface RestDayCardProps {
  readiness: ReadinessScoreResponse | null;
  moodLog: MoodLog | null | undefined;
  consecutiveRestDays: number | null | undefined;
}

// Mirrors the existing bedtime formatting in app/health/health-sections.tsx.
function formatBedtime(minsFromMidnightUtc: number): string {
  const mins = ((minsFromMidnightUtc % 1440) + 1440) % 1440;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

export const RestDayCard = memo(function RestDayCard({ readiness, moodLog, consecutiveRestDays }: RestDayCardProps) {
  const guidance = restDayGuidance({
    readinessScore: readiness?.score ?? null,
    soreMuscles: moodLog?.soreMuscles ?? [],
    sleepScore: readiness?.sleepScore ?? null,
    consecutiveRestDays,
  });

  return (
    <div className="rounded-2xl bg-muted/60 border border-border p-4 space-y-2">
      <div className="flex items-center gap-2">
        <MoonIcon className="h-4 w-4 flex-none" style={{ color: "var(--accent-purple)" }} />
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{guidance.title}</p>
      </div>
      <p className="text-sm text-muted-foreground">{guidance.body}</p>
      <ul className="space-y-1">
        {guidance.suggestions.map((s) => (
          <li key={s} className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <span className="mt-1.5 h-1 w-1 flex-none rounded-full bg-muted-foreground/60" />
            {s}
          </li>
        ))}
      </ul>
      {guidance.band === "rest" && readiness?.recommendedBedtimeStart != null && (
        <p className="text-xs text-muted-foreground">
          Recommended bedtime: {formatBedtime(readiness.recommendedBedtimeStart)}
        </p>
      )}
      {guidance.lowConfidence && (
        <p className="text-[10px] text-muted-foreground/70">Based on limited data today.</p>
      )}
    </div>
  );
});
