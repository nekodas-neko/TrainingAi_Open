"use client";

import { HealthScoreDetail } from "@/components/health/health-score-detail";
import { ReadinessBreakdown } from "@/components/health/readiness-breakdown";

export function ReadinessContent({ userId }: { userId?: string }) {
  return (
    <HealthScoreDetail
      userId={userId}
      theme="readiness"
      title="Readiness"
      // Q-276, owner-decided: a morning starting number, and explicitly NOT a live one. All nine
      // `READINESS_WEIGHTS` contributors are overnight or previous-day measures — nothing reads
      // today's activity — so "it does not move as you use energy" is a checked property of the
      // model, not a simplification for the reader.
      subtitle="How your day is likely to go, set this morning from last night's sleep and yesterday. It does not move as you use energy — that is Body Battery."
      aiSection="readiness"
      scoreField="readinessDisplayScore"
      trendField="readinessScore"
      contributorsField="readinessContributors"
      sparklineColor="#60a5fa"
      contributorsTitle="Readiness Contributors"
      breakdown={(data) => <ReadinessBreakdown readiness={data} />}
      contributorChart
      averageContext
      extraCards={(data) => (
        <>
          {data.daySummary && (
            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <p className="text-sm text-muted-foreground">{data.daySummary}</p>
            </div>
          )}
        </>
      )}
    />
  );
}
