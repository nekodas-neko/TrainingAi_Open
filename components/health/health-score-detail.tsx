"use client";

import { useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { cachedFetchToday, readTodayCacheSync } from "@/lib/sqlite/cache";
import { HEALTH_TRENDS_SUMMARY_TTL, READINESS_SCORE_TTL } from '@trainingai/shared/cache-ttl';
import { todayInTz, DEFAULT_TZ } from "@trainingai/shared/date-utils";
import { getLocalStore } from "@/lib/local-store";
import type { ReadinessScoreResponse } from "@/app/api/readiness-score/route";
import type { HealthTrendsResponse, HealthTrendDay } from "@/app/api/health/trends/route";
import { DetailHero, usePageGradient, useHeroColorScheme, type ColorScheme } from "@/components/health/detail-hero";
import { TrendSparkline } from "@/components/health/trend-sparkline-lazy";
import { scoreBand } from "@trainingai/shared/health/score-band";
import { useCountUp } from "@/lib/hooks/use-count-up";
import { Activity } from "lucide-react";
import { labelFor } from "@/lib/oura/contributors";
import { guideFor } from "@trainingai/shared/health/contributor-guide";
import { ContributorChart, FactorBar } from "./contributor-chart";
import { ContributorDetails } from "./contributor-details";
import { ResilienceTile } from "./resilience-tile";

const AiInsightCard = dynamic(() => import("@/components/health/ai-insight-card").then(m => ({ default: m.AiInsightCard })), { ssr: false });

type ScoreField = "ouraScore" | "readinessDisplayScore" | "sleepScore" | "activityScore";
type ContributorsField = "readinessContributors" | "sleepContributors" | "activityContributors";

function bandColor(score: number | null, scheme: ColorScheme) {
  if (score == null) return scheme === "light" ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.7)";
  return scoreBand(score).color;
}

/** The hero ring.
 *
 *  LA-42: this used to take a `trainingBoostFrom` and draw a second brand-coloured arc for the part
 *  of an activity score that came from a same-day training blend. `blendActivityScore` is gone
 *  (Q-284), so `activityBlend.adjustment` is a literal 0 at both of this payload's construction
 *  sites and the arc could not be reached. **Not a regression:** the blend last had an Oura score to
 *  adjust on 2026-07-07, the re-key day — Q-284 only turned "dead in practice" into "dead by
 *  construction", which is what made it safe to remove rather than merely unused. */
function ScoreDisplay({ score, label }: { score: number | null; label: string }) {
  const scheme = useHeroColorScheme();
  const color = bandColor(score, scheme);
  const trackColor = scheme === "light" ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.12)";
  const labelColor = scheme === "light" ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.6)";
  const r = 52;
  const circumference = 2 * Math.PI * r;
  const offset = score != null ? circumference * (1 - score / 100) : circumference;
  const displayScore = useCountUp(score);
  const bandLabel = score != null ? scoreBand(score).label : null;
  return (
    <div className="relative w-32 h-32">
      <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="8" stroke={trackColor} />
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="8"
          style={{ stroke: color, strokeDasharray: circumference, strokeDashoffset: offset, strokeLinecap: "round" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-bold tabular-nums" style={{ color }}>{displayScore != null ? Math.round(displayScore) : "—"}</span>
        {bandLabel && <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color }}>{bandLabel}</span>}
        <span className="text-xs mt-0.5" style={{ color: labelColor }}>{label}</span>
      </div>
    </div>
  );
}

function ContributorBars({ title, contributors }: { title: string; contributors: Record<string, number | null> }) {
  const entries = Object.entries(contributors).filter((e): e is [string, number] => e[1] != null).sort(([, a], [, b]) => a - b);
  if (entries.length === 0) return null;
  return (
    <>
      <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
        {entries.map(([key, val]) => (
          <FactorBar key={key} contributorKey={key} label={labelFor(key)} value={val} color={scoreBand(val).color} linked={guideFor(key) != null} />
        ))}
      </div>
      <ContributorDetails factors={entries.map(([key, val]) => ({ key, label: labelFor(key), score: val }))} />
    </>
  );
}

export interface HealthScoreDetailProps {
  userId?: string;
  theme: "readiness" | "sleep" | "activity";
  title: string;
  /**
   * One line naming the QUESTION this score answers, under the hero.
   *
   * Q-276 measured Readiness and Body Battery at r = +0.12 by end of day and the owner settled it:
   * they are different questions, not one question answered twice. *"Body battery should be more
   * like 'how much energy I have left'. Readiness should just be a starting number based on your
   * previous day + sleep."* Two headline numbers a reader takes for the same thing, sharing no
   * variance, is a presentation problem — so each says what it is for, at the top, before the
   * number.
   */
  subtitle?: string;
  aiSection: "readiness" | "sleep" | "activity";
  scoreField: ScoreField;
  // HealthTrendsResponse names the readiness trend field "readinessScore", distinct
  // from ReadinessScoreResponse's "ouraScore" — kept as a separate prop rather than
  // conflating the two APIs' naming.
  trendField: "readinessScore" | "sleepScore" | "activityScore";
  contributorsField: ContributorsField;
  sparklineColor: string;
  contributorsTitle: string;
  extraCards?: (data: ReadinessScoreResponse, color: string, trends: HealthTrendDay[] | undefined) => ReactNode;
  // Optional richer detail (readiness screen): a "how the score is built" card rendered
  // above contributors, a graph-style contributor chart instead of the flat bars, and a
  // "vs your 14-day average" context chip under the score. Off by default so Sleep/Activity
  // keep their existing layout until their own items extend them.
  breakdown?: (data: ReadinessScoreResponse) => ReactNode;
  contributorChart?: boolean;
  averageContext?: boolean;
  // Suppress the 0-100 contributor bars — used by Sleep, whose Oura contributor sub-scores are
  // frozen/near-zero post-BLE-re-key and read as contradictory next to the real stage hours.
  hideContributors?: boolean;
}

// Today's score vs the trailing average of the trend window (excludes today), for the
// "informational" previous/average context the readiness screen wants.
function averageChip(trends: HealthTrendDay[] | undefined, field: HealthScoreDetailProps["trendField"]) {
  if (!trends || trends.length < 2) return null;
  const values = trends.map(t => t[field]).filter((v): v is number => v != null);
  if (values.length < 2) return null;
  const today = values[values.length - 1];
  const prior = values.slice(0, -1);
  const avg = Math.round(prior.reduce((s, v) => s + v, 0) / prior.length);
  const diff = today - avg;
  const sign = diff > 0 ? "+" : diff < 0 ? "−" : "±";
  return { avg, today, text: `${sign}${Math.abs(diff)} vs your ${prior.length}-day average (${avg})` };
}

export function HealthScoreDetail({
  userId, theme, title, subtitle, aiSection, scoreField, trendField, contributorsField, sparklineColor, contributorsTitle, extraCards,
  breakdown, contributorChart, averageContext, hideContributors,
}: HealthScoreDetailProps) {
  const today = todayInTz(DEFAULT_TZ);
  const [data, setData] = useState<ReadinessScoreResponse | null>(null);
  const [trends, setTrends] = useState<HealthTrendsResponse | null>(null);

  useEffect(() => {
    const cd = readTodayCacheSync<ReadinessScoreResponse>("readiness-score"); if (cd) setData(cd);
    const ct = readTodayCacheSync<HealthTrendsResponse>("health-trends-summary"); if (ct) setTrends(ct);

    const store = userId ? getLocalStore(userId) : null;
    if (store && !cd) {
      store.getOuraDaily(today).then(rows => {
        const row = rows.find(r => r.day === today) ?? rows[rows.length - 1];
        if (!row) return;
        const score = scoreField === "ouraScore" || scoreField === "readinessDisplayScore" ? row.readinessScore
          : scoreField === "sleepScore" ? row.sleepScore
          : row.activityScore;
        setData(prev => prev ?? ({
          score: score ?? 0,
          label: scoreBand(score ?? 0).label,
          components: { sleep: 0, hrv: 0, rhr: 0, load: 0 },
          hasSufficientData: score != null,
          earlyDeloadRecommended: false,
          earlyDeload: null,
          source: 'oura',
          // Offline seed from the local mirror — it carries the score, not the inputs behind it,
          // so it claims nothing about availability and never renders the limited qualifier.
          inputsAvailable: [], inputsMissing: [], scoreConfidence: 'full', limited: false,
          ouraScore: row.readinessScore,
          readinessDisplayScore: row.readinessScore ?? null,
          temperatureDeviation: row.day === today ? row.temperatureDeviation : null,
          temperatureDeviationSource: row.day === today && row.temperatureDeviation != null ? 'cloud' : null,
          daySummary: null,
          sleepScore: row.sleepScore, activityScore: row.activityScore,
          activityBlend: { base: row.activityScore, adjustment: 0, final: row.activityScore, trained: false },
          readinessContributors: row.contributors as Record<string, number | null> | null,
          readinessCompositeContributors: null,
          sleepContributors: null, activityContributors: null,
          activityGoals: null, activitySignals: null, activityTaperApplied: false,
          hrCurrent: null, hrMin: null, hrAvg: null, hrMax: null,
          vo2Max: null, vascularAge: null, cloudVitalsDate: null,
          stressHigh: null, recoveryHigh: null,
          recommendedBedtimeStart: null, recommendedBedtimeEnd: null,
          isLowWearToday: false,
          baselineHrv: null, recentHrv: null,
          restingHr: null, restingHrBaseline: null,
          // TN-13 — part of the payload's shape, so this degraded literal carries them too.
          restingHrLastNight: null, restingHrLastNightDate: null,
          illnessFlag: null, illnessScore: null, illnessBiomarkers: null,
          illnessSuppression: 0, illnessAdvisory: null,
          ownResilienceLevel: null, ownResilienceBand: null, ownResilienceConfidence: null,
        } satisfies ReadinessScoreResponse));
      }).catch(() => {});
    }

    cachedFetchToday<ReadinessScoreResponse>("readiness-score", "/api/readiness-score", READINESS_SCORE_TTL, d => {
      if (d) setData(d);
    });
    cachedFetchToday<HealthTrendsResponse>("health-trends-summary", "/api/health/trends", HEALTH_TRENDS_SUMMARY_TTL, d => {
      if (d) setTrends(d);
    });
  }, [today, userId, scoreField]);

  const score = data?.[scoreField] ?? null;
  const contributors = data?.[contributorsField] ?? null;
  const scheme = useHeroColorScheme();
  const color = bandColor(score, scheme);
  const pageGradient = usePageGradient(theme);
  const avg = averageContext ? averageChip(trends?.trends, trendField) : null;

  return (
    <div className="min-h-screen pb-safe" style={{ background: pageGradient }}>
      <DetailHero theme={theme} title={title}>
        <ScoreDisplay
          score={score}
          label={title === "Readiness" ? "Readiness Score" : `${title} Score`}
        />
      </DetailHero>

      <div className="px-4 py-5 space-y-5">
        {subtitle && (
          <p className="-mt-1 text-center text-[12px] leading-snug text-muted-foreground">{subtitle}</p>
        )}
        {avg && (
          <div className="-mt-1 flex justify-center">
            <span className="rounded-full border border-border bg-muted/40 px-3 py-1 text-[11px] font-medium text-muted-foreground">
              {avg.text}
            </span>
          </div>
        )}
        {data && data.ouraScore == null && score != null && (
          <p className="text-[11px] leading-snug text-muted-foreground">
            Computed by the app from your health and training data.
          </p>
        )}
        {title === "Readiness" && data?.illnessAdvisory && (
          <div role="status" className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/60 px-3 py-2.5">
            <Activity className="mt-0.5 h-4 w-4 shrink-0 text-foreground" aria-hidden />
            <div className="text-[12px] leading-snug text-foreground">
              <span className="font-semibold capitalize">{data.illnessFlag}</span>
              {data.illnessSuppression > 0 && (
                <span className="text-muted-foreground"> · readiness −{data.illnessSuppression}</span>
              )}
              <span className="block text-muted-foreground">{data.illnessAdvisory}</span>
            </div>
          </div>
        )}
        {title === "Readiness" && data?.ownResilienceLevel != null && data.ownResilienceBand != null && (
          <ResilienceTile level={data.ownResilienceLevel} band={data.ownResilienceBand} confidence={data.ownResilienceConfidence} />
        )}
        {breakdown && data && breakdown(data)}

        {contributors && !hideContributors && (
          contributorChart
            ? <ContributorChart title={contributorsTitle} contributors={contributors} />
            : <ContributorBars title={contributorsTitle} contributors={contributors} />
        )}

        {data && extraCards?.(data, color, trends?.trends)}

        {trends?.trends && (
          <TrendSparkline trends={trends.trends} field={trendField} label={`${title} Score`} color={sparklineColor} unit="" />
        )}

        {/* No score for this section means nothing measured today, and the model turns that into
            an assertion of zero rather than absence (Q-452). */}
        <AiInsightCard section={aiSection} date={today} hasData={score != null} />

        {!data && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />)}
          </div>
        )}
      </div>
    </div>
  );
}
