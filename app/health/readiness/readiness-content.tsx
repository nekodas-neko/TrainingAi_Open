"use client";

import { HealthScoreDetail } from "@/components/health/health-score-detail";
import { ReadinessBreakdown } from "@/components/health/readiness-breakdown";

export function ReadinessContent({ userId }: { userId?: string }) {
  return (
    <HealthScoreDetail
      userId={userId}
      theme="readiness"
      title="Readiness"
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
