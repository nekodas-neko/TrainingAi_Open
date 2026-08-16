"use client";

import { memo, useEffect, useState } from "react";
import { cachedFetchToday, readTodayCacheSync } from "@/lib/sqlite/cache";
import { HEALTH_TRENDS_SUMMARY_TTL } from "@trainingai/shared/cache-ttl";
import type { HealthTrendsResponse } from "@/app/api/health/trends/route";
import { TrendSparkline } from "./trend-sparkline-lazy";

interface Props {
  // Parent-fetched trends (PERF-4) — when provided, this card skips its own
  // fetch entirely instead of racing three siblings for the same key. Falls
  // back to a self-fetch when the parent hasn't resolved it (undefined).
  trends?: HealthTrendsResponse["trends"];
}

export const WorkoutDensityCard = memo(function WorkoutDensityCard({ trends: trendsProp }: Props) {
  const [trends, setTrends] = useState<HealthTrendsResponse["trends"]>(
    () => trendsProp ?? readTodayCacheSync<HealthTrendsResponse>("health-trends-summary")?.trends ?? [],
  );
  const [loading, setLoading] = useState(trendsProp === undefined);

  useEffect(() => {
    if (trendsProp !== undefined) { setTrends(trendsProp); setLoading(false); return; }
    // cachedFetch swallows fetch failures internally (never rejects), so a failed request
    // and "no workouts logged yet" both leave `trends` empty — can't distinguish them, so
    // this renders an empty-state line either way instead of vanishing (self-fetching-card
    // failure-state rule), same treatment as Task 2.5's HR chart fix.
    cachedFetchToday<HealthTrendsResponse>("health-trends-summary", "/api/health/trends", HEALTH_TRENDS_SUMMARY_TTL, d => {
      if (d?.trends) setTrends(d.trends);
    }).finally(() => setLoading(false));
  }, [trendsProp]);

  const hasDuration = trends.some(t => t.sessionDurationMin != null);
  const hasDensity = trends.some(t => t.workoutDensity != null);
  if (!hasDuration && !hasDensity) {
    if (loading) return null;
    return <p className="text-xs text-muted-foreground">No workout density trends yet.</p>;
  }

  return (
    <div className="space-y-3">
      {hasDuration && (
        <TrendSparkline trends={trends} field="sessionDurationMin" label="Session Duration" color="var(--color-brand)" unit="min" />
      )}
      {hasDensity && (
        <TrendSparkline trends={trends} field="workoutDensity" label="Workout Density" color="#f97316" unit="kg/min" />
      )}
    </div>
  );
})
