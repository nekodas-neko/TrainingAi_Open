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

export const NutritionActivityTrendsCard = memo(function NutritionActivityTrendsCard({ trends: trendsProp }: Props) {
  const [trends, setTrends] = useState<HealthTrendsResponse["trends"]>(
    () => trendsProp ?? readTodayCacheSync<HealthTrendsResponse>("health-trends-summary")?.trends ?? [],
  );
  const [loading, setLoading] = useState(trendsProp === undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (trendsProp !== undefined) { setTrends(trendsProp); setLoading(false); setFailed(false); return; }
    // LB-176. The comment here used to say a failed request and "nothing logged yet" could not be
    // told apart, so it printed the empty line for both — a reasonable call when `onError` was not
    // being used, and the self-fetch IS the live path on failure: the parent leaves `trends`
    // `undefined` unless its own read succeeded. `cachedFetch` still swallows `!res.ok`, but it
    // reports it through `onError` (RV-150), so the two are now distinguishable and the card says
    // which happened.
    cachedFetchToday<HealthTrendsResponse>("health-trends-summary", "/api/health/trends", HEALTH_TRENDS_SUMMARY_TTL, d => {
      if (d?.trends) { setTrends(d.trends); setFailed(false); }
    }, { onError: () => setFailed(true) }).finally(() => setLoading(false));
  }, [trendsProp]);

  const hasProtein = trends.some(t => t.proteinPerKg != null);
  const hasSteps = trends.some(t => t.steps != null);
  const hasWater = trends.some(t => t.waterMl != null);
  if (!hasProtein && !hasSteps && !hasWater) {
    if (loading) return null;
    return failed
      ? <p className="text-xs text-muted-foreground">Couldn&apos;t load your nutrition and activity trends.</p>
      : <p className="text-xs text-muted-foreground">No nutrition/activity trends yet.</p>;
  }

  return (
    <div className="space-y-3">
      {hasProtein && (
        <TrendSparkline trends={trends} field="proteinPerKg" label="Protein per kg Bodyweight" color="#22c55e" unit="g/kg" />
      )}
      {hasSteps && (
        <TrendSparkline trends={trends} field="steps" label="Steps" color="#2dd4bf" unit="" />
      )}
      {hasWater && (
        <TrendSparkline trends={trends} field="waterMl" label="Water" color="#00d4ff" unit="ml" />
      )}
    </div>
  );
})
