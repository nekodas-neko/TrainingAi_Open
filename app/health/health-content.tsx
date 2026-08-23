"use client";

import React, { useEffect, useLayoutEffect, useState, useCallback, useMemo } from "react";
import { SwipeCarousel } from "@/components/ui/swipe-carousel";
import { SectionHeader } from "@/components/health/section-header";
import { getHealthSections } from "@/app/health/health-sections";
import { useGoalSeeds } from "@/app/health/use-goal-seeds";
import dynamic from 'next/dynamic';
import { useSearchParams } from "next/navigation";
import { useTransitionRouter } from "@/lib/view-transition";
import { useTabVisibility } from "@/components/shell/tab-visibility";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { ScreenHeader } from "@/components/shell/screen-header";
import { todayInTz, todayMidnightUtc, toAestDay, shiftDateStr } from "@trainingai/shared/date-utils";
import { getLocalStore } from "@/lib/local-store";
import { pushMutations, pullDelta } from "@/lib/local-store/sync-engine";
import { PullToSync } from "@/components/pull-to-sync";
import type { BodyMetaRow, WeekToDate } from "@/app/api/body-metadata/route";
import { cachedFetch, readCacheSync, setCached, cachedFetchToday, readTodayCacheSync, isBodyMetadataFresh } from "@/lib/sqlite/cache";
import { useUserTimezone } from '@/components/shell/user-timezone-provider';
import { runWithConcurrency } from "@/lib/async/run-with-concurrency";
import { invalidateReadinessInputs, invalidateOuraSync, invalidateBiometrics, invalidateHealthTrends, invalidateBodyMetricWrite } from "@/lib/cache-groups";
import { TTL_MEDIUM, TTL_LONG, READINESS_SCORE_TTL, MUSCLE_RECOVERY_TTL, HEALTH_TRENDS_SUMMARY_TTL, DAY_LOG_TTL } from '@trainingai/shared/cache-ttl';
import type { HealthTrendsResponse } from "@/app/api/health/trends/route";
import type { SleepDetailReading } from "@/components/health-metric-sheet";
import { MetricSheets } from "@/components/health/metric-sheets";
import { DayOverlaySheet } from "@/components/health/day-overlay-sheet";
import { ExerciseHistorySheet } from "@/components/exercise-history-sheet";
import { DayOverlayDialogs } from "@/components/health/day-overlay-dialogs";
import { useDayEntryMutations } from "@/lib/hooks/use-day-entry-mutations";
import { WaterLogSheet } from '@/components/profile/water-log-sheet'
import { MetricLogSheet, type LogField, type LogState } from '@/components/health/metric-log-sheet'
import type { Injury } from "@trainingai/shared/types/injury";
const ActivityDetailSheet = dynamic(
  () => import('@/components/activity/activity-detail-sheet').then(m => ({ default: m.ActivityDetailSheet })),
  { ssr: false },
);

import type { WeeklyStatsResponse } from "@/app/api/weekly-stats/route";
import type { MuscleSetsEntry } from "@/app/api/weekly-muscle-sets/route";
import type { StrengthTrendEntry } from "@/app/api/strength-trend/route";
import type { DayLogResult } from "@/app/api/day-log/route";
import type { ProgressSummaryResponse } from "@/app/api/progress-summary/route";
import type { ProgramSession } from "@trainingai/shared/types/program";
import type { ActivityLog, ActivityType } from "@trainingai/shared/types";
import type { UserGoals } from "@/lib/data/repository";
import type { ActivityLevel } from '@trainingai/shared/types/user'
import type { ReadinessScoreResponse } from '@/app/api/readiness-score/route'
import { useBmiClassification, useWeightTrend, useEnergyBalanceToday } from "@/app/health/hooks/use-health-calcs";
import { classifyHrResponse, type HrSessionState, type HrDataResponse } from "@trainingai/shared/workout/hr-session-state";
import { useInvalidationRefetch } from "@/lib/hooks/use-invalidation-refetch";

type Tab = "body" | "training" | "progress";

// Labelled groups for the Body tab — replaces the old flat 14-card scroll, which scattered
// heart data across 4 positions and left sleep far from its correlation card.
type BodyGroup = { header: string; cards: string[] };
const BODY_GROUPS: BodyGroup[] = [
  { header: "Body",              cards: ["bodyWeight", "bodyFat", "leanMass", "bodyComposition", "caloriesBurned", "weightTrend"] },
  { header: "Sleep",             cards: ["sleep"] },
  { header: "Heart & recovery",  cards: ["rhr", "measureHr", "hrDay", "hrvBaseline", "trainingLoad", "timeInZone", "sleepVsPerformance", "hrRecoveryProfile"] },
  { header: "Activity & intake", cards: ["energyBudget", "steps", "waterIntake", "nutritionActivityTrends"] },
  { header: "Ring",              cards: ["ouraSection"] },
  // "injury" (the Muscle Status body-map card) is intentionally NOT here — it's pinned first
  // at the top of the Body panel as the tab's main attraction (see the pinned hero below).
];
// "aiVolume" (Weekly Volume vs Target) is intentionally omitted: it duplicates the
// "Muscle Volume This Week" card and, being scoped to the active program, reads 0.0 on a
// freshly-created program. The seeded per-muscle targets still drive the AI engine; the
// visualisation is deferred until it's merged into a single volume card.
const TRAINING_ORDER = ["calendar","weeklyStats","aiPeriodization","muscleSets","baselineTests","activityHistory","workoutDensity"];
const PROGRESS_ORDER = ["strengthTrend","trends","strengthProgress","goalsProgress","weightTrendProgress"];

interface SleepRow {
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
  phaseWindowStart?: string | null;
  phaseWindowEnd?: string | null;
  sleepTimeRecommendation?: string | null;
}


interface HealthContentProps {
  userId?: string
  sex?: string | null
  heightCm?: number | null
  dateOfBirth?: string | null
  activityLevel?: ActivityLevel | null
}

export default function HealthContent({ userId, sex: sexProp, heightCm: heightCmProp }: HealthContentProps) {
  const tz = useUserTimezone();
  const searchParams = useSearchParams();
  const router = useTransitionRouter();
  const { epoch: tabEpoch } = useTabVisibility();
  const [tab, setTab] = useState<Tab>(() => {
    const p = searchParams.get('tab');
    return (p === 'body' || p === 'training' || p === 'progress') ? p as Tab : 'training';
  });
  useEffect(() => {
    const p = searchParams.get('tab');
    if (p === 'body' || p === 'training' || p === 'progress') setTab(p as Tab);
  }, [searchParams]);
  const [metaToday, setMetaToday] = useState<BodyMetaRow | null>(null);
  const [metaRecent, setMetaRecent] = useState<BodyMetaRow[]>([]);
  const [metaLoading, setMetaLoading] = useState(true);
  const [sleepRows, setSleepRows] = useState<SleepRow[]>([]);
  const [readiness, setReadiness] = useState<ReadinessScoreResponse | null>(null);
  const [logState, setLogState] = useState<LogState | null>(null);
  const [waterLogOpen, setWaterLogOpen] = useState(false);
  const [openInfo, setOpenInfo] = useState<string | null>(null);
  const toggleInfo = (key: string) => setOpenInfo(v => v === key ? null : key);
  const [latestWeightMeta, setLatestWeightMeta] = useState<{ kg: number | null; date: string | null }>({ kg: null, date: null });
  const [activeEnergyKcalToday, setActiveEnergyKcalToday] = useState<number | null>(null);
  const [metricSheet, setMetricSheet] = useState<
    null | "weight" | "bodyFat" | "steps" | "sleep" | "restingHR" | "hrv" | "spo2"
  >(null);
  // Q-93-followup: a "Woke up"/"Fell asleep" timeline card deep-links here with the night's
  // date, pre-opening the sleep sheet straight to that night's detail view instead of the list.
  const [initialSleepDate, setInitialSleepDate] = useState<string | null>(null);
  useEffect(() => {
    const d = searchParams.get('openSleepDate');
    if (d) { setInitialSleepDate(d); setMetricSheet('sleep'); }
  }, [searchParams]);
  const [trainingLoad, setTrainingLoad] = useState<import('@/app/api/training-load/route').TrainingLoadResponse | null>(null);
  const [sleepCorr, setSleepCorr] = useState<import('@/app/api/sleep-performance-correlation/route').SleepCorrelationResponse | null>(null);

  const [weeklyStats, setWeeklyStats] = useState<WeeklyStatsResponse | null>(null);
  // Fetched once here and passed down to OuraSection/WorkoutDensityCard/NutritionActivityTrendsCard
  // (PERF-4) — those three previously each independently fetched the same key, and their
  // staggered dynamic-import mount times defeated cachedFetch's in-flight dedup.
  const [healthTrends, setHealthTrends] = useState<HealthTrendsResponse['trends'] | undefined>(undefined);
  const [muscleSets, setMuscleSets] = useState<MuscleSetsEntry[] | null>(null);
  const [strengthTrend, setStrengthTrend] = useState<StrengthTrendEntry[] | null>(null);
  const [activeSessions, setActiveSessions] = useState<ProgramSession[]>([]);
  const [dayOverlay, setDayOverlay] = useState<{
    date: string;
    data: DayLogResult | null;
    loading: boolean;
    expanded: string | null;
  } | null>(null);

  const [sessionHrData, setSessionHrData] = useState<Record<string, HrSessionState>>({});
  const [historyExercise, setHistoryExercise] = useState<string | null>(null);
  const [selectedActivity, setSelectedActivity] = useState<ActivityLog | null>(null);
  const [activityTypes, setActivityTypes] = useState<ActivityType[]>([]);

  // ONLY the first-paint seed (Q-241): `userGoals` below supersedes them the moment it loads. See
  // the hook for why it re-reads on tabEpoch rather than on mount alone (Q-260).
  const { waterGoalSeed, targetWeightSeed, targetBfSeed } = useGoalSeeds(tabEpoch);
  const [weekToDate, setWeekToDate] = useState<WeekToDate | null>(null);
  const [progressSummary, setProgressSummary] = useState<ProgressSummaryResponse | null>(null);
  const [userGoals, setUserGoals] = useState<UserGoals | null>(null);

  // Once the server payload exists it is the whole truth, including its nulls — falling back to the
  // seed per-field would let a goal the user cleared keep rendering from the device copy forever.
  const waterGoalMl = userGoals ? (userGoals.waterGoalMl ?? 2500) : (waterGoalSeed ?? 2500);
  const targetWeightKg = userGoals ? userGoals.targetWeightKg : targetWeightSeed;
  const targetBfPct = userGoals ? userGoals.targetBfPct : targetBfSeed;
  const [injuries, setInjuries] = useState<Injury[] | null>(null);
  const [recoveryMuscles, setRecoveryMuscles] = useState<import('@/app/api/muscle-recovery/route').MuscleRecoveryEntry[]>([]);

  // Carousel state
  const TABS: Tab[] = ['body', 'training', 'progress'];
  const tabIndex = TABS.indexOf(tab);

  // Paint the non-today-specific parts of a body-metadata payload (trend arrays, week-to-date)
  // immediately, even from a stale (not-today) cache entry — only `metaToday`/`activeEnergyKcalToday`
  // (today's tiles, which already render "—" for null) wait for a freshness-confirmed payload.
  const setMetaFromPayload = useCallback((data: { today: BodyMetaRow | null; recent: BodyMetaRow[]; weekToDate?: WeekToDate | null; activeEnergyKcalToday?: number | null; latestWeightKg?: number | null; latestWeightDate?: string | null } | null | undefined) => {
    if (!data) return;
    setMetaRecent(data.recent ?? []);
    setWeekToDate(data.weekToDate ?? null);
    setMetaLoading(false);
    if (data.latestWeightKg !== undefined) setLatestWeightMeta({ kg: data.latestWeightKg ?? null, date: data.latestWeightDate ?? null });
    if (isBodyMetadataFresh(data, tz)) {
      setMetaToday(data.today ?? null);
      if (data.activeEnergyKcalToday !== undefined) setActiveEnergyKcalToday(data.activeEnergyKcalToday ?? null);
    }
  }, [tz]);

  // Seed from sessionStorage mirror synchronously before first paint
  useLayoutEffect(() => {
    const meta = readCacheSync<{ today: BodyMetaRow | null; recent: BodyMetaRow[]; weekToDate?: WeekToDate | null }>('body-metadata');
    if (meta) setMetaFromPayload(meta);
    const sleep = readCacheSync<SleepRow[]>('sleep-sessions');
    if (sleep) setSleepRows(Array.isArray(sleep) ? sleep : []);
    const cached = readTodayCacheSync<ReadinessScoreResponse>('readiness-score');
    if (cached) setReadiness(cached);
    const progress = readTodayCacheSync<ProgressSummaryResponse>('progress-summary');
    if (progress) setProgressSummary(progress);
    const goals = readCacheSync<UserGoals>('user-goals');
    if (goals) setUserGoals(goals);
    // Seed active sessions synchronously so Training Load bars render with correct
    // palette colors on first paint instead of falling back to the hash function.
    const workoutMeta = readCacheSync<{ program?: { sessions?: ProgramSession[] } }>('workout-data:meta');
    if (workoutMeta?.program?.sessions?.length) setActiveSessions(workoutMeta.program.sessions);
    // Seed training load so the card renders immediately without a skeleton.
    const trainingLoadCached = readTodayCacheSync<import('@/app/api/training-load/route').TrainingLoadResponse>('training-load');
    if (trainingLoadCached && trainingLoadCached.interpretation !== 'insufficient_data') setTrainingLoad(trainingLoadCached);
    // Seed the Training-tab cards (Muscle Volume, Muscle Status heatmap + injuries)
    // so they paint from cache instead of flashing a skeleton on every open.
    const muscleSetsCached = readCacheSync<{ muscles: MuscleSetsEntry[] }>('weekly-muscle-sets');
    if (muscleSetsCached?.muscles) setMuscleSets(muscleSetsCached.muscles);
    const recoveryCached = readCacheSync<{ muscles: import('@/app/api/muscle-recovery/route').MuscleRecoveryEntry[] }>('muscle-recovery');
    if (recoveryCached?.muscles) setRecoveryMuscles(recoveryCached.muscles);
    const injuriesCached = readCacheSync<Injury[]>('injuries');
    if (injuriesCached) setInjuries(Array.isArray(injuriesCached) ? injuriesCached : []);
    // Seed WeeklyStatsHub so it paints instantly on the repeat visit instead of skeleton.
    const ws = readTodayCacheSync<WeeklyStatsResponse>('weekly-stats');
    if (ws) setWeeklyStats(ws);
    const trendsCached = readTodayCacheSync<HealthTrendsResponse>('health-trends-summary');
    if (trendsCached?.trends) setHealthTrends(trendsCached.trends);
  }, [setMetaFromPayload]);

  const fetchMeta = useCallback(async () => {
    // Local-store read and the network fetches start together (not sequentially) — the
    // local-store seed lands first as a fast-path paint, network results (fresher) win
    // whenever they arrive, since both write through the same setters.
    const localSeedPromise = (async () => {
      if (!userId) return;
      const store = getLocalStore(userId);
      if (!store) return;
      const cutoff = new Date(todayMidnightUtc().getTime() - 30 * 24 * 60 * 60 * 1000);
      const cutoffStr = toAestDay(cutoff);
      const [localMetrics, localSleep] = await Promise.all([
        store.getBodyMetrics(cutoffStr),
        store.getSleepSessions(cutoffStr),
      ]);
      if (localMetrics.length > 0) {
        const filtered = localMetrics.filter(m => !m.deletedAt);
        const toRow = (m: typeof filtered[number]): BodyMetaRow => ({
          date: m.date,
          weightKg: m.weightKg,
          bodyFat: m.bodyFatPct,
          calories: m.calories,
          protein: m.proteinG,
          carb: m.carbsG,
          fat: m.fatG,
          steps: m.steps,
          distanceKm: null,
          restingHeartRate: m.restingHeartRate,
          hrvMs: m.hrvMs,
          spo2Pct: m.spo2Pct,
          waterMl: m.waterMl,
          waistCm: m.waistCm,
          chestCm: m.chestCm,
          armCm: m.armCm,
          thighCm: m.thighCm,
          hipCm: m.hipCm,
          neckCm: m.neckCm,
          skeletalMusclePct: m.skeletalMusclePct,
          fatFreeMassKg: m.fatFreeMassKg,
          subcutaneousFatPct: m.subcutaneousFatPct,
          visceralFatIndex: m.visceralFatIndex,
          bodyWaterPct: m.bodyWaterPct,
          muscleMassKg: m.muscleMassKg,
          boneMassKg: m.boneMassKg,
          proteinPct: m.proteinPct,
          bmrKcal: m.bmrKcal,
          metabolicAge: m.metabolicAge,
        });
        setMetaRecent(filtered.map(toRow));
        // SYNC-R2: the local seed previously never set today's tile, so an offline fresh
        // app-open on Health left steps/weight blank until the network fetch landed —
        // mirrors session-select-content.tsx's Home fetchMeta pattern (SYNC-R1).
        const todayStr = todayInTz();
        const todayRow = filtered.find(m => m.date === todayStr);
        if (todayRow) setMetaToday(toRow(todayRow));
        setMetaLoading(false);
      }
      if (localSleep.length > 0) setSleepRows(localSleep as unknown as SleepRow[]);
    })();
    const networkPromise = Promise.all([
      cachedFetch<{ today: BodyMetaRow | null; recent: BodyMetaRow[]; weekToDate?: WeekToDate | null; activeEnergyKcalToday?: number | null }>(
        'body-metadata', '/api/body-metadata', TTL_MEDIUM,
        setMetaFromPayload,
      ),
      cachedFetch<SleepRow[]>(
        'sleep-sessions', '/api/sleep-sessions', TTL_MEDIUM,
        (data) => setSleepRows(Array.isArray(data) ? data : []),
      ),
      cachedFetchToday<ReadinessScoreResponse>(
        'readiness-score', '/api/readiness-score', READINESS_SCORE_TTL,
        (data) => setReadiness(data),
      ),
    ]);
    await Promise.all([localSeedPromise, networkPromise]);
    setMetaLoading(false);
  }, [userId, setMetaFromPayload]);

  // Q-91: a BLE drain settling or an admin Redecode both invalidate the 'sleep-sessions'
  // cache entry (invalidateOuraSync) but this screen, once mounted, never learned to
  // refetch it — the hypnogram/sleep cards looked "stuck missing" until the next
  // navigate-away/remount. fetchMeta already includes 'sleep-sessions' in its fetch set.
  // The three keys `fetchMeta` reads, not the one event that used to trigger it.
  useInvalidationRefetch(['body-metadata', 'sleep-sessions', 'readiness-score'], () => { fetchMeta(); });

  // Fetches all data shown on this screen. Called on mount and after pull-to-sync.
  // This screen has three sub-tabs and renders one at a time, but used to fetch
  // all three tabs' data on every mount — 13 requests to populate roughly a
  // third of them. The owner's device capture put Health at 53–85 requests, the
  // heaviest screen in the app by 2–3×.
  //
  // The fetches are now split by which tab consumes the state (derived from what
  // renderBodySection / renderTrainingSection / renderProgressSection actually
  // read, not guessed), and a tab's group fires when that tab is shown.
  //
  // No "already loaded" bookkeeping is needed: cachedFetch dedups in flight and
  // honours its TTL, so re-firing a group on a tab revisit is a cache hit rather
  // than a request. That also keeps the tabEpoch refresh semantics intact — a
  // return to Health still revalidates, it just revalidates one tab's worth.
  //
  // Concurrency stays capped so a burst can't demand more than the server's
  // 10-connection pool at once (each endpoint fans out 6–7 DB queries).

  // Consumed by more than one tab — always fetched.
  const fetchSharedHealthData = useCallback(async () => {
    await runWithConcurrency([
      () => fetchMeta(),
      () => cachedFetchToday<HealthTrendsResponse>(
        'health-trends-summary', '/api/health/trends', HEALTH_TRENDS_SUMMARY_TTL,
        d => { if (d?.trends) setHealthTrends(d.trends) },
      ),
      () => cachedFetchToday<ProgressSummaryResponse>(
        'progress-summary', '/api/progress-summary', TTL_MEDIUM,
        d => { if (d) setProgressSummary(d) },
      ),
      () => cachedFetch<{ muscles: import('@/app/api/muscle-recovery/route').MuscleRecoveryEntry[] }>(
        'muscle-recovery', '/api/muscle-recovery', MUSCLE_RECOVERY_TTL,
        d => { if (d?.muscles) setRecoveryMuscles(d.muscles) },
      ),
      // Shared, not Progress-only (Q-260): `waterIntake` is a BODY_GROUPS card, so while this sat in
      // fetchProgressHealthData the Body goal was fetched only by a tab the user may never open.
      () => cachedFetch<UserGoals>(
        'user-goals', '/api/user/goals', TTL_MEDIUM,
        d => { if (d) setUserGoals(d) },
      ),
      // Not read by any section renderer, but consumed by the log sheets this
      // screen opens — keep it unconditional rather than tie it to a tab.
      () => cachedFetch<{ activityTypes: ActivityType[] }>(
        'activity-types', '/api/activity-types', TTL_LONG,
        d => setActivityTypes(d?.activityTypes ?? []),
        { freshWithinTtl: true },
      ),
    ], 4);
  }, [fetchMeta]);

  const fetchBodyHealthData = useCallback(async () => {
    await runWithConcurrency([
      () => cachedFetchToday<import('@/app/api/training-load/route').TrainingLoadResponse>(
        'training-load', '/api/training-load', TTL_MEDIUM,
        d => { if (d && d.interpretation !== 'insufficient_data') setTrainingLoad(d) },
      ),
      () => cachedFetch<import('@/app/api/sleep-performance-correlation/route').SleepCorrelationResponse>(
        'sleep-performance-correlation', '/api/sleep-performance-correlation', TTL_MEDIUM,
        d => { if (d) setSleepCorr(d) },
      ),
      () => cachedFetch<Injury[]>(
        'injuries', '/api/injuries', TTL_MEDIUM,
        d => setInjuries(Array.isArray(d) ? d : []),
      ),
    ], 4);
    // Local-first: the on-device store wins over the server list once it has rows.
    if (userId) {
      const store = getLocalStore(userId);
      if (store) {
        store.getInjuries().then(local => {
          if (local.length > 0) {
            const mapped: Injury[] = local.map(r => ({
              id: r.id, userId, muscleName: r.muscleName, notes: r.notes,
              severity: r.severity, startedDate: r.startedDate,
              resolvedDate: r.resolvedDate, createdAt: r.createdAt, updatedAt: r.updatedAt,
            }));
            setInjuries(mapped);
            setCached('injuries', mapped, TTL_MEDIUM).catch(() => {});
          }
        }).catch(() => {});
      }
    }
  }, [userId]);

  const fetchTrainingHealthData = useCallback(async () => {
    await runWithConcurrency([
      () => cachedFetchToday<WeeklyStatsResponse>(
        'weekly-stats', '/api/weekly-stats', TTL_MEDIUM,
        d => { if (d) setWeeklyStats(d) },
      ),
      () => cachedFetch<{ muscles: MuscleSetsEntry[] }>(
        'weekly-muscle-sets', '/api/weekly-muscle-sets', TTL_MEDIUM,
        d => { if (d) setMuscleSets(d.muscles) },
      ),
      () => cachedFetch<{ program?: { sessions?: ProgramSession[] } }>(
        'workout-data:meta', '/api/workout-data?tab=meta', TTL_LONG,
        d => { if (d?.program?.sessions?.length) setActiveSessions(d.program.sessions) },
      ),
    ], 4);
  }, []);

  // Single fetch since `user-goals` moved to the shared group (Q-260), so no concurrency cap needed.
  const fetchProgressHealthData = useCallback(async () => {
    await cachedFetch<{ exercises: StrengthTrendEntry[] }>(
      'strength-trend', '/api/strength-trend', TTL_MEDIUM,
      d => { if (d) setStrengthTrend(d.exercises) },
    );
  }, []);

  const fetchActiveTabHealthData = useCallback(() => {
    if (tab === 'body') return fetchBodyHealthData();
    if (tab === 'training') return fetchTrainingHealthData();
    return fetchProgressHealthData();
  }, [tab, fetchBodyHealthData, fetchTrainingHealthData, fetchProgressHealthData]);

  /**
   * Re-fetch everything the user can currently see. Used after a sync invalidates
   * caches — the other two tabs don't need refetching here because their cache
   * entries were invalidated too, so they revalidate when next shown.
   */
  const refreshVisibleHealthData = useCallback(async () => {
    await Promise.all([fetchSharedHealthData(), fetchActiveTabHealthData()]);
  }, [fetchSharedHealthData, fetchActiveTabHealthData]);

  useEffect(() => {
    fetchSharedHealthData();
  }, [fetchSharedHealthData, tabEpoch]);

  useEffect(() => {
    fetchActiveTabHealthData();
  }, [fetchActiveTabHealthData, tabEpoch]);

  // Local-first seed for strength trend — reads exercise 1RM history from local SQLite
  // before the network resolves. Server response overwrites once available.
  useEffect(() => {
    const store = userId ? getLocalStore(userId) : null;
    if (!store) return;
    const cutoffStr = shiftDateStr(todayInTz(), -90);
    Promise.all([store.getWorkoutHistory(cutoffStr), store.getExerciseLibrary().catch(() => [])])
      .then(([history, library]) => {
      const typeByName = new Map(library.map(e => [e.nameKey, e.exerciseType]));
      const byExercise = new Map<string, { date: string; rm: number }[]>();
      for (const { exerciseLogs } of history) {
        for (const el of exerciseLogs) {
          if (el.estimated1rm == null || el.estimated1rm <= 0) continue;
          const date = el.loggedAt.slice(0, 10);
          const arr = byExercise.get(el.exerciseName) ?? [];
          arr.push({ date, rm: el.estimated1rm });
          byExercise.set(el.exerciseName, arr);
        }
      }
      const localEntries: StrengthTrendEntry[] = [];
      for (const [name, hist] of byExercise) {
        hist.sort((a, b) => a.date.localeCompare(b.date));
        const rms = hist.map(h => h.rm);
        const currentRm = rms[rms.length - 1];
        const peakRm = Math.max(...rms);
        const startRm = rms[0] ?? null;
        const gainPct = hist.length >= 2 && startRm != null && startRm > 0
          ? Math.round(((currentRm - startRm) / startRm) * 100)
          : null;
        // Typed from the mirrored catalogue (Q-20) so a bodyweight movement renders as reps
        // offline instead of kg; 'weighted' remains the fallback for an exercise the mirror
        // hasn't seen yet.
        const exerciseType = typeByName.get(name.toLowerCase()) ?? 'weighted';
        localEntries.push({ name, exerciseType, history: hist, currentRm, peakRm, startRm, gainPct });
      }
      localEntries.sort((a, b) => {
        const aLast = a.history[a.history.length - 1]?.date ?? '';
        const bLast = b.history[b.history.length - 1]?.date ?? '';
        return bLast.localeCompare(aLast);
      });
      if (localEntries.length > 0) setStrengthTrend(prev => prev ?? localEntries);
    }).catch(() => {});
  }, [userId]);

  const handlePullSync = useCallback(async () => {
    if (userId) await pushMutations(userId).catch(() => {});
    // The Oura Cloud half of this pull is gone (owner, 2026-08-13): the ring has been on our own
    // BLE key since the re-key, so the Cloud had nothing to hand back. The ring itself is drained
    // by the BLE service; a manual pull reconciles the outbox and re-reads local data.
    if (userId) await pullDelta(userId, true).catch(() => {});
    Promise.all([invalidateOuraSync(), invalidateBiometrics(), invalidateHealthTrends()])
      .then(() => refreshVisibleHealthData())
      .catch(() => {});
  }, [userId, refreshVisibleHealthData]);

  const fetchDayOverlay = useCallback(async (date: string) => {
    await cachedFetch<DayLogResult>(
      `day-log:${date}`, `/api/day-log?date=${encodeURIComponent(date)}`, DAY_LOG_TTL,
      (data) => setDayOverlay(prev => prev ? { ...prev, data, loading: false } : null),
    ).finally(() => setDayOverlay(prev => (prev && prev.data === null) ? { ...prev, loading: false } : prev));
  }, []);

  // Q-110: the calendar's day-tap opens the dedicated day screen, not the bottom sheet. The note
  // here used to add "the overlay is still opened from other surfaces" — **that was wrong, and it
  // is what kept the sheet alive**: `dayOverlay` starts null and every setter is a
  // `prev => prev ? … : null` no-op or `null`, so nothing can open it. Retiring it is LB-1.
  const handleDayClick = useCallback((date: string) => {
    router.push(`/health/day?date=${encodeURIComponent(date)}`);
  }, [router]);

  const loadSessionHr = useCallback(async (workoutSessionId: string) => {
    const existing = sessionHrData[workoutSessionId];
    // Skip if a load is in flight or we already have real data; retry on the
    // empty sentinels ('none'/'incomplete') so a later expand re-pulls once the
    // background sync has landed (acceptance: renders on second expand at latest).
    if (existing === 'loading') return;
    if (existing && existing !== 'none' && existing !== 'incomplete') return;
    setSessionHrData(prev => ({ ...prev, [workoutSessionId]: 'loading' }));
    try {
      // Re-attribute already-ingested BLE heart rate to this session before reading (mirrors the
      // Done screen, done-screen.tsx). Fire it and ignore transport errors — the route itself is
      // fail-soft and returns { success, readings }.
      await fetch('/api/oura/hr-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workoutSessionId }),
      }).catch(() => {});
      const res = await fetch(`/api/oura/hr-data?sessionId=${workoutSessionId}`);
      const data = await res.json() as HrDataResponse;
      setSessionHrData(prev => ({ ...prev, [workoutSessionId]: classifyHrResponse(data) }));
    } catch {
      setSessionHrData(prev => ({ ...prev, [workoutSessionId]: 'none' }));
    }
  }, [sessionHrData]);

  const refreshDayOverlay = useCallback(async (date: string) => {
    setDayOverlay(prev => prev ? { ...prev, data: null, loading: true } : null);
    await fetchDayOverlay(date);
  }, [fetchDayOverlay]);

  // LB-1: these four handlers now live in useDayEntryMutations, shared with /health/day — which is
  // where the calendar's day-tap actually lands since Q-110. Keeping a second copy here was how the
  // two paths would drift; there is one write path per domain and both callers use it.
  const overlayDate = useCallback(() => dayOverlay?.date ?? "", [dayOverlay]);
  const mut = useDayEntryMutations(userId, overlayDate, refreshDayOverlay);

  const lastSleep = sleepRows[0] ?? null;
  // Only treat sleep as "recent" if it's from last night or today — prevents
  // stale data from days ago showing on the card as if it's current.
  const todayStr = todayInTz()
  const yesterdayStr = shiftDateStr(todayStr, -1)
  const recentSleep = lastSleep && lastSleep.date >= yesterdayStr ? lastSleep : null

  const openLog = (field: LogField, label: string, unit: string, step: number) => {
    let current: number | null | undefined = metaToday?.[field];
    if (field === "weightKg" && current == null) {
      current = metaRecent.find(r => r.weightKg != null)?.weightKg ?? null;
    }
    setLogState({ field, label, unit, step, value: current != null ? String(current) : "" });
  };

  // Hoisted so the 6 metaRecent-derived HealthMetricSheets below don't each re-reverse the
  // array on every render of this ~30-state-hook orchestrator.
  const metaRecentReversed = useMemo(() => [...metaRecent].reverse(), [metaRecent]);

  const latestWeight = metaToday?.weightKg ?? metaRecent.find(r => r.weightKg != null)?.weightKg ?? latestWeightMeta.kg ?? null;
  // Whether the displayed weight is a fall-back to an older reading (nothing in the last 7 days).
  const latestWeightIsStale = metaToday?.weightKg == null && metaRecent.find(r => r.weightKg != null)?.weightKg == null && latestWeightMeta.kg != null;
  const latestSteps  = metaToday?.steps ?? null;
  const latestDistanceKm = metaToday?.distanceKm ?? null;
  const latestBf = metaRecentReversed.map(r => r.bodyFat).find((v): v is number => v != null) ?? null;

  const todayWaterMl = (metaToday as (typeof metaToday & { waterMl?: number | null }) | null)?.waterMl ?? null;
  const bodyBaseline = progressSummary?.bodyBaseline ?? { weightKg: null, bodyFatPct: null };

  const heightCm = heightCmProp ?? null;

  const { bmi, bmiUsesBf, bmiLabel } = useBmiClassification(latestWeight, heightCm, latestBf, sexProp);
  const weightTrendKgPerWeek = useWeightTrend(metaRecent);
  const energyBalance = useEnergyBalanceToday();
  const energyBalanceKcal = energyBalance?.balance?.netKcal ?? null;


  const { isSectionVisible, renderBodySection, renderTrainingSection, renderProgressSection } = getHealthSections({
    metaLoading, metaToday, metaRecent, latestWeight, latestWeightIsStale, latestWeightDate: latestWeightMeta.date, latestBf, latestSteps,
    latestDistanceKm, targetWeightKg, targetBfPct, openInfo, toggleInfo, openLog,
    setMetricSheet, setWaterLogOpen, recentSleep, lastSleep, readiness,
    todayWaterMl, waterGoalMl, activeEnergyKcalToday, bmi, bmiLabel, bmiUsesBf,
    weightTrendKgPerWeek, energyBalanceKcal, energyBalance, trainingLoad, sleepCorr, injuries,
    setInjuries, userId, recoveryMuscles, handleDayClick, weeklyStats,
    activeSessions, muscleSets, strengthTrend, weekToDate, userGoals,
    progressSummary, bodyBaseline, healthTrends,
  });


  return (
    <div className="flex flex-col bg-page h-screen">
      <ScreenHeader
        title="Health"
        subtitle="Body & training"
      />

      <SegmentedTabs
        className="px-4 pt-3 pb-0 shrink-0"
        tabs={[
          { value: "body", label: "Body" },
          { value: "training", label: "Training" },
          { value: "progress", label: "Progress" },
        ] as const}
        value={tab}
        onValueChange={setTab}
      />

      {/* Carousel viewport */}
      <SwipeCarousel
        className="flex-1"
        index={tabIndex}
        onIndexChange={(i) => setTab(TABS[i])}
      >
        {[
          /* Body panel */
          <div key="body" className="h-full flex flex-col">
            <PullToSync
              onSync={handlePullSync}
              scrollClassName="flex-1 overflow-y-auto pb-nav-safe px-4 pt-4 space-y-4"
              className="flex-1 flex flex-col overflow-hidden"
            >
              <div className="space-y-6">
                {/* Muscle Status hero — the injury/recovery muscle map, pinned first (outside the
                    labelled groups) as the Body tab's main attraction. Moved up from the old
                    bottom "Injuries" section. */}
                <div className="space-y-3">
                  {renderBodySection("injury")}
                </div>
                {BODY_GROUPS.map(g => {
                  const visible = g.cards.filter(k => isSectionVisible(k));
                  if (visible.length === 0) return null;
                  return (
                    <div key={g.header} className="space-y-3">
                      <SectionHeader label={g.header} />
                      <div className="space-y-4">
                        {visible.map((k) => renderBodySection(k))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </PullToSync>
          </div>,

          /* Training panel */
          <div key="training" className="h-full flex flex-col">
            <PullToSync
              onSync={handlePullSync}
              scrollClassName="flex-1 overflow-y-auto pb-nav-safe px-4 pt-4 space-y-4"
              className="flex-1 flex flex-col overflow-hidden"
            >
              <div className="space-y-4">
                {TRAINING_ORDER.map((k) => renderTrainingSection(k))}
              </div>
            </PullToSync>
          </div>,

          /* Progress panel */
          <div key="progress" className="h-full flex flex-col">
            <PullToSync
              onSync={handlePullSync}
              scrollClassName="flex-1 overflow-y-auto pb-nav-safe px-4 pt-4 space-y-4"
              className="flex-1 flex flex-col overflow-hidden"
            >
              <div className="space-y-4">
                {PROGRESS_ORDER.map((k) => renderProgressSection(k))}
              </div>
            </PullToSync>
          </div>,
        ]}
      </SwipeCarousel>

      <MetricLogSheet
        logState={logState}
        userId={userId}
        onClose={() => setLogState(null)}
        onSaved={(freshMeta) => {
          if (freshMeta) {
            setMetaToday(freshMeta);
            invalidateReadinessInputs().catch(() => {});
          } else {
            invalidateBodyMetricWrite();
            invalidateReadinessInputs();
            fetchMeta();
          }
        }}
      />
      <WaterLogSheet
        open={waterLogOpen}
        onOpenChange={setWaterLogOpen}
        onLogged={() => { fetchMeta(); }}
        userId={userId}
      />

      {/* ── Metric detail sheets ── */}
      <MetricSheets
        metricSheet={metricSheet}
        onClose={() => { setMetricSheet(null); setInitialSleepDate(null); }}
        metaRecentReversed={metaRecentReversed}
        sleepReadings={[...sleepRows] as SleepDetailReading[]}
        initialSleepDate={initialSleepDate}
      />

      <DayOverlayDialogs
        editEx={mut.editEx}
        onEditExChange={mut.setEditEx}
        onEditSave={mut.handleEditSave}
        deleteEx={mut.deleteEx}
        onDeleteExClose={() => mut.setDeleteEx(null)}
        onDeleteExConfirm={mut.handleDeleteExercise}
        deleteActivity={mut.deleteActivity}
        onDeleteActivityClose={() => mut.setDeleteActivity(null)}
        onDeleteActivityConfirm={mut.handleDeleteActivity}
        deleteSession={mut.deleteSession}
        onDeleteSessionClose={() => mut.setDeleteSession(null)}
        onDeleteSessionConfirm={mut.handleDeleteSession}
        mutating={mut.mutating}
      />

      <DayOverlaySheet
        dayOverlay={dayOverlay}
        setDayOverlay={setDayOverlay}
        onClose={() => setDayOverlay(null)}
        activeSessions={activeSessions}
        activityTypes={activityTypes}
        sessionHrData={sessionHrData}
        loadSessionHr={loadSessionHr}
        onEditExercise={mut.setEditEx}
        onDeleteExercise={mut.setDeleteEx}
        onExerciseTap={setHistoryExercise}
        onDeleteSession={mut.setDeleteSession}
        onSelectActivity={setSelectedActivity}
        onDeleteActivity={mut.setDeleteActivity}
      />

      <ExerciseHistorySheet
        exerciseName={historyExercise}
        userId={userId}
        onClose={() => setHistoryExercise(null)}
      />

      <ActivityDetailSheet
        log={selectedActivity}
        icon={activityTypes.find(t => t.id === selectedActivity?.activityType)?.icon ?? 'DotsThreeCircle'}
        onOpenChange={open => { if (!open) setSelectedActivity(null); }}
      />

    </div>
  );
}
