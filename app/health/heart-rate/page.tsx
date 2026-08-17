"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import dynamic from "next/dynamic";
import { HeartIcon, HistoryIcon } from "lucide-react";
import { cachedFetch, cachedFetchToday, readCacheSync, readTodayCacheSync } from "@/lib/sqlite/cache";
import { HEALTH_TRENDS_SUMMARY_TTL, READINESS_SCORE_TTL, TTL_MEDIUM } from '@trainingai/shared/cache-ttl';
import { todayInTz, DEFAULT_TZ, formatDayShort } from "@trainingai/shared/date-utils";
import type { ReadinessScoreResponse } from "@/app/api/readiness-score/route";
import type { HealthTrendsResponse } from "@/app/api/health/trends/route";
import { DetailHero, usePageGradient, useHeroColorScheme } from "@/components/health/detail-hero";
import { TrendSparkline } from "@/components/health/trend-sparkline-lazy";
import { ObservedHrCard } from "@/components/health/observed-hr-card";
import { HrFactorsCard } from "@/components/health/hr-factors-card";
import { ProgressMarkersCard } from "@/components/health/progress-markers-card";
import type { HrSleepWindow } from "@trainingai/shared/health/hr-sleep-band";

const AiInsightCard = dynamic(() => import("@/components/health/ai-insight-card").then(m => ({ default: m.AiInsightCard })), { ssr: false });
const HrDayChart = dynamic(() => import("@/components/health/hr-day-chart").then(m => ({ default: m.HrDayChart })), { ssr: false });

interface HrReading { timestamp: string; bpm: number; source: string | null }

export default function HeartRateDetailPage() {
  const today = todayInTz(DEFAULT_TZ);
  const [data, setData] = useState<ReadinessScoreResponse | null>(null);
  const [trends, setTrends] = useState<HealthTrendsResponse | null>(null);
  const [hrReadings, setHrReadings] = useState<HrReading[]>([]);
  const [sleepWindow, setSleepWindow] = useState<HrSleepWindow | null>(null);
  // Seed synchronously from cache before paint — in a useLayoutEffect, never a useState lazy
  // initializer (cache reads in initializers caused hydration mismatches, session 165). The
  // data/trends fields are already seeded in loadReadiness.
  useLayoutEffect(() => {
    const cached = readCacheSync<{ readings: HrReading[]; sleep: HrSleepWindow | null }>(`oura-hr-day:${today}`);
    if (cached?.readings?.length) setHrReadings(cached.readings);
    if (cached?.sleep) setSleepWindow(cached.sleep);
  }, [today]);
  // K9: the stats fall back to "—", indistinguishable from a failed fetch — the
  // exact "is my ring broken?" confusion. Surface a retry banner when the primary
  // readiness fetch fails online with nothing cached to show.
  const [loadError, setLoadError] = useState(false);

  const loadReadiness = useCallback(() => {
    setLoadError(false);
    const cd = readTodayCacheSync<ReadinessScoreResponse>("readiness-score"); if (cd) setData(cd);
    const ct = readTodayCacheSync<HealthTrendsResponse>("health-trends-summary"); if (ct) setTrends(ct);
    cachedFetchToday<ReadinessScoreResponse>("readiness-score", "/api/readiness-score", READINESS_SCORE_TTL, d => {
      if (d) setData(d);
    }, { onError: () => setLoadError(true) });
    cachedFetchToday<HealthTrendsResponse>("health-trends-summary", "/api/health/trends", HEALTH_TRENDS_SUMMARY_TTL, d => {
      if (d) setTrends(d);
    });
  }, []);

  useEffect(() => { loadReadiness(); }, [loadReadiness]);

  useEffect(() => {
    cachedFetch<{ readings: HrReading[]; sleep: HrSleepWindow | null }>(
      `oura-hr-day:${today}`, `/api/oura/hr-day?date=${today}`, TTL_MEDIUM,
      d => {
        if (d?.readings?.length) setHrReadings(d.readings)
        setSleepWindow(d?.sleep ?? null)
      },
    ).catch(() => {});
  }, [today]);

  const scheme = useHeroColorScheme();
  const pageGradient = usePageGradient("heart-rate");
  const hr = data?.hrCurrent ?? null;
  const hrZoneLabel = hr != null ? (hr < 60 ? "Resting" : hr < 100 ? "Normal" : "Elevated") : null;
  const hrColor = hr != null
    ? hr < 60 ? "#22c55e" : hr < 100 ? "#f87171" : "#f59e0b"
    : scheme === "light" ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.7)";
  const labelColor = scheme === "light" ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.6)";

  const stats = [
    { label: "Current", value: data?.hrCurrent, unit: "bpm" },
    { label: "Min",     value: data?.hrMin,     unit: "bpm" },
    { label: "Average", value: data?.hrAvg,     unit: "bpm" },
    { label: "Max",     value: data?.hrMax,     unit: "bpm" },
  ];

  return (
    <div className="min-h-screen pb-safe" style={{ background: pageGradient }}>
      <DetailHero theme="heart-rate" title="Heart Rate">
        <div className="flex flex-col items-center gap-1">
          <HeartIcon className="h-8 w-8 mb-1" style={{ color: hrColor }} />
          <span className="text-4xl font-bold tabular-nums" style={{ color: hrColor }}>
            {hr ?? "—"}
          </span>
          {hrZoneLabel && (
            <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: hrColor }}>{hrZoneLabel}</span>
          )}
          <span className="text-sm" style={{ color: labelColor }}>bpm current</span>
        </div>
      </DetailHero>

      <div className="px-4 py-5 space-y-5">
        {loadError && data == null && (
          <div className="flex items-center justify-between rounded-xl border border-border bg-muted/20 px-4 py-3">
            <span className="text-xs text-muted-foreground">Couldn&apos;t load heart-rate data</span>
            <button type="button" onClick={loadReadiness} className="text-xs font-medium text-brand">Retry</button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          {stats.map(s => (
            <div key={s.label} className="rounded-xl border border-border bg-muted/20 p-4 text-center">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.label}</p>
              <p className="text-xl font-bold tabular-nums mt-1">
                {s.value != null ? s.value : "—"}
                {s.value != null && <span className="text-xs font-normal text-muted-foreground ml-1">{s.unit}</span>}
              </p>
            </div>
          ))}
        </div>

        <ObservedHrCard />

        <HrFactorsCard
          restingHr={data?.hrMin ?? null}
          recentHrv={data?.recentHrv ?? null}
          baselineHrv={data?.baselineHrv ?? null}
        />

        <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">24h Heart Rate</p>
          {hrReadings.length > 0 ? (
            <HrDayChart readings={hrReadings} date={today} sleepWindow={sleepWindow} />
          ) : (
            <p className="text-xs text-muted-foreground">No HR captured yet today — the ring records periodically while worn.</p>
          )}
        </div>

        <ProgressMarkersCard trends={trends?.trends} />

        {trends?.trends && (
          <>
            <TrendSparkline trends={trends.trends} field="rhrBpm" label="Resting Heart Rate" color="#f87171" unit="bpm" />
            <TrendSparkline trends={trends.trends} field="hrvMs" label="HRV (overnight)" color="#a78bfa" unit="ms" />
            <TrendSparkline trends={trends.trends} field="hrr1Bpm" label="HR Recovery (60s drop)" color="#34d399" unit="bpm/min" />
          </>
        )}

        {(data?.vo2Max != null || data?.vascularAge != null) && (
          <div className="grid grid-cols-2 gap-3">
            {data.vo2Max != null && (
              <div className="rounded-xl border border-border bg-muted/20 p-4 text-center">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">VO₂ Max</p>
                <p className="text-xl font-bold tabular-nums mt-1">{data.vo2Max}</p>
                {data.cloudVitalsDate && (
                  <p className="mt-1 flex items-center justify-center gap-1 text-[9px] text-muted-foreground">
                    <HistoryIcon className="h-2.5 w-2.5" /> as of {formatDayShort(data.cloudVitalsDate)}
                  </p>
                )}
              </div>
            )}
            {data.vascularAge != null && (
              <div className="rounded-xl border border-border bg-muted/20 p-4 text-center">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Vascular Age</p>
                <p className="text-xl font-bold tabular-nums mt-1">{data.vascularAge} <span className="text-xs font-normal text-muted-foreground">yrs</span></p>
                {data.cloudVitalsDate && (
                  <p className="mt-1 flex items-center justify-center gap-1 text-[9px] text-muted-foreground">
                    <HistoryIcon className="h-2.5 w-2.5" /> as of {formatDayShort(data.cloudVitalsDate)}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* The route's heart-rate prompt reads `body_metrics.restingHeartRate` and `hrvMs`; with
            neither, every line it builds is the literal string "no data" (Q-452). The trend series
            is the client-side view of exactly those two columns (`rhrBpm` ← `restingHeartRate`).
            Deliberately NOT `data.hrMin`/`data.recentHrv`, which look like the right fields and are
            not: those come from live ring readings, so they are null for an account with months of
            recorded RHR and no ring — measured, and it hid the card from the seeded user. */}
        <AiInsightCard
          section="heart-rate"
          date={today}
          hasData={trends?.trends?.some(t => t.rhrBpm != null || t.hrvMs != null) ?? false}
        />

        {!data && (
          <div className="space-y-3">
            {[1, 2].map(i => <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />)}
          </div>
        )}
      </div>
    </div>
  );
}
