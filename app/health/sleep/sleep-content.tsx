"use client";

import { useEffect, useState } from "react";
import { HealthScoreDetail } from "@/components/health/health-score-detail";
import { Hypnogram } from "@/components/health/hypnogram";
import { TrendSparkline } from "@/components/health/trend-sparkline-lazy";
import { SleepTrendToggleCard } from "@/components/health/sleep-trend-toggle-card-lazy";
import { cachedFetch, readCacheSync } from "@/lib/sqlite/cache";
import { TTL_MEDIUM } from "@trainingai/shared/cache-ttl";
import { computeSleepStartConsistency } from "@trainingai/shared/health/sleep-consistency";
import { getLocalStore } from "@/lib/local-store";
import { todayMidnightUtc, toAestDay } from "@trainingai/shared/date-utils";

interface SleepSessionRow {
  date: string;
  sleepPhase5Min: string | null;
  sleepStart: string | null;
  sleepEnd: string | null;
  phaseWindowStart?: string | null;
  phaseWindowEnd?: string | null;
  deepSleepHours: number | null;
  remSleepHours: number | null;
  lightSleepHours: number | null;
  awakHours: number | null;
}

export function SleepContent({ userId }: { userId?: string }) {
  const [sleepRows, setSleepRows] = useState<SleepSessionRow[]>([]);

  useEffect(() => {
    const cached = readCacheSync<SleepSessionRow[]>("sleep-sessions");
    if (cached) setSleepRows(cached);
    // Local-first: read from the on-device store before the network reply lands, mirroring
    // health-content.tsx's main-screen pattern (same sleep domain, sibling surface). The local
    // sleep table doesn't yet carry hypnogram/phase-window fields, so a local-only row renders
    // without the Hypnogram/consistency card until the network response (or a store schema
    // extension) fills those in — still correct, since every field check here is a `!= null`
    // guard that treats an absent field as "no data yet", not an error.
    if (userId) {
      const store = getLocalStore(userId);
      if (store) {
        const cutoff = new Date(todayMidnightUtc().getTime() - 30 * 24 * 60 * 60 * 1000);
        store.getSleepSessions(toAestDay(cutoff)).then(localSleep => {
          if (localSleep.length > 0) setSleepRows(prev => (prev.length > 0 ? prev : localSleep as unknown as SleepSessionRow[]));
        });
      }
    }
    cachedFetch<SleepSessionRow[]>("sleep-sessions", "/api/sleep-sessions", TTL_MEDIUM, rows => {
      if (rows) setSleepRows(rows);
    });
  }, [userId]);

  // Q-91: a BLE drain settling or an admin Redecode both invalidate the 'sleep-sessions'
  // cache entry (invalidateOuraSync) but this screen, once mounted, never learned to
  // refetch it — the hypnogram looked "stuck missing" until the next navigate-away/remount.
  // Mirrors session-select-content.tsx's existing listener for the same event.
  useEffect(() => {
    const onBleSynced = () => {
      cachedFetch<SleepSessionRow[]>("sleep-sessions", "/api/sleep-sessions", TTL_MEDIUM, rows => {
        if (rows) setSleepRows(rows);
      });
    };
    window.addEventListener("ta:oura-ble-synced", onBleSynced);
    return () => window.removeEventListener("ta:oura-ble-synced", onBleSynced);
  }, []);

  // Rows are ordered most-recent-first — the latest logged night.
  const latest = sleepRows[0];
  const recentStarts = sleepRows.slice(0, 7).map(r => r.sleepStart).filter((s): s is string => s != null);
  const consistency = computeSleepStartConsistency(recentStarts);
  // Q-90: reverse to oldest→newest for the trend charts (chronological left-to-right),
  // matching TrendSparkline's convention.
  const last14Nights = sleepRows.slice(0, 14).slice().reverse();

  return (
    <HealthScoreDetail
      userId={userId}
      theme="sleep"
      title="Sleep"
      aiSection="sleep"
      scoreField="sleepScore"
      trendField="sleepScore"
      contributorsField="sleepContributors"
      contributorChart
      sparklineColor="#818cf8"
      contributorsTitle="Sleep Contributors"
      extraCards={(_data, _color, trends) => (
        <>
          {latest && (
            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Sleep Stages</p>
              {latest.sleepPhase5Min && latest.sleepStart && latest.sleepEnd ? (
                <Hypnogram
                  size="lg"
                  phase5Min={latest.sleepPhase5Min}
                  sleepStart={latest.phaseWindowStart ?? latest.sleepStart}
                  sleepEnd={latest.phaseWindowEnd ?? latest.sleepEnd}
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  No sleep-stage data for last night yet — this shows up once your ring syncs.
                </p>
              )}
            </div>
          )}

          {consistency.sdMinutes != null && (
            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Sleep Consistency</p>
              <p className="text-base font-semibold">
                Bedtime varies by ~{Math.round(consistency.sdMinutes)} min
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Standard deviation of sleep start over the last {recentStarts.length} nights — lower is more consistent.
              </p>
            </div>
          )}

          {last14Nights.length > 0 && <SleepTrendToggleCard nights={last14Nights} />}

          {trends && <TrendSparkline trends={trends} field="temperatureDeviation" label="Skin Temperature" color="#f97316" unit="°C" />}
        </>
      )}
    />
  );
}
