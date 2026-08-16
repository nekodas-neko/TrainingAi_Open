"use client";

import { TrendingUp, TrendingDown, Minus, CircleHelp } from "lucide-react";
import { assessFromTrends, type MarkerAssessment, type TrendPoint } from "@trainingai/shared/health/progress-markers";

// Progress observation — is your training working? Reads the health-trends series already
// in scope (no extra fetch) and shows a baseline→current verdict per marker.
export function ProgressMarkersCard({ trends }: { trends: TrendPoint[] | undefined }) {
  if (!trends || trends.length < 4) return null;
  const markers = assessFromTrends(trends).filter((m) => m.trend !== "insufficient");
  if (markers.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Are you making progress?
        </h3>
        <span className="ml-auto text-[10px] text-muted-foreground">baseline → now</span>
      </div>
      <ul className="space-y-2.5">
        {markers.map((m) => (
          <li key={m.key} className="flex items-start gap-2.5">
            <TrendIcon m={m} />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-snug text-foreground">{m.summary}</p>
              <p className="text-[10px] text-muted-foreground">{m.retestCadence}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TrendIcon({ m }: { m: MarkerAssessment }) {
  const cls = "mt-0.5 h-4 w-4 shrink-0";
  if (m.trend === "improving") return <TrendingUp className={`${cls} text-emerald-600 dark:text-emerald-400`} aria-label="improving" />;
  if (m.trend === "declining") return <TrendingDown className={`${cls} text-amber-600 dark:text-amber-400`} aria-label="slipping" />;
  if (m.trend === "stable") return <Minus className={`${cls} text-muted-foreground`} aria-label="steady" />;
  return <CircleHelp className={`${cls} text-muted-foreground`} aria-label="unknown" />;
}
