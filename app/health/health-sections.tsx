"use client";

import React from "react";
import dynamic from "next/dynamic";
import { InfoIcon } from "lucide-react";
import { accentCardStyle } from "@trainingai/shared/utils";
import { goalProgressPct, evaluateWeightRateVsGoalBand } from "@trainingai/shared/health/long-term-goal-progress";
import { scoreBand } from "@trainingai/shared/health/score-band";
import { bodyComposition } from "@trainingai/shared/health/body-composition";
import { displayBodyFat, type BodyFatCalibrationMeta } from "@/components/health/body-fat-display";
import { BodyFatCard } from "@/components/health/body-fat-card";
import { Sparkline } from "@/components/ui/sparkline";
import { WeeklyStatsHub } from "@/components/stats/weekly-stats-hub";
import { CalendarWidget } from "@/components/calendar-widget";
import { ActivityHistoryCard } from "@/components/health/activity-history-card";
import { LatestBaselineCard } from "@/components/fitness-tests/latest-baseline-card";
import { AiPeriodizationStatusCard } from "@/components/health/ai-periodization-status-card";
import { WeeklyMuscleSetsCard } from "@/components/health/weekly-muscle-sets-card";
import { BodyMuscleCard } from "@/components/health/body-muscle-card";
import { EnergyBudgetPrompt } from "@/components/health/energy-budget-prompt";
import { CalorieBalanceBar } from "@/components/nutrition/calorie-balance-bar";
import { TrainingLoadCard } from "@/components/health/training-load-card";
import { SleepVsPerformanceCard } from "@/components/health/sleep-vs-performance-card";
import { SleepCard } from "@/components/health/body-cards/sleep-card";
import { RhrHrvSpo2Card } from "@/components/health/body-cards/rhr-hrv-spo2-card";
import { MeasureHrNow } from "@/components/health/measure-hr-now";
import { HrDayCard } from "@/components/health/hr-day-card";
import { HrRecoveryProfileCard } from "@/components/health/hr-recovery-profile-card";
import { AiWeeklyVolumeCard } from "@/components/health/ai-weekly-volume-card";
import { StrengthProgressCard } from "@/components/health/strength-progress-card";
import { StrengthTrendCard } from "@/components/health/strength-trend-card";
import { GoalsProgressCard } from "@/components/health/goals-progress-card";
import { TrendsSection } from "@/components/health/trends-section";

import type { BodyMetaRow, WeekToDate } from "@/app/api/body-metadata/route";
import type { ReadinessScoreResponse } from "@/app/api/readiness-score/route";
import type { WeeklyStatsResponse } from "@/app/api/weekly-stats/route";
import type { MuscleSetsEntry } from "@/app/api/weekly-muscle-sets/route";
import type { StrengthTrendEntry } from "@/app/api/strength-trend/route";
import type { ProgressSummaryResponse } from "@/app/api/progress-summary/route";
import type { ProgramSession } from "@trainingai/shared/types/program";
import type { UserGoals } from "@/lib/data/repository";
import type { Injury } from "@trainingai/shared/types/injury";
import type { TrainingLoadResponse } from "@/app/api/training-load/route";
import type { SleepCorrelationResponse } from "@/app/api/sleep-performance-correlation/route";
import type { MuscleRecoveryEntry } from "@/app/api/muscle-recovery/route";
import type { HealthTrendsResponse } from "@/app/api/health/trends/route";

const OuraSection = dynamic(
  () => import("@/components/health/oura-section").then(m => ({ default: m.OuraSection })),
  { ssr: false },
);
const InjuryCard = dynamic(
  () => import("@/components/health/injury-card").then(m => ({ default: m.InjuryCard })),
  { ssr: false },
);
const WorkoutDensityCard = dynamic(
  () => import("@/components/health/workout-density-card").then(m => ({ default: m.WorkoutDensityCard })),
  { ssr: false },
);
const NutritionActivityTrendsCard = dynamic(
  () => import("@/components/health/nutrition-activity-trends-card").then(m => ({ default: m.NutritionActivityTrendsCard })),
  { ssr: false },
);
// Loaded lazily so its chart.js dependency stays out of the Health screen's
// initial bundle (it only draws when there are time-in-zone minutes to show).
const TimeInZoneCard = dynamic(
  () => import("@/components/health/time-in-zone-card").then(m => ({ default: m.TimeInZoneCard })),
  { ssr: false },
);

export type LogField = "weightKg" | "steps" | "bodyFat";
export type MetricSheetKind = "weight" | "bodyFat" | "steps" | "sleep" | "restingHR" | "hrv" | "spo2";

export interface SleepRow {
  date: string;
  durationHours: number | null;
  deepSleepHours: number | null;
  remSleepHours: number | null;
  lightSleepHours: number | null;
  awakHours: number | null;
  efficiency: number | null;
  onsetLatencySec: number | null;
  averageHrvMs: number | null;
  avgHeartRate: number | null;
  lowestHeartRate: number | null;
  restlessPeriods: number | null;
  sleepScore: number | null;
  respiratoryRate: number | null;
  sleepPhase5Min: string | null;
  sleepStart: string | null;
  sleepEnd: string | null;
  /** The rollup has not read far enough past this night's end to call it finished, so every figure
   *  derived from it can still move (`lib/sleep/provisional.ts`). Optional because the local-store
   *  fallback path has no watermark to compute it from — absent means "cannot tell", which reads
   *  as final rather than badging every historical night. */
  provisional?: boolean;
}

export interface HealthSectionsCtx {
  metaLoading: boolean;
  metaToday: BodyMetaRow | null;
  metaRecent: BodyMetaRow[];
  latestWeight: number | null;
  latestWeightIsStale: boolean;
  latestWeightDate: string | null;
  latestBf: number | null;
  latestSteps: number | null;
  latestDistanceKm: number | null;
  targetWeightKg: number | null;
  targetBfPct: number | null;
  openInfo: string | null;
  toggleInfo: (key: string) => void;
  openLog: (field: LogField, label: string, unit: string, step: number) => void;
  setMetricSheet: (v: MetricSheetKind) => void;
  setWaterLogOpen: (v: boolean) => void;
  recentSleep: SleepRow | null;
  lastSleep: SleepRow | null;
  readiness: ReadinessScoreResponse | null;
  todayWaterMl: number | null;
  waterGoalMl: number;
  activeEnergyKcalToday: number | null;
  bmi: number | null;
  bmiLabel: string | null;
  bmiUsesBf: boolean;
  weightTrendKgPerWeek: number | null;
  energyBalanceKcal: number | null;
  energyBalance: import('@/app/api/nutrition/energy-balance/route').EnergyBalanceResponse | null;
  trainingLoad: TrainingLoadResponse | null;
  sleepCorr: SleepCorrelationResponse | null;
  injuries: Injury[] | null;
  setInjuries: (v: Injury[]) => void;
  userId?: string;
  recoveryMuscles: MuscleRecoveryEntry[];
  handleDayClick: (date: string) => void;
  weeklyStats: WeeklyStatsResponse | null;
  activeSessions: ProgramSession[];
  /** The active program's training goal — scales the volume landmarks (Q-305). */
  trainingGoal?: string;
  muscleSets: MuscleSetsEntry[] | null;
  strengthTrend: StrengthTrendEntry[] | null;
  weekToDate: WeekToDate | null;
  userGoals: UserGoals | null;
  progressSummary: ProgressSummaryResponse | null;
  bodyBaseline: { weightKg: number | null; bodyFatPct: number | null };
  // Fetched once by the parent (PERF-4) and passed down to the three cards that
  // otherwise each independently fetch the same 'health-trends-summary' key.
  healthTrends?: HealthTrendsResponse['trends'];
  /** The DEXA offset, once per payload — null when no scan has ever been paired (LA-45). */
  bodyFatCalibration?: BodyFatCalibrationMeta | null;
}

export function getHealthSections(ctx: HealthSectionsCtx) {
  const {
    metaLoading, metaToday, metaRecent, latestWeight, latestWeightIsStale, latestWeightDate, latestBf, latestSteps,
    latestDistanceKm, targetWeightKg, targetBfPct, openInfo, toggleInfo, openLog,
    setMetricSheet, setWaterLogOpen, recentSleep, lastSleep, readiness,
    todayWaterMl, waterGoalMl, activeEnergyKcalToday, bmi, bmiLabel, bmiUsesBf,
    weightTrendKgPerWeek, energyBalanceKcal, energyBalance, trainingLoad, sleepCorr, injuries,
    setInjuries, userId, recoveryMuscles, handleDayClick, weeklyStats,
    activeSessions, trainingGoal, muscleSets, strengthTrend, weekToDate, userGoals,
    progressSummary, bodyBaseline, healthTrends, bodyFatCalibration,
  } = ctx;

  function isSectionVisible(key: string): boolean {
    switch (key) {
      case "bodyFat":            return latestBf != null;
      case "leanMass":           return metaRecent.filter(r => r.weightKg != null && displayBodyFat(r) != null).length >= 2;
      case "bodyComposition":    return metaRecent.some(r => r.skeletalMusclePct != null);
      case "sleepVsPerformance": return sleepCorr != null;
      // Always show the slot — when the budget can't compute (missing profile fields) we render a
      // "complete your profile" prompt instead of silently hiding the card.
      case "energyBudget":       return true;
      case "hrvBaseline":        return readiness?.baselineHrv != null && readiness?.recentHrv != null;
      default:                   return true;
    }
  }

  function renderBodySection(key: string): React.ReactNode {
    switch (key) {
      case "bodyWeight": {
        const weightPoints = [...metaRecent].reverse().map(r => r.weightKg).filter((w): w is number => w != null);
        return (
        <div key="bodyWeight"
          className="rounded-2xl p-4 relative overflow-hidden"
          style={accentCardStyle('#00d4ff')}
        >
          <div className="absolute -top-4 -right-4 w-20 h-20 rounded-full pointer-events-none" style={{ background: "#00d4ff", filter: "blur(28px)", opacity: 0.18 }} />
          <div className="flex items-start justify-between mb-3">
            <button onClick={() => setMetricSheet("weight")} className="text-left">
              <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "#00d4ff" }}>
                Body Weight ↗
              </p>
              {metaLoading ? (
                <div className="h-8 w-24 animate-pulse rounded-lg bg-muted" />
              ) : (
                <p className="text-3xl font-bold tabular-nums">
                  {latestWeight != null ? `${latestWeight} kg` : "—"}
                </p>
              )}
            </button>
            <button
              onClick={() => openLog("weightKg", "Body Weight", "kg", 0.1)}
              className="rounded-xl bg-muted px-3 py-1.5 text-xs font-semibold hover:bg-muted/80 transition-colors"
            >
              Log
            </button>
          </div>
          {weightPoints.length >= 2 ? (
            <Sparkline values={weightPoints} width={160} height={48} color="#00d4ff" showDots />
          ) : (
            <div className="flex items-center justify-center h-12 text-xs text-muted-foreground">Not enough data</div>
          )}
          <p className="text-[10px] text-muted-foreground mt-1">
            {latestWeightIsStale && latestWeightDate ? `Last logged ${latestWeightDate}` : "Last 7 days"}
          </p>
          {targetWeightKg != null && latestWeight != null && (() => {
            const diff = parseFloat((latestWeight - targetWeightKg).toFixed(1))
            return (
              <p className="text-xs font-semibold mt-1" style={{ color: diff <= 0 ? '#22c55e' : '#f97316' }}>
                {diff <= 0 ? '✓ Goal reached' : `↓ ${diff} kg to go`}
              </p>
            )
          })()}
          {targetWeightKg != null && latestWeight != null && progressSummary?.weightRateKgPerWeek != null && (() => {
            const { status, rateKgPerWeek } = evaluateWeightRateVsGoalBand(latestWeight, targetWeightKg, progressSummary.weightRateKgPerWeek)
            if (status == null || status === 'at_goal' || rateKgPerWeek == null) return null
            const label = status === 'on_track' ? 'On track'
              : status === 'too_slow' ? 'Slower than ideal pace'
              : status === 'too_fast' ? 'Faster than ideal pace'
              : 'Trending away from goal'
            const color = status === 'on_track' ? '#22c55e' : status === 'wrong_direction' ? '#ef4444' : '#f59e0b'
            return (
              <p className="text-[10px] mt-1" style={{ color }}>
                {label} · {rateKgPerWeek >= 0 ? '+' : ''}{rateKgPerWeek} kg/wk
              </p>
            )
          })()}
        </div>
      );
      }

      case "bodyFat":
        return (
          <BodyFatCard
            key="bodyFat"
            metaRecent={metaRecent}
            metaLoading={metaLoading}
            targetBfPct={targetBfPct}
            calibration={bodyFatCalibration ?? null}
            setMetricSheet={setMetricSheet}
            openLog={openLog}
          />
        );

      case "leanMass": {
        // Body composition (fat-free mass + fat mass + Cunningham BMR) via the shared core —
        // One-Formula-One-Place (lib/health/body-composition.ts), not an inline weight×(1−bf%).
        const valid = [...metaRecent].reverse().filter(r => r.weightKg != null && displayBodyFat(r) != null);
        const round1 = (x: number) => parseFloat(x.toFixed(1));
        // Corrected, so the lean-mass and BMR tiles agree with the calorie goal, which is already
        // computed from the corrected value (BF-2 step 4). `check-body-fat-correction.js` exempted
        // this file pending exactly this change; the exemption goes in the same PR.
        const latestComp = valid.length ? bodyComposition(valid[valid.length - 1].weightKg, displayBodyFat(valid[valid.length - 1])) : null;
        const oldestComp = valid.length ? bodyComposition(valid[0].weightKg, displayBodyFat(valid[0])) : null;
        const leanKg = latestComp ? round1(latestComp.ffmKg) : null;
        const fatKg = latestComp ? round1(latestComp.fatMassKg) : null;
        const bmr = latestComp ? Math.round(latestComp.bmrKcal) : null;
        const oldestLean = oldestComp ? round1(oldestComp.ffmKg) : null;
        const delta = (leanKg != null && oldestLean != null) ? round1(leanKg - oldestLean) : null;
        const leanSeries = valid
          .map(r => bodyComposition(r.weightKg, displayBodyFat(r)))
          .filter((c): c is NonNullable<typeof c> => c != null)
          .map(c => round1(c.ffmKg));
        return (
          <div key="leanMass" className="rounded-2xl p-4" style={accentCardStyle('#22c55e')}>
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#22c55e' }}>Body Composition</p>
                {leanKg != null && (
                  <p className="text-2xl font-bold" style={{ color: '#22c55e' }}>{leanKg} kg <span className="text-sm font-medium text-muted-foreground">lean</span></p>
                )}
                {delta != null && (
                  <p className={`text-xs mt-0.5 ${delta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {delta >= 0 ? '+' : ''}{delta} kg from oldest
                  </p>
                )}
              </div>
              <button onClick={() => toggleInfo('lean')} aria-label="Body composition info" className="p-2.5 rounded-full text-muted-foreground/60 hover:text-muted-foreground transition-colors">
                <InfoIcon className="h-3.5 w-3.5" />
              </button>
            </div>
            {(fatKg != null || bmr != null) && (
              <div className="flex gap-4 mb-2">
                {fatKg != null && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Fat Mass</p>
                    <p className="text-base font-bold text-foreground">{fatKg} kg</p>
                  </div>
                )}
                {bmr != null && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">BMR</p>
                    <p className="text-base font-bold text-foreground">{bmr} <span className="text-xs font-medium text-muted-foreground">kcal</span></p>
                  </div>
                )}
              </div>
            )}
            {leanSeries.length >= 2 && (
              <Sparkline values={leanSeries} width={160} height={48} color="#22c55e" showDots />
            )}
            {openInfo === 'lean' && (
              <div className="mt-3 rounded-xl bg-muted/50 p-2.5">
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Fat-free mass = weight × (1 − body fat %); fat mass = weight × body fat %; BMR uses the Cunningham equation (fat-free mass × 21.6 + 370 kcal/day). The sparkline tracks lean mass. Requires both weight and body fat % readings on the same day.
                </p>
              </div>
            )}
          </div>
        );
      }

      case "bodyComposition": {
        // Direct-BLE scale composition (skeletal muscle %, bone mass, etc.) — distinct from
        // "leanMass" above, which is a client-side Cunningham-formula estimate from weight+bf%
        // alone and has no access to these BIA-measured fields. Shown only for users with a
        // scale (see isSectionVisible), so it doesn't clutter the Body tab for everyone else.
        const rows = [...metaRecent].reverse();
        const latest = [...rows].reverse().find(r => r.skeletalMusclePct != null);
        if (!latest) return null;
        const muscleSeries = rows.map(r => r.skeletalMusclePct).filter((v): v is number => v != null);
        const tiles: { label: string; value: string | null }[] = [
          { label: "Skeletal Muscle", value: latest.skeletalMusclePct != null ? `${latest.skeletalMusclePct}%` : null },
          { label: "Fat-Free Mass",   value: latest.fatFreeMassKg != null ? `${latest.fatFreeMassKg} kg` : null },
          { label: "Muscle Mass",     value: latest.muscleMassKg != null ? `${latest.muscleMassKg} kg` : null },
          { label: "Bone Mass",       value: latest.boneMassKg != null ? `${latest.boneMassKg} kg` : null },
          { label: "Body Water",      value: latest.bodyWaterPct != null ? `${latest.bodyWaterPct}%` : null },
          { label: "Subcutaneous Fat", value: latest.subcutaneousFatPct != null ? `${latest.subcutaneousFatPct}%` : null },
          { label: "Visceral Fat",    value: latest.visceralFatIndex != null ? `${latest.visceralFatIndex}` : null },
          { label: "Protein",         value: latest.proteinPct != null ? `${latest.proteinPct}%` : null },
          { label: "BMR",             value: latest.bmrKcal != null ? `${latest.bmrKcal} kcal` : null },
          { label: "Metabolic Age",   value: latest.metabolicAge != null ? `${latest.metabolicAge} yrs` : null },
        ].filter(t => t.value != null);
        return (
          <div key="bodyComposition" className="rounded-2xl p-4" style={accentCardStyle('#a78bfa')}>
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#a78bfa' }}>Body Composition (Scale)</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">From your last weigh-in</p>
              </div>
              <button onClick={() => toggleInfo('bodyComposition')} aria-label="Body composition scale info" className="p-2.5 rounded-full text-muted-foreground/60 hover:text-muted-foreground transition-colors">
                <InfoIcon className="h-3.5 w-3.5" />
              </button>
            </div>
            {muscleSeries.length >= 2 && (
              <div className="mb-2">
                <Sparkline values={muscleSeries} width={260} height={36} color="#a78bfa" showDots fill responsive />
                <p className="text-[9px] text-muted-foreground mt-0.5">Skeletal muscle % trend</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              {tiles.map(t => (
                <div key={t.label} className="rounded-xl bg-muted/40 border border-border/40 p-3 flex flex-col gap-0.5">
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">{t.label}</p>
                  <p className="text-lg font-bold tabular-nums">{t.value}</p>
                </div>
              ))}
            </div>
            {openInfo === 'bodyComposition' && (
              <div className="mt-3 rounded-xl bg-muted/50 p-2.5">
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Measured directly by your body-composition scale (bioelectrical impedance) — only updates from an actual weigh-in with bare-foot skin contact, not calculated from weight/body-fat like the Body Composition card above.
                </p>
              </div>
            )}
          </div>
        );
      }

      case "sleep": return (
        <SleepCard
          key="sleep"
          recentSleep={recentSleep}
          lastSleep={lastSleep}
          computedSleepScore={readiness?.sleepScore ?? null}
          metaLoading={metaLoading}
          onOpenSheet={() => setMetricSheet("sleep")}
        />
      );

      case "steps": {
        return (
          <div key="steps" className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl p-4 relative overflow-hidden text-left" style={accentCardStyle('#2dd4bf')}>
              <div className="absolute -top-3 -right-3 w-14 h-14 rounded-full pointer-events-none" style={{ background: "#2dd4bf", filter: "blur(20px)", opacity: 0.2 }} />
              <div className="flex items-start justify-between mb-2">
                <button onClick={() => setMetricSheet("steps")} className="text-left flex-1">
                  <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#2dd4bf" }}>Steps ↗</p>
                </button>
                <button
                  onClick={() => openLog("steps", "Steps", "steps", 1)}
                  className="rounded-xl bg-muted px-3 py-1.5 text-xs font-semibold hover:bg-muted/80 transition-colors"
                >
                  Log
                </button>
              </div>
              {metaLoading ? (
                <div className="h-7 w-16 animate-pulse rounded-lg bg-muted" />
              ) : (
                <p className="text-2xl font-bold tabular-nums">
                  {latestSteps != null ? latestSteps.toLocaleString() : "—"}
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-1">Today</p>
            </div>
            <div className="rounded-2xl p-4 relative overflow-hidden text-left" style={accentCardStyle('#2dd4bf')}>
              <div className="absolute -top-3 -right-3 w-14 h-14 rounded-full pointer-events-none" style={{ background: "#2dd4bf", filter: "blur(20px)", opacity: 0.2 }} />
              <div className="flex items-start justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#2dd4bf" }}>Dist</p>
                <span className="text-[9px] text-muted-foreground opacity-60">↗</span>
              </div>
              {metaLoading ? (
                <div className="h-7 w-16 animate-pulse rounded-lg bg-muted" />
              ) : latestDistanceKm != null ? (
                <p className="text-2xl font-bold tabular-nums">{latestDistanceKm.toFixed(1)}<span className="text-xs font-normal ml-1">km</span></p>
              ) : (
                <p className="text-xs text-muted-foreground mt-1">No data</p>
              )}
              <p className="text-xs text-muted-foreground mt-1">Today</p>
            </div>
          </div>
        );
      }

      case "waterIntake": return (
        <div key="waterIntake" className="rounded-2xl p-4 relative overflow-hidden" style={{ ...accentCardStyle('#38bdf8'), willChange: 'transform' }}>
          <div className="absolute -top-4 -right-4 w-20 h-20 rounded-full pointer-events-none" style={{ background: '#38bdf8', filter: 'blur(28px)', opacity: 0.18 }} />
          <div className="flex items-start justify-between mb-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: '#38bdf8' }}>Water</p>
              {metaLoading ? (
                <div className="h-7 w-16 animate-pulse rounded-lg bg-muted" />
              ) : (
                <p className="text-3xl font-bold tabular-nums">
                  {todayWaterMl != null ? (todayWaterMl >= 1000 ? `${(todayWaterMl / 1000).toFixed(1)}L` : `${todayWaterMl}ml`) : '—'}
                </p>
              )}
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {waterGoalMl > 0 ? `Goal: ${waterGoalMl >= 1000 ? `${(waterGoalMl / 1000).toFixed(1)}L` : `${waterGoalMl}ml`}` : 'Today'}
              </p>
            </div>
            <button
              onClick={() => setWaterLogOpen(true)}
              className="rounded-xl bg-muted px-3 py-1.5 text-xs font-semibold hover:bg-muted/80 transition-colors"
            >
              Log
            </button>
          </div>
          {waterGoalMl > 0 && todayWaterMl != null && (
            <div className="h-1.5 rounded-full overflow-hidden mt-1" style={{ background: 'rgba(56,189,248,0.15)' }}>
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${Math.min((todayWaterMl / waterGoalMl) * 100, 100).toFixed(1)}%`, background: 'linear-gradient(90deg, #38bdf8, #0ea5e9)' }}
              />
            </div>
          )}
        </div>
      );

      case "caloriesBurned": {
        return (
          <div key="caloriesBurned" className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl p-4 relative overflow-hidden" style={accentCardStyle('#f97316')}>
              <div className="absolute -top-3 -right-3 w-14 h-14 rounded-full pointer-events-none" style={{ background: "#f97316", filter: "blur(20px)", opacity: 0.2 }} />
              <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#f97316" }}>Burned</p>
              {metaLoading ? (
                <div className="h-7 w-16 animate-pulse rounded-lg bg-muted" />
              ) : activeEnergyKcalToday != null ? (
                <p className="text-2xl font-bold tabular-nums">{Math.round(activeEnergyKcalToday)}<span className="text-sm font-normal ml-1">kcal</span></p>
              ) : (
                <p className="text-xs text-muted-foreground">No data</p>
              )}
              <p className="text-xs text-muted-foreground mt-1">From cardio today</p>
            </div>
            <div className="rounded-2xl p-4 relative overflow-hidden" style={accentCardStyle('#a78bfa')}>
              <div className="absolute -top-3 -right-3 w-14 h-14 rounded-full pointer-events-none" style={{ background: "#a78bfa", filter: "blur(20px)", opacity: 0.2 }} />
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#a78bfa" }}>BMI</p>
                <button onClick={() => toggleInfo('bmi')} aria-label="BMI info" className="p-2.5 rounded-full text-muted-foreground/60 hover:text-muted-foreground transition-colors">
                  <InfoIcon className="h-3.5 w-3.5" />
                </button>
              </div>
              {metaLoading ? (
                <div className="h-7 w-16 animate-pulse rounded-lg bg-muted" />
              ) : bmi != null ? (
                <>
                  <p className="text-2xl font-bold tabular-nums" style={{ color: "#a78bfa" }}>{bmi.toFixed(1)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{bmiLabel}</p>
                  {bmiUsesBf && <p className="text-[9px] text-muted-foreground/60 mt-0.5">via body fat %</p>}
                </>
              ) : (
                <p className="text-xs text-muted-foreground">No data</p>
              )}
              {openInfo === 'bmi' && (
                <div className="mt-3 flex gap-2 rounded-xl bg-muted/50 p-2.5">
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    {bmiUsesBf
                      ? "Category is based on your body fat % — more accurate for muscular builds. Standard BMI categories assume average body composition and classify muscle as excess weight."
                      : "Weight ÷ height². Standard categories assume average body composition. Log body fat % to get a category adjusted for muscle mass."}
                  </p>
                </div>
              )}
            </div>
          </div>
        );
      }

      case "weightTrend": {
        return (
          <div key="weightTrend" className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl p-4 relative overflow-hidden" style={accentCardStyle('#22c55e')}>
              <div className="absolute -top-3 -right-3 w-14 h-14 rounded-full pointer-events-none" style={{ background: "#22c55e", filter: "blur(20px)", opacity: 0.2 }} />
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#22c55e" }}>Trend</p>
                <button onClick={() => toggleInfo('trend')} aria-label="Weight trend info" className="p-2.5 rounded-full text-muted-foreground/60 hover:text-muted-foreground transition-colors">
                  <InfoIcon className="h-3.5 w-3.5" />
                </button>
              </div>
              {metaLoading ? (
                <div className="h-7 w-16 animate-pulse rounded-lg bg-muted" />
              ) : weightTrendKgPerWeek != null ? (
                <p className="text-2xl font-bold tabular-nums" style={{ color: "#22c55e" }}>
                  {weightTrendKgPerWeek >= 0 ? '+' : ''}{weightTrendKgPerWeek}
                  <span className="text-xs font-normal ml-1">kg/wk</span>
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Need more data</p>
              )}
              {openInfo === 'trend' && (
                <div className="mt-3 rounded-xl bg-muted/50 p-2.5">
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    Linear regression slope across your recent weight readings. Positive = gaining, negative = losing. Needs at least 3 readings to calculate.
                  </p>
                </div>
              )}
            </div>
            <div className="rounded-2xl p-4 relative overflow-hidden" style={accentCardStyle('#00d4ff')}>
              <div className="absolute -top-3 -right-3 w-14 h-14 rounded-full pointer-events-none" style={{ background: "#00d4ff", filter: "blur(20px)", opacity: 0.2 }} />
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#00d4ff" }}>Balance</p>
                <button onClick={() => toggleInfo('balance')} aria-label="Energy balance info" className="p-2.5 rounded-full text-muted-foreground/60 hover:text-muted-foreground transition-colors">
                  <InfoIcon className="h-3.5 w-3.5" />
                </button>
              </div>
              {metaLoading ? (
                <div className="h-7 w-16 animate-pulse rounded-lg bg-muted" />
              ) : energyBalanceKcal != null ? (
                <>
                  <p className="text-2xl font-bold tabular-nums" style={{ color: "#00d4ff" }}>
                    {energyBalanceKcal >= 0 ? '+' : ''}{Math.round(energyBalanceKcal)}
                    <span className="text-sm font-normal ml-1">kcal</span>
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">vs TDEE est.</p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">No data</p>
              )}
              {openInfo === 'balance' && (
                <div className="mt-3 rounded-xl bg-muted/50 p-2.5">
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    Calories eaten minus estimated daily expenditure. TDEE = Mifflin-St Jeor BMR × activity factor (based on your Activity Level in Profile, or 1.4 if unset). Requires age, height, sex, and today&apos;s food log.
                  </p>
                </div>
              )}
            </div>
          </div>
        );
      }

      case "rhr": return (
        <RhrHrvSpo2Card
          key="rhr"
          metaToday={metaToday}
          metaRecent={metaRecent}
          metaLoading={metaLoading}
          onOpenSheet={setMetricSheet}
        />
      );

      // Standalone "Measure HR now" card — device-agnostic (Oura ring or Polar strap), so it no
      // longer lives inside the Oura-connected-gated OuraSection where it vanished with a strap.
      case "measureHr": return <MeasureHrNow key="measureHr" />;

      // 24h HR graph — moved here from the Oura-ring section so all heart data sits together.
      case "hrDay": return <HrDayCard key="hrDay" />;

      case "hrRecoveryProfile": return <HrRecoveryProfileCard key="hrRecoveryProfile" />;

      case "hrvBaseline": {
        const { baselineHrv, recentHrv } = readiness ?? {};
        if (baselineHrv == null || recentHrv == null) return null;
        const deviationPct = Math.round(((recentHrv - baselineHrv) / baselineHrv) * 100);
        // scoreBand() is the one place High/Moderate/Low thresholds live — reuse it by
        // mapping this deviation onto its 0-100 scale so 0% deviation lands exactly on
        // the High cutoff (70) and -10% lands exactly on the Moderate cutoff (50),
        // preserving this card's original break points.
        const { label: hrvBandLabel, color } = scoreBand(70 + 2 * deviationPct);
        return (
          <div key="hrvBaseline" className="rounded-2xl p-4" style={accentCardStyle(color)}>
            <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">HRV · 7d vs 28d baseline</h3>
            <div className="flex items-end gap-3">
              <p className="text-3xl font-bold tabular-nums" style={{ color }}>
                {deviationPct > 0 ? '+' : ''}{deviationPct}%
              </p>
              <span className="text-[10px] font-semibold uppercase tracking-wide mb-1.5" style={{ color }}>{hrvBandLabel}</span>
              <p className="text-sm text-muted-foreground mb-1">
                {recentHrv.toFixed(0)} ms recent vs {baselineHrv.toFixed(0)} ms baseline
              </p>
            </div>
            <p className="text-xs text-muted-foreground mt-1">7-day average of overnight HRV vs your 28-day baseline (low-wear days excluded)</p>
            <div className="mt-3 flex gap-2 rounded-xl bg-muted/50 p-3">
              <InfoIcon className="h-3.5 w-3.5 text-muted-foreground flex-none mt-0.5" />
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                HRV above your baseline generally signals good recovery; a sustained drop can be an early sign of fatigue, illness, or under-recovery.
              </p>
            </div>
          </div>
        );
      }

      // Lives here, not in renderTrainingSection: "energyBudget" is listed in BODY_GROUPS and in
      // no training order, so the case sitting in the training renderer made this card
      // unreachable from both tabs — it had never rendered.
      case "energyBudget": return energyBalance?.balance != null || energyBalance?.missingProfileFields.length
        ? <CalorieBalanceBar key="energyBudget" data={energyBalance} isToday />
        : <EnergyBudgetPrompt key="energyBudget" />;

      case "nutritionActivityTrends": return <NutritionActivityTrendsCard key="nutritionActivityTrends" trends={healthTrends} />;

      case "trainingLoad": return <TrainingLoadCard key="trainingLoad" trainingLoad={trainingLoad} />;

      case "sleepVsPerformance": return sleepCorr ? <SleepVsPerformanceCard key="sleepVsPerformance" sleepCorr={sleepCorr} /> : null;

      case "injury": return (
        <div key="injury">
          <InjuryCard
            injuries={injuries ?? []}
            loading={injuries === null}
            onInjuriesChange={setInjuries}
            userId={userId}
            recoveryMuscles={recoveryMuscles}
          />
        </div>
      );

      case "ouraSection": return (
        <div key="ouraSection">
          <OuraSection trends={healthTrends} />
        </div>
      );

      default: return null;
    }
  }

  function renderTrainingSection(key: string): React.ReactNode {
    switch (key) {
      case "calendar": return (
        <div key="calendar" className="rounded-2xl bg-muted/60 border border-border p-4">
          <CalendarWidget onDayClick={handleDayClick} userId={userId} />
        </div>
      );
      case "weeklyStats":     return <WeeklyStatsHub key="weeklyStats" data={weeklyStats} loading={weeklyStats === null} sessions={activeSessions} />;
      case "timeInZone":      return <TimeInZoneCard key="timeInZone" />;
      case "aiPeriodization": return <AiPeriodizationStatusCard key="aiPeriodization" />;
      case "aiVolume":        return <AiWeeklyVolumeCard key="aiVolume" />;
      case "muscleSets":      return <WeeklyMuscleSetsCard key="muscleSets" muscles={muscleSets ?? []} loading={muscleSets === null} title="Muscle Volume This Week" trainingGoal={trainingGoal} />;
      case "muscleMap":       return <BodyMuscleCard key="muscleMap" muscleSets={muscleSets} recoveryMuscles={recoveryMuscles} />;
      case "baselineTests":   return <LatestBaselineCard key="baselineTests" userId={userId} />;
      case "activityHistory": return <ActivityHistoryCard key="activityHistory" userId={userId} />;
      case "workoutDensity":  return <WorkoutDensityCard key="workoutDensity" trends={healthTrends} />;
      default: return null;
    }
  }

  function renderProgressSection(key: string): React.ReactNode {
    switch (key) {
      case "strengthProgress": return <StrengthProgressCard key="strengthProgress" />;
      case "goalsProgress": return (
        <GoalsProgressCard key="goalsProgress"
          metaToday={metaToday}
          weekToDate={weekToDate}
          userGoals={userGoals}
          progressSummary={progressSummary}
        />
      );
      case "weightTrendProgress": {
        const trendWeightPoints = [...metaRecent].reverse().map(r => r.weightKg).filter((w): w is number => w != null);
        return (
        <div key="weightTrendProgress" className="rounded-2xl p-4 bg-muted/30 border border-border/40">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Weight Trend</p>
          {trendWeightPoints.length >= 2 ? (
            <Sparkline values={trendWeightPoints} width={160} height={48} color="var(--color-brand)" showDots />
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">Log body weight to see trend</p>
          )}
          {((latestWeight != null && bodyBaseline.weightKg != null && targetWeightKg != null) ||
            (latestBf != null && bodyBaseline.bodyFatPct != null && targetBfPct != null)) && (
            <div className="space-y-3 mt-3">
              {latestWeight != null && bodyBaseline.weightKg != null && targetWeightKg != null && (
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span>Weight</span>
                    <span className="font-semibold">{latestWeight} → {targetWeightKg} kg</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${goalProgressPct(bodyBaseline.weightKg, latestWeight, targetWeightKg)}%`,
                        background: 'var(--color-brand)',
                      }}
                    />
                  </div>
                </div>
              )}
              {latestBf != null && bodyBaseline.bodyFatPct != null && targetBfPct != null && (
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span>Body Fat</span>
                    <span className="font-semibold">{latestBf}% → {targetBfPct}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${goalProgressPct(bodyBaseline.bodyFatPct, latestBf, targetBfPct)}%`,
                        background: '#2dd4bf',
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      );
      }
      case "strengthTrend": return <StrengthTrendCard key="strengthTrend" exercises={strengthTrend ?? []} loading={strengthTrend === null} />;
      case "trends": return <TrendsSection key="trends" />;
      default: return null;
    }
  }

  return { isSectionVisible, renderBodySection, renderTrainingSection, renderProgressSection };
}
