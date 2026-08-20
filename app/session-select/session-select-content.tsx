"use client";

import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from "react";
import { useUserTimezone } from "@/components/shell/user-timezone-provider";
import { useTransitionRouter } from "@/lib/view-transition";
import type { ProgramSession, Program, NextSessionRecommendation } from "@trainingai/shared/types/program";
import { getScheduledSessionsPerWeek } from "@trainingai/shared/schedule-utils";
import { useTabVisibility } from "@/components/shell/tab-visibility";
import { navigateToTab } from "@/lib/shell-nav";
import { Meteors } from "@/components/ui/meteors";
import { Skeleton } from "@/components/ui/skeleton";
import { ScreenHeader } from "@/components/shell/screen-header";
import { toast } from "sonner";
import { RefreshCwIcon, LayoutGridIcon, Clock, Dumbbell, Calendar, Download, X, Eye } from "lucide-react";
import { HomeSortableSection } from "@/components/home-sortable-section";
import type { BodyMetaRow } from "@/app/api/body-metadata/route";
import dynamic from "next/dynamic";
import { CoachFab } from "@/components/coach/coach-fab";
import Image from "next/image";
const WeatherChip = dynamic(() => import("@/components/weather-chip").then(m => m.WeatherChip), { ssr: false });
// Sheets: code-split, not statically bundled. Each renders nothing until its `open`/id prop says so,
// so their code has no business in the initial parse — moving it to per-sheet chunks takes it off
// the cold-start critical path, which the device profile put at JS parse/execute (Q-51 Task 1).
const MoodCheckInSheet = dynamic(() => import("@/components/mood-checkin-sheet").then(x => ({ default: x.MoodCheckInSheet })), { ssr: false });
const MorningCheckinSheet = dynamic(() => import("@/components/morning-checkin-sheet").then(x => ({ default: x.MorningCheckinSheet })), { ssr: false });
const ExerciseHistorySheet = dynamic(() => import("@/components/exercise-history-sheet").then(x => ({ default: x.ExerciseHistorySheet })), { ssr: false });
const WaterLogSheet = dynamic(() => import("@/components/profile/water-log-sheet").then(x => ({ default: x.WaterLogSheet })), { ssr: false });
const DayReviewSheet = dynamic(() => import("@/components/day-review-sheet").then(x => ({ default: x.DayReviewSheet })), { ssr: false });
const WeekDaySheet = dynamic(() => import("./components/week-day-sheet").then(x => ({ default: x.WeekDaySheet })), { ssr: false });
const LogValueSheet = dynamic(() => import("./components/log-value-sheet").then(x => ({ default: x.LogValueSheet })), { ssr: false });
import { cn } from "@trainingai/shared/utils";
import { todayInTz, todayMidnightUtc, toAestDay, startOfWeekInTz, todayDayOfWeek, shiftDateStr, dayKeyInTz } from "@trainingai/shared/date-utils";
import { formatInTimeZone } from "date-fns-tz";
import { cachedFetch, readCacheSync, setCached, cachedFetchToday, readTodayCacheSync, isBodyMetadataFresh } from "@/lib/sqlite/cache";
import { useCachedValue } from "@/lib/hooks/use-cached-value";
import { useInvalidationRefetch } from "@/lib/hooks/use-invalidation-refetch";
import { invalidateWorkoutSummaries, invalidateReadinessInputs, invalidateOuraSync, invalidateWorkoutMetaRefresh, invalidatePrescriptionChanged } from "@/lib/cache-groups";
import { mergeCalendarOverlay, readLocalCalendarOverlay } from "@/lib/calendar/local-overlay";
import { syncOuraRing } from "@/lib/oura-ble/sync";
import { getLocalStore } from "@/lib/local-store";
import { pushMutations, pullDelta, isSyncBackedOff } from "@/lib/local-store/sync-engine";
import { PullToSync } from "@/components/pull-to-sync";
import { BODY_BATTERY_TTL, TTL_MEDIUM, TTL_LONG, READINESS_SCORE_TTL, MUSCLE_RECOVERY_TTL, NEXT_SESSION_TTL, MOOD_TTL } from '@trainingai/shared/cache-ttl';
import { GoalRecommendationSheet, type GoalRecommendationData } from '@/components/profile/goal-recommendation-sheet'
import type { User } from '@trainingai/shared/types'
import { EarlyDeloadCard } from "@/components/home/early-deload-card";
import { GoalsCheckinCard } from "@/components/home/goals-checkin-card";
import { WeeklyRecapBanner } from "@/components/weekly-recap-banner";
import { DismissibleBanner } from "@/components/ui/dismissible-banner";
import { HomeCardWidget } from "@/components/home/home-card-widget";
import type { CardSectionKey } from "@/components/home/home-card-widget";
import { OuraScoreChipRow } from "@/components/oura-score-chip-row";
import { IllnessAdvisoryBanner } from "@/components/home/illness-advisory-banner";
import { BodyBatteryCard } from "@/components/body-battery-card";
import { HomeDayTimeline } from "@/components/home-day-timeline";
const ExerciseDetectedCard = dynamic(
  () => import("@/components/activity/exercise-detected-card").then(m => ({ default: m.ExerciseDetectedCard })),
  { ssr: false },
);
const ExerciseReviewSheet = dynamic(
  () => import("@/components/activity/exercise-review-sheet").then(m => ({ default: m.ExerciseReviewSheet })),
  { ssr: false },
);
import { RecommendationCard } from "./components/recommendation-card";
import { RestDayCard } from "@/components/rest-day-card";
import { ReadinessCheckinCard } from "@/components/checkin/readiness-checkin-card";
import { StreakCard } from "./components/streak-card";
import { DeloadBanner } from "./components/deload-banner";
import { WeekStripCard } from "./components/week-strip-card";
import { MetricTilesCard } from "./components/metric-tiles-card";
import type { TrainingLoadResponse } from "@/app/api/training-load/route";
import type { MuscleRecoveryEntry } from "@/app/api/muscle-recovery/route";
import {
  type MetaKey, type CardWidgetKey, type WidgetDef, type SectionKey,
  WIDGET_DEFS, DEFAULT_WIDGETS, DEFAULT_CARD_WIDGETS,
  loadPillColors, loadCardColors, CARD_COLORS_KEY,
  loadWidgets, loadCardWidgets, loadCalorieType, loadWeightLookback,
  loadStepsGoal, loadStepsGoalType, loadSleepGoal, loadWaterGoal, loadWaterGoalType,
  loadHiddenSections, buildDefaultOrder, loadSectionOrder,
  SECTION_ORDER_KEY, HIDDEN_SECTIONS_KEY,
} from "@/lib/home/home-prefs";
import { markRestDayChosen, withRestDayOverride } from "@/lib/home/rest-day";
import { fetchWithRetry } from "@trainingai/shared/fetch-with-retry";
import type { HrSleepWindow } from "@trainingai/shared/health/hr-sleep-band";

interface SleepRow {
  date: string
  durationHours: number | null
  deepSleepHours: number | null
  remSleepHours: number | null
  lightSleepHours: number | null
  awakHours: number | null
}


function getGreeting(name: string, tz: string): string {
  const h = parseInt(formatInTimeZone(new Date(), tz, "H"), 10);
  const period = h < 12 ? "morning" : h < 17 ? "afternoon" : h < 21 ? "evening" : "night";
  return `Good ${period}, ${name}.`;
}


// First-open-of-day morning check-in prompt. Marker is date-stamped so it fires
// once per day; set on save OR dismiss so a "not now" doesn't re-nag all day.
const MORNING_CHECKIN_KEY = 'ta_morning_checkin';

function isMorningCheckinPromptDone(): boolean {
  if (typeof window === 'undefined') return true;
  try { return localStorage.getItem(MORNING_CHECKIN_KEY) === todayInTz(); } catch { return true; }
}
function markMorningCheckinPromptDone(): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(MORNING_CHECKIN_KEY, todayInTz()); } catch { /* ignore */ }
}

export default function SessionSelectContent({ userId, isAdmin }: { userId?: string; isAdmin?: boolean }) {
  const router = useTransitionRouter();
  const { epoch: tabEpoch } = useTabVisibility();

  const [metaToday, setMetaToday]           = useState<BodyMetaRow | null>(null);
  const [metaRecent, setMetaRecent]         = useState<BodyMetaRow[]>([]);
  const [metaLoading, setMetaLoading]       = useState(true);
  const [activeWidgets, setActiveWidgets]   = useState<MetaKey[]>(DEFAULT_WIDGETS);
  const [pillColors, setPillColors]         = useState<Record<string, string>>({});
  const [cardColors, setCardColors]         = useState<Record<string, string>>({});
  const [activeCardWidgets, setActiveCardWidgets] = useState<CardWidgetKey[]>(DEFAULT_CARD_WIDGETS);
  // Bumped by handlePullSync to re-trigger the gated mount effects below (readiness-score,
  // body-battery, training-load, muscle-recovery, oura-hr-day) instead of refetchAll
  // duplicating their fetch logic inline — one fetch call site per key, not two.
  const [refreshTick, setRefreshTick] = useState(0);
  const [calorieType, setCalorieType]       = useState<"daily" | "weekly">("daily");
  const [weightLookback, setWeightLookback] = useState<7 | 30>(7);
  const [logWidget, setLogWidget]           = useState<WidgetDef | null>(null);
  const [recommendation, setRecommendation] = useState<NextSessionRecommendation | null>(null);
  const [calendarDays, setCalendarDays] = useState<Record<string, string[]>>({});
  // Held apart from `calendarDays` rather than merged into it: every writer of `calendarDays`
  // lets the newest server payload win a day key, which is what makes a deleted workout
  // disappear. Pending rows can't be in that payload by definition, so they merge at read time
  // and survive every refetch without weakening deletion propagation.
  const [pendingDays, setPendingDays] = useState<Record<string, string[]>>({});
  const [refreshing, setRefreshing] = useState(false);
  // Bumped after the `workout-data:all` batch seeds each `workout-card:<id>` cache entry — those
  // seeds are a side effect (setCached) outside React state, so RecommendationCard (memo'd) would
  // otherwise never re-render to pick up a "Last: —" card whose first paint landed before the
  // batch resolved (Q-106, same bug family as Q-89/Q-91).
  const [workoutCardEpoch, setWorkoutCardEpoch] = useState(0);
  const [activeSessions, setActiveSessions] = useState<ProgramSession[]>([]);
  const tz = useUserTimezone();
  // Bound once so the identity is stable for the children that take it as a prop.
  const dayKey = useCallback((daysAgo = 0) => dayKeyInTz(tz, daysAgo), [tz]);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [userAvatar, setUserAvatar] = useState<string | null>(null);
  const [sleepData, setSleepData] = useState<SleepRow[]>([]);
  const [stepsGoal, setStepsGoal] = useState(10000);
  const [stepsGoalType, setStepsGoalType] = useState<"daily" | "weekly">("daily");
  const [sleepGoal, setSleepGoal] = useState(8);
  const [waterGoal, setWaterGoal] = useState<number | null>(null);
  const [waterGoalType, setWaterGoalType] = useState<"daily" | "weekly">("daily");
  const [weekToDate, setWeekToDate] = useState<{ steps: number; calories: number; waterMl: number } | null>(null);
  const [waterLogOpen, setWaterLogOpen] = useState(false);
  const [moodLog, setMoodLog] = useState<import("@trainingai/shared/types/mood").MoodLog | null | undefined>(undefined);
  const [moodSheetOpen, setMoodSheetOpen] = useState(false);
  const [morningCheckinOpen, setMorningCheckinOpen] = useState(false);
  const [weekOverlayDate, setWeekOverlayDate] = useState<string | null>(null);
  const [historyEx, setHistoryEx] = useState<string | null>(null);
  const [reviewingSessionId, setReviewingSessionId] = useState<string | null>(null);
  const [sectionEditMode, setSectionEditMode] = useState(false);
  const [sectionOrder, setSectionOrder] = useState<SectionKey[]>(() => buildDefaultOrder([]));
  // Ref always mirrors sectionOrder so drag/sync handlers can read it synchronously
  // without being closured on a stale value and without delaying the save to a useEffect.
  const sectionOrderRef = useRef<SectionKey[]>(buildDefaultOrder([]));
  const [hiddenSections, setHiddenSections] = useState<Set<SectionKey>>(() => new Set());
  const [readiness, setReadiness] = useState<import('@/app/api/readiness-score/route').ReadinessScoreResponse | null>(null)
  const [bodyBattery, setBodyBattery] = useState<import('@/app/api/body-battery/route').BodyBatteryResponse | null>(null)
  const [weeklyTarget, setWeeklyTarget] = useState(5)
  const [isAiDynamic, setIsAiDynamic] = useState(false)
  const [phaseStatus, setPhaseStatus] = useState<import('@/app/api/workout-data/route').PhaseStatus | null>(null)
  const [perSessionPhaseStatus, setPerSessionPhaseStatus] = useState<import('@/app/api/workout-data/route').PerSessionPhaseStatus[]>([])
  const [earlyDeloadDismissed, setEarlyDeloadDismissed] = useState(false)
  const [adminBadge, setAdminBadge] = useState(0)
  const [apkBannerDismissed, setApkBannerDismissed] = useState(true);
  const [goalsProfile, setGoalsProfile] = useState<{ activityLevel: string | null; fitnessGoal: string | null; lastGoalReviewAt: string | null } | null>(null);
  const [trainingLoad, setTrainingLoad] = useState<TrainingLoadResponse | null>(null);
  const [muscleRecovery, setMuscleRecovery] = useState<MuscleRecoveryEntry[] | null>(null);
  const [ouraHrReadings, setOuraHrReadings] = useState<{ timestamp: string; bpm: number; source: string | null }[]>([]);
  const [ouraWorkoutSessions, setOuraWorkoutSessions] = useState<{ sessionName: string; startedAt: string; completedAt: string | null }[]>([]);
  const [ouraSleepWindow, setOuraSleepWindow] = useState<HrSleepWindow | null>(null);
  const [goalsCheckinDismissed, setGoalsCheckinDismissed] = useState(false);
  const [goalsRecommendation, setGoalsRecommendation] = useState<GoalRecommendationData | null>(null);
  const [goalsSheetOpen, setGoalsSheetOpen] = useState(false);
  const [dayReviewOpen, setDayReviewOpen] = useState(false);
  const [dayReviewDismissed, setDayReviewDismissed] = useState(true);

  // useLayoutEffect fires before paint — prevents layout shift on hard load
  useLayoutEffect(() => {
    setActiveWidgets(loadWidgets());
    setPillColors(loadPillColors());
    setCardColors(loadCardColors());
    const cards = loadCardWidgets();
    setActiveCardWidgets(cards);
    setSectionOrder(loadSectionOrder(cards));
    setHiddenSections(loadHiddenSections());
    setCalorieType(loadCalorieType());
    setWeightLookback(loadWeightLookback());
    setStepsGoal(loadStepsGoal());
    setStepsGoalType(loadStepsGoalType());
    setSleepGoal(loadSleepGoal());
    setWaterGoal(loadWaterGoal());
    setWaterGoalType(loadWaterGoalType());

    // Seed recommendation + moodLog from cache before paint — moved out of useState lazy
    // initializers (PERF-7), which read sessionStorage/cache on the server too and risk a
    // hydration mismatch.
    try {
      const recRaw = sessionStorage.getItem('ta_recommendation_v1')
      let seededRec: NextSessionRecommendation | null = null
      if (recRaw) {
        // Date-stamped seed (CCH-4) — an un-stamped value is a pre-migration write
        // (or a stale prior-day one) and is ignored rather than trusted, so a
        // resident app can't flash yesterday's rest-day/deload banner across midnight.
        const stamped = JSON.parse(recRaw) as { date: string; data: NextSessionRecommendation }
        if (stamped?.date === todayInTz() && stamped.data) seededRec = withRestDayOverride(stamped.data)
      }
      if (!seededRec) seededRec = withRestDayOverride(readTodayCacheSync<NextSessionRecommendation>('next-session'))
      setRecommendation(seededRec)
    } catch { /* leave recommendation null */ }
    setMoodLog(readCacheSync<import("@trainingai/shared/types/mood").MoodLog | null>(`mood:${todayInTz()}`) ?? undefined)

    // Re-read localStorage when app returns to foreground (PWA background/foreground cycle
    // doesn't remount the component, so useLayoutEffect above only runs once on first mount)
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        setActiveWidgets(loadWidgets());
        setPillColors(loadPillColors());
        setCardColors(loadCardColors());
        const refreshedCards = loadCardWidgets();
        setActiveCardWidgets(refreshedCards);
        setSectionOrder(loadSectionOrder(refreshedCards));
        setHiddenSections(loadHiddenSections());
            setCalorieType(loadCalorieType());
        setWeightLookback(loadWeightLookback());
        setStepsGoal(loadStepsGoal());
        setSleepGoal(loadSleepGoal());
        setWaterGoal(loadWaterGoal());
        setWaterGoalType(loadWaterGoalType());
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    const meta = readCacheSync<{ today: BodyMetaRow | null; recent: BodyMetaRow[]; weekToDate?: { steps: number; calories: number; waterMl: number } | null }>('body-metadata');
    if (meta) {
      // Server-tz "today" (DATE-A7) — meta.today.date is stamped in AEST by the server.
      if (!meta.today || meta.today.date === todayInTz()) {
        setMetaToday(meta.today ?? null);
        setMetaRecent(meta.recent ?? []);
        setWeekToDate(meta.weekToDate ?? null);
        setMetaLoading(false);
      }
      // date mismatch — skip stale cache, let fetchMeta() hydrate from API
    }
    const sleep = readCacheSync<SleepRow[]>('sleep-sessions');
    if (sleep) setSleepData(Array.isArray(sleep) ? sleep : []);

    // Seed the HR chart from the same cache keys the Health → Body Oura section
    // uses, so the home widget paints instantly instead of re-fetching every visit.
    const hrToday = todayInTz();
    const cachedHr = readCacheSync<{ readings: { timestamp: string; bpm: number; source: string | null }[]; sleep: HrSleepWindow | null }>(`oura-hr-day:${hrToday}`);
    if (cachedHr?.readings?.length) setOuraHrReadings(cachedHr.readings);
    if (cachedHr) setOuraSleepWindow(cachedHr.sleep ?? null);
    const cachedWs = readCacheSync<{ sessions: { sessionName: string; startedAt: string; completedAt: string | null }[] }>(`workout-sessions-day:${hrToday}`);
    if (cachedWs?.sessions?.length) setOuraWorkoutSessions(cachedWs.sessions);

    // Seed calendar and recommendation from cache so these sections render immediately.
    try {
      const now = new Date();
      const merged: Record<string, string[]> = {};
      // TTL-backed reads (survive across sessions)
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const cachedCal = readCacheSync<{ trainedDays: Record<string, string[]> }>(`calendar-data:${now.getFullYear()}-${mm}`);
      if (cachedCal?.trainedDays) Object.assign(merged, cachedCal.trainedDays);
      // Also seed previous month so streaks spanning the month boundary are correct on first paint.
      const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevMM = String(prevMonthDate.getMonth() + 1).padStart(2, '0');
      const cachedPrevCal = readCacheSync<{ trainedDays: Record<string, string[]> }>(`calendar-data:${prevMonthDate.getFullYear()}-${prevMM}`);
      if (cachedPrevCal?.trainedDays) Object.assign(merged, cachedPrevCal.trainedDays);
      const cachedStreak = readCacheSync<{ trainedDays: Record<string, string[]> }>('streak-data');
      if (cachedStreak?.trainedDays) Object.assign(merged, cachedStreak.trainedDays);
      if (Object.keys(merged).length > 0) setCalendarDays(merged);
    } catch { /* ignore */ }

    try {
      const recRaw = sessionStorage.getItem("ta_recommendation_v1");
      const stamped = recRaw ? (JSON.parse(recRaw) as { date: string; data: NextSessionRecommendation }) : null;
      if (stamped?.date === todayInTz() && stamped.data) {
        setRecommendation(withRestDayOverride(stamped.data));
      } else {
        const cached = readTodayCacheSync<NextSessionRecommendation>('next-session');
        if (cached) setRecommendation(withRestDayOverride(cached));
      }
    } catch { /* ignore */ }

    try {
      const metaStored = sessionStorage.getItem("ta_meta_v1");
      if (metaStored) {
        const d = JSON.parse(metaStored);
        if (d?.program?.sessions?.length) setActiveSessions(d.program.sessions);
        if (d?.phaseStatus) setPhaseStatus(d.phaseStatus);
        if (d?.perSessionPhaseStatus) setPerSessionPhaseStatus(d.perSessionPhaseStatus);
      } else {
        const cachedMeta = readCacheSync<{ program?: { sessions?: ProgramSession[]; phaseMode?: string }; phaseStatus?: import('@/app/api/workout-data/route').PhaseStatus | null; perSessionPhaseStatus?: import('@/app/api/workout-data/route').PerSessionPhaseStatus[] }>('workout-data:meta');
        if (cachedMeta?.program?.sessions?.length) setActiveSessions(cachedMeta.program.sessions);
        if (cachedMeta?.phaseStatus) setPhaseStatus(cachedMeta.phaseStatus);
        if (cachedMeta?.perSessionPhaseStatus) setPerSessionPhaseStatus(cachedMeta.perSessionPhaseStatus);
      }
    } catch { /* ignore */ }

    try {
      const cachedReadiness = readTodayCacheSync<import('@/app/api/readiness-score/route').ReadinessScoreResponse>('readiness-score');
      // Set unconditionally — the chip row hides each chip whose own value is null, so we no
      // longer gate the whole row on the all-or-nothing hasSufficientData flag (per-chip gating).
      if (cachedReadiness) setReadiness(cachedReadiness);
    } catch { /* ignore */ }

    try {
      const cachedBattery = readTodayCacheSync<import('@/app/api/body-battery/route').BodyBatteryResponse>('body-battery');
      if (cachedBattery) setBodyBattery(cachedBattery);
    } catch { /* ignore */ }

    // Seed mood from cache so the recommendation card shows immediately instead
    // of "Loading…". null means "no mood logged today" (or cache miss) — both
    // correctly show the check-in card, which is replaced by actual data once
    // the useEffect fetch resolves.
    try {
      const moodKey = `mood:${todayInTz()}`;
      const cachedMood = readCacheSync<import("@trainingai/shared/types/mood").MoodLog | null>(moodKey);
      setMoodLog(cachedMood);
    } catch { /* ignore */ }

    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    const weekKey = `ta_early_deload_dismissed_${formatInTimeZone(new Date(), tz, 'yyyy-MM')}`
    setEarlyDeloadDismissed(!!localStorage.getItem(weekKey));

    setApkBannerDismissed(!!localStorage.getItem('apk-banner-dismissed'));

    // "Day in review" is an END-of-day summary (mirrors the "Bedtime approaching" reminder,
    // lib/day-review-reminders.ts) — most of the day hasn't happened yet before evening, so the
    // digest is thin-to-empty and the "ready" banner reads as premature/wrong that early. Gate on
    // local hour in addition to the per-day dismiss flag so it stops resurfacing every morning.
    const currentHour = parseInt(formatInTimeZone(new Date(), tz, 'H'), 10)
    setDayReviewDismissed(
      currentHour < 17 || localStorage.getItem(`ta_day_review_dismissed_${todayInTz()}`) === '1'
    );

    // Local-first trained-days fill (APK-only — no local store in the web sandbox):
    // pullDelta already populates workout_sessions/exercise_logs, this is purely the
    // read side, run after the synchronous cache seeds above so first paint is
    // unchanged. Verify-first: getCalendarData/getRecentTrainedDays key a "trained"
    // day on having at least one logged exercise, NOT on completedAt — a session
    // started but not marked complete still counts if it has a set logged. Match
    // that via getWorkoutHistory (session + its exerciseLogs) rather than filtering
    // on completedAt.
    if (userId) {
      const store = getLocalStore(userId);
      if (store) {
        (async () => {
          try {
            const cutoff = toAestDay(new Date(todayMidnightUtc().getTime() - 90 * 24 * 60 * 60 * 1000));
            const history = await store.getWorkoutHistory(cutoff);
            const local: Record<string, string[]> = {};
            for (const { session, exerciseLogs } of history) {
              if (session.deletedAt || exerciseLogs.length === 0) continue;
              const key = formatInTimeZone(new Date(session.startedAt), tz, 'yyyy/MM/dd');
              const names = (local[key] ??= []);
              if (!names.includes(session.sessionName)) names.push(session.sessionName);
            }
            // prev's keys win — the local fill only adds dates the TTL cache doesn't
            // already cover (unsynced-to-cache-but-locally-known sessions).
            if (Object.keys(local).length) setCalendarDays(prev => ({ ...local, ...prev }));
          } catch { /* store unavailable — network paths elsewhere still hydrate */ }
        })();
      }
    }

    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // Workouts still waiting in the outbox, for the week strip and the streak. The fill above
  // already reads 90 days of local history, but it yields to whatever key the cache or the
  // server payload holds — so a second workout on a day the server already knows about is
  // invisible until it syncs. Two months is the window: a pending row older than that means
  // sync has been down for a month, which is a different problem.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const now = new Date();
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const [thisMonth, lastMonth] = await Promise.all([
        readLocalCalendarOverlay(userId, now.getFullYear(), now.getMonth() + 1),
        readLocalCalendarOverlay(userId, prev.getFullYear(), prev.getMonth() + 1),
      ]);
      if (cancelled) return;
      setPendingDays(mergeCalendarOverlay(thisMonth, lastMonth).trainedDays);
    })();
    return () => { cancelled = true; };
  }, [userId, refreshTick]);

  // Keep the ref in sync with state so event handlers always read the latest order synchronously.
  useLayoutEffect(() => { sectionOrderRef.current = sectionOrder; });

  // Stable across renders (functional setCardColors update, no cardColors dep) so the
  // memoized home cards' onColorChange props don't defeat their own memo every render.
  const updateCardColor = useCallback((key: string, hex: string) => {
    setCardColors(prev => {
      const next = { ...prev, [key]: hex };
      localStorage.setItem(CARD_COLORS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);
  const handleRecommendedColorChange = useCallback((hex: string) => updateCardColor('recommendedToday', hex), [updateCardColor]);
  const handleStreakLeftColorChange = useCallback((hex: string) => updateCardColor('streakLeft', hex), [updateCardColor]);
  const handleStreakRightColorChange = useCallback((hex: string) => updateCardColor('streakRight', hex), [updateCardColor]);
  const handleOpenMoodSheet = useCallback(() => setMoodSheetOpen(true), []);

  // Muscles today's session actually trains — lets the check-in mark which sore muscles will
  // deload an exercise, and show the warning. Without it that whole branch is unreachable.
  const moodSheetSessionMuscles = useMemo(
    () => [...new Set((recommendation?.session?.exercises ?? []).flatMap(ex => ex.muscleGroups))],
    [recommendation?.session],
  );
  // Q-115-followup: per-exercise main/secondary muscle assignments (not just the flat name list
  // above) so the sore-muscle picker can predict computePerExerciseDeload's whole-session
  // escalation instead of always promising a narrow "those exercises will be lightened" outcome.
  const moodSheetSessionExercises = useMemo(
    () => (recommendation?.session?.exercises ?? []).map(ex => ({
      sessionExerciseId: ex.id,
      name: ex.exerciseName,
      muscleAssignments: recommendation?.muscleAssignmentsByExercise?.[ex.exerciseName] ?? [],
    })),
    [recommendation?.session, recommendation?.muscleAssignmentsByExercise],
  );
  // Warm the recommended session's workout route. Starting it is the screen's primary
  // action, and a button push gets none of the prefetching <Link> does on viewport entry —
  // so without this the RSC fetch only starts on tap, with the transition already frozen
  // waiting on it (#919). Deliberately the recommended session ONLY: warming every session
  // in the tab list would be N payload fetches to serve one tap.
  const recommendedSessionId = recommendation?.isRestDay ? undefined : recommendation?.session?.id;
  useEffect(() => {
    if (!recommendedSessionId) return;
    router.prefetch(`/workout?session=${encodeURIComponent(recommendedSessionId)}`);
  }, [router, recommendedSessionId]);

  const handleNavigateStats = useCallback(() => router.push("/stats"), [router]);
  const handleNavigateHealthBody = useCallback(() => navigateToTab(router, "/health?tab=body"), [router]);
  const handleOpenWaterLog = useCallback(() => setWaterLogOpen(true), []);
  const hrData = useMemo(
    () => (ouraHrReadings.length > 0 ? { readings: ouraHrReadings, workoutSessions: ouraWorkoutSessions, sleep: ouraSleepWindow } : null),
    [ouraHrReadings, ouraWorkoutSessions, ouraSleepWindow],
  );

  const fetchMeta = useCallback(async () => {
    // Fast-path: seed from the local store before the network fetch lands, so an
    // offline quick-log (SYNC-R1) is never blank on Home while waiting for sync.
    if (userId) {
      const store = getLocalStore(userId);
      if (store) {
        const cutoffStr = toAestDay(new Date(todayMidnightUtc().getTime() - 30 * 24 * 60 * 60 * 1000));
        const local = await store.getBodyMetrics(cutoffStr);
        const rows = local.filter(m => !m.deletedAt);
        if (rows.length > 0) {
          const toRow = (m: typeof rows[number]): BodyMetaRow => ({
            date: m.date, weightKg: m.weightKg, bodyFat: m.bodyFatPct,
            calories: m.calories, protein: m.proteinG, carb: m.carbsG, fat: m.fatG,
            steps: m.steps, distanceKm: m.distanceKm,
            restingHeartRate: m.restingHeartRate, hrvMs: m.hrvMs, spo2Pct: m.spo2Pct,
            waterMl: m.waterMl, waistCm: m.waistCm, chestCm: m.chestCm, armCm: m.armCm,
            thighCm: m.thighCm, hipCm: m.hipCm, neckCm: m.neckCm,
            skeletalMusclePct: m.skeletalMusclePct, fatFreeMassKg: m.fatFreeMassKg,
            subcutaneousFatPct: m.subcutaneousFatPct, visceralFatIndex: m.visceralFatIndex,
            bodyWaterPct: m.bodyWaterPct, muscleMassKg: m.muscleMassKg, boneMassKg: m.boneMassKg,
            proteinPct: m.proteinPct, bmrKcal: m.bmrKcal, metabolicAge: m.metabolicAge,
          });
          setMetaRecent(rows.map(toRow));
          const todayStr = todayInTz();
          const todayRow = rows.find(m => m.date === todayStr);
          if (todayRow) setMetaToday(toRow(todayRow));
          setMetaLoading(false);

          // weekToDate fast-path — matches the server's steps/waterMl computation
          // exactly (body_metrics + activity_logs steps, same weekStartForFetch
          // anchor). calories is body_metrics-only here: the server additionally
          // prefers food_logs' per-day total over body_metrics on days that have
          // one (to avoid double-counting), which needs a food-item join this fast
          // path doesn't do — so a food-logged day is undercounted here until the
          // network response (fired right after this block) replaces it. Real
          // summed data, just possibly incomplete for a moment — not fabricated.
          const weekStart = startOfWeekInTz();
          const wk = rows.filter(m => m.date >= weekStart);
          const weekActivityLogs = (await store.getActivityLogs(weekStart))
            .filter(a => !a.deletedAt && a.date >= weekStart);
          setWeekToDate({
            steps: wk.reduce((s, m) => s + (m.steps ?? 0), 0)
              + weekActivityLogs.reduce((s, a) => s + (a.steps ?? 0), 0),
            calories: wk.reduce((s, m) => s + (m.calories ?? 0), 0),
            waterMl: wk.reduce((s, m) => s + (m.waterMl ?? 0), 0),
          });
        }
      }
    }
    await cachedFetch<{ today: BodyMetaRow | null; recent: BodyMetaRow[]; weekToDate?: { steps: number; calories: number; waterMl: number } | null; activeEnergyKcalToday?: number | null }>(
      'body-metadata', '/api/body-metadata', TTL_MEDIUM,
      (data) => {
        if (!isBodyMetadataFresh(data, tz)) return;
        setMetaToday(data.today ?? null);
        setMetaRecent(data.recent ?? []);
        setWeekToDate(data.weekToDate ?? null);
        setMetaLoading(false);
      },
    );
    setMetaLoading(false);
  }, [userId, tz]);

  useEffect(() => { fetchMeta(); }, [fetchMeta]);

  const fetchWorkoutData = useCallback(async () => {
    setRefreshing(true);
    try {
      // Fire next-session and streak in parallel with the meta fetch —
      // none of them depend on the sessions list, so there's no reason to sequence them.
      await Promise.all([
        cachedFetch<{ program?: { sessions?: ProgramSession[]; schedule?: { type?: string; restAfterN?: number; days?: unknown[] }; phaseMode?: string }; phaseStatus?: import('@/app/api/workout-data/route').PhaseStatus | null; perSessionPhaseStatus?: import('@/app/api/workout-data/route').PerSessionPhaseStatus[] }>(
          'workout-data:meta', '/api/workout-data?tab=meta', TTL_LONG,
          (metaData) => {
            if (metaData?.program?.sessions?.length) {
              setActiveSessions(metaData.program.sessions);
              sessionStorage.setItem("ta_meta_v1", JSON.stringify(metaData));
            }
            setPhaseStatus(metaData?.phaseStatus ?? null);
            setPerSessionPhaseStatus(metaData?.perSessionPhaseStatus ?? []);
            const aiDynamic = metaData?.program?.phaseMode === 'ai_dynamic';
            setIsAiDynamic(aiDynamic);
            if (!aiDynamic && metaData?.program?.schedule) {
              setWeeklyTarget(getScheduledSessionsPerWeek(metaData.program as unknown as Program));
            }
          },
        ),
        // streak-data (90 days) is a strict superset of what home needs — the calendar
        // screen's own calendar-data:<month> fetch is what serves /calendar; home no
        // longer fetches it redundantly (activityDays is never read here).
        cachedFetch<{ trainedDays: Record<string, string[]> }>(
          'streak-data',
          '/api/streak-data',
          TTL_LONG,
          (d) => { if (d?.trainedDays) setCalendarDays(prev => ({ ...prev, ...d.trainedDays })); },
        ).catch(() => {}),
        cachedFetchToday<NextSessionRecommendation>(
          'next-session', '/api/next-session', NEXT_SESSION_TTL,
          (rec) => {
            const adjusted = withRestDayOverride(rec) ?? rec;
            setRecommendation(adjusted);
            try { sessionStorage.setItem("ta_recommendation_v1", JSON.stringify({ date: todayInTz(), data: adjusted })); } catch { /* ignore */ }
          },
        ),
      ]);

      // One batch request seeds every session's `workout-card:<id>` — collapses the old
      // N+1 per-session prefetch fan-out. The batch (?tab=all) is strictly read-only server-side
      // (fires no /prescribe, does no DB writes); the seed shape matches the single-tab response
      // exactly so opening a tab paints from it. Sequenced after the Promise.all deliberately
      // (Q-135): it uses none of those results, so the await trades an RTT to keep this large,
      // not-yet-shown payload out of first paint's way. freshWithinTtl invalidation proof: both
      // `workout-data:all` and each `workout-card:<id>` are invalidated by invalidateWorkoutSummaries
      // (workout completion), invalidateExerciseLogged (mid-session log), invalidateProgramStructure
      // (config edits), and — both added by Q-117 — invalidatePrescriptionChanged and
      // invalidateInjuryWrites. Every write that changes this payload goes through one of those.
      await cachedFetch<{ perSession?: Record<string, unknown> }>(
        'workout-data:all', '/api/workout-data?tab=all', TTL_LONG,
        (data) => {
          const perSession = data?.perSession ?? {};
          for (const [id, card] of Object.entries(perSession)) {
            setCached(`workout-card:${id}`, card, TTL_LONG).catch(() => {});
          }
          setWorkoutCardEpoch(n => n + 1);
        },
        { freshWithinTtl: true },
      ).catch(() => {});
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchWorkoutData(); }, [fetchWorkoutData]);

  // Reads today's mood without letting a null server response clobber an
  // optimistically-saved mood. A local-first save writes the mood to the local
  // store + the `mood:<date>` cache and pushes to the server async; if the GET
  // races ahead of that push it returns null. We must NOT cache that null (it
  // would re-show the check-in card on the next visit), so only apply/cache a
  // non-null response, and otherwise keep whatever is already cached.
  const loadTodayMood = useCallback(async () => {
    const today = todayInTz();
    const key = `mood:${today}`;
    // Local-first: the on-device store is the source of truth, so a check-in
    // saved offline (or not yet synced) shows here instead of the server's null.
    const store = userId ? getLocalStore(userId) : null;
    if (store) {
      try {
        const local = (await store.getMoodLogs(today)).find(r => r.logDate === today);
        if (local) {
          const mapped: import('@trainingai/shared/types/mood').MoodLog = {
            id: '', userId: userId!, logDate: local.logDate,
            energyLevel:  local.energyLevel  as import('@trainingai/shared/types/mood').EnergyLevel,
            sleepQuality: local.sleepQuality as import('@trainingai/shared/types/mood').SleepQuality,
            bodyState:    local.bodyState    as import('@trainingai/shared/types/mood').BodyState[],
            soreMuscles:  local.soreMuscles,
            createdAt: new Date(),
          };
          setMoodLog(mapped);
          setCached(key, mapped, MOOD_TTL).catch(() => {});
          return;
        }
      } catch { /* store not ready — fall through to the API */ }
    }
    try {
      const res = await fetch(`/api/mood?date=${today}`);
      if (!res.ok) return;
      const d = await res.json() as import('@trainingai/shared/types/mood').MoodLog | null;
      if (d !== null) {
        setMoodLog(d);
        setCached(key, d, MOOD_TTL).catch(() => {});
      } else {
        const cached = readCacheSync<import('@trainingai/shared/types/mood').MoodLog | null>(key);
        if (cached == null) setMoodLog(prev => (prev == null ? null : prev));
      }
    } catch { /* offline — keep the seeded value */ }
  }, [userId]);

  // Re-fetches all data shown on this screen, updating React state from fresh network responses.
  // Called after pull-to-sync to guarantee the UI is current. readiness-score, training-load,
  // body-battery, muscle-recovery, and oura-hr-day/workout-sessions-day are NOT re-fetched here
  // inline — bumping refreshTick re-triggers the gated mount effects below instead, so each of
  // those keys has exactly one fetch call site rather than two that could drift apart.
  const refetchAll = useCallback(async () => {
    await Promise.allSettled([
      fetchMeta(),
      fetchWorkoutData(),
      cachedFetch<SleepRow[]>('sleep-sessions', '/api/sleep-sessions', TTL_MEDIUM,
        d => setSleepData(Array.isArray(d) ? d : [])),
      loadTodayMood(),
    ]);
    setRefreshTick(t => t + 1);
  }, [fetchMeta, fetchWorkoutData, loadTodayMood]);

  // A check-in changes what this screen prescribes — the whole-session deload trigger is driven
  // entirely by the sore muscles it reports. Storing the log in local state was all this did, so a
  // check-in saved with nothing sore left the "most of this session's muscles are still sore"
  // banner on screen, computed from *yesterday's* log (Q-158, confirmed against production).
  // The sheet invalidates the prescription caches and awaits that before calling this, so the
  // refetch below reads the network rather than the cache it just wrote past.
  const handleMoodSaved = useCallback((log: import("@trainingai/shared/types/mood").MoodLog) => {
    setMoodLog(log);
    fetchWorkoutData();
    // readiness-score and the other gated keys have exactly one fetch site each, in the
    // refreshTick-gated effects — same reason refetchAll bumps it instead of fetching inline.
    setRefreshTick(t => t + 1);
  }, [fetchWorkoutData]);

  const handlePullSync = useCallback(async () => {
    // The ring itself is drained by PullToSync (syncOuraRing()) in parallel with this
    // callback — the Oura Cloud has been frozen since the 2026-07-07 re-key, so the old
    // POST /api/oura/sync here was pure waste (CLAUDE.md, Oura Direct-BLE section).
    // K7: capture the outcomes — push/pull return null on network-gone / 5xx backoff /
    // backoff-window (a force pull can still no-op silently). An explicit refresh that
    // silently fails re-paints the same stale data and invalidates the user's "pull to
    // fix it" mental model, so surface a failure toast (online + a real local store only:
    // web has no store and offline is expected to queue).
    // Sampled BEFORE the calls on purpose: a genuine failure sets the backoff window itself, so
    // reading it afterwards would report every real failure as "backing off after an earlier
    // error" and make the failure branch unreachable. What we want to know is whether this pull
    // even attempted anything.
    const wasBackedOff = isSyncBackedOff();
    let pushRes: Awaited<ReturnType<typeof pushMutations>> | undefined;
    let pullRes: Awaited<ReturnType<typeof pullDelta>> | undefined;
    if (userId) pushRes = await pushMutations(userId).catch(() => null);
    if (userId) pullRes = await pullDelta(userId, true).catch(() => null);
    const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
    if (online && userId && getLocalStore(userId) && (pushRes === null || pullRes === null)) {
      toast.error(wasBackedOff
        ? 'Sync is backing off after an earlier error — retrying shortly'
        : 'Sync failed — will retry automatically');
    }
    // Targeted invalidations: preserve slow-changing config caches (program structure,
    // styles, exercise-library) while clearing everything that could change from a sync.
    // (invalidateOuraSync() already covers 'sleep-performance-correlation' — no separate call needed.)
    await Promise.all([
      invalidateWorkoutSummaries(),
      invalidateReadinessInputs(),
      invalidateOuraSync(),
    ]).catch(() => {});
    refetchAll().catch(() => {});
  }, [userId, refetchAll]);

  // BLE drain settling (syncOuraRing) dispatches this once new data has actually landed in
  // Postgres — bump refreshTick so the gated mount effects below (readiness, body-battery,
  // training-load, oura-hr-day) refetch instead of showing pre-sync data indefinitely.
  // Q-91: 'sleep-sessions' is read by this screen too (the home HR chart's sleep-window
  // shading) but isn't one of the refreshTick-gated effects — it was invalidated correctly
  // but nothing ever re-fetched it on this signal, same gap as sleep-content.tsx/health-content.tsx.
  useEffect(() => {
    const onBleSynced = () => setRefreshTick(t => t + 1);
    window.addEventListener('ta:oura-ble-synced', onBleSynced);
    return () => window.removeEventListener('ta:oura-ble-synced', onBleSynced);
  }, []);

  // Was on the BLE event; the invalidation is wider (`invalidateBiometrics` clears this key too).
  useInvalidationRefetch('sleep-sessions', () => {
    cachedFetch<SleepRow[]>('sleep-sessions', '/api/sleep-sessions', TTL_MEDIUM, d => setSleepData(Array.isArray(d) ? d : []));
  });

  // Q-359: synced into state, not derived — `goalsProfile` also takes optimistic local writes that
  // must outlive a refetch. Safe because the goals card gates on `goalsCheckinDismissed` first.
  const userProfile = useCachedValue<{ user?: { displayName?: string | null; name?: string | null; avatar?: string | null; activityLevel?: string | null; fitnessGoal?: string | null; lastGoalReviewAt?: string | null } }>(
    'more-user-profile', '/api/user/profile', TTL_MEDIUM,
  );
  useEffect(() => {
    const u = userProfile?.user;
    if (!u) return;
    setDisplayName(u.displayName ?? u.name ?? null);
    if (u.avatar) setUserAvatar(u.avatar);
    setGoalsProfile({ activityLevel: u.activityLevel ?? null, fitnessGoal: u.fitnessGoal ?? null, lastGoalReviewAt: u.lastGoalReviewAt ?? null });
  }, [userProfile]);

  useEffect(() => {
    let cancelled = false;
    // Local-first seed: paints instantly offline (APK-only — the web sandbox has
    // no local store). pullDelta already populates sleep_sessions; this is purely
    // the read side. The network fetch below stays as hydrate/fallback — cross-
    // device data arrives via pullDelta, not this seed alone.
    if (userId) {
      const store = getLocalStore(userId);
      if (store) {
        const cutoff = toAestDay(new Date(todayMidnightUtc().getTime() - 14 * 24 * 60 * 60 * 1000));
        store.getSleepSessions(cutoff).then(local => {
          if (local.length > 0 && !cancelled) {
            setSleepData(local.map(s => ({
              date: s.date,
              durationHours: s.durationHours,
              deepSleepHours: s.deepSleepHours,
              remSleepHours: s.remSleepHours,
              lightSleepHours: s.lightSleepHours,
              awakHours: null, // LocalSleepSession has no awake column — render handles null
            })));
          }
        }).catch(() => { /* store unavailable — network path below still runs */ });
      }
    }
    fetchWithRetry<SleepRow[]>(
      'sleep-sessions', '/api/sleep-sessions', TTL_MEDIUM,
      (data) => setSleepData(Array.isArray(data) ? data : []),
      () => cancelled,
    );
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => { loadTodayMood(); }, [loadTodayMood]);

  // The persistent shell re-shows this tab without remounting it — re-run the
  // mount refresh pass (same cachedFetch-backed reads a remount used to run).
  useEffect(() => {
    if (tabEpoch === 0) return;
    fetchMeta();
    fetchWorkoutData();
    loadTodayMood();
  }, [tabEpoch, fetchMeta, fetchWorkoutData, loadTodayMood]);

  // Prompt the morning check-in on the first app open of the day. Local store is
  // checked first so a check-in saved on another device (or before a reinstall)
  // suppresses the prompt.
  useEffect(() => {
    if (isMorningCheckinPromptDone()) return;
    let cancelled = false;
    (async () => {
      const today = todayInTz();
      const store = userId ? getLocalStore(userId) : null;
      const existing = store
        ? await store.getDayCheckin(today, 'morning').catch(() => null)
        : await fetch(`/api/day-checkin?date=${today}&phase=morning`)
            .then(r => (r.ok ? r.json() : null)).catch(() => null);
      if (cancelled) return;
      if (existing) { markMorningCheckinPromptDone(); return; }
      setMorningCheckinOpen(true);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    cachedFetchToday<import('@/app/api/body-battery/route').BodyBatteryResponse>(
      'body-battery', '/api/body-battery', BODY_BATTERY_TTL,
      d => { if (d) setBodyBattery(d) },
    ).catch(() => {});
  }, [refreshTick]);

  useEffect(() => {
    if (activeCardWidgets.includes("acwrWidget")) {
      cachedFetchToday<TrainingLoadResponse>(
        'training-load', '/api/training-load', TTL_MEDIUM,
        d => { if (d) setTrainingLoad(d) },
      ).catch(() => {});
    }
  }, [activeCardWidgets, refreshTick]);

  useEffect(() => {
    if (activeCardWidgets.includes("muscleStatusWidget")) {
      cachedFetch<{ muscles: MuscleRecoveryEntry[] }>(
        'muscle-recovery', '/api/muscle-recovery', MUSCLE_RECOVERY_TTL,
        d => { if (d?.muscles) setMuscleRecovery(d.muscles) },
      ).catch(() => {});
    }
  }, [activeCardWidgets, refreshTick]);

  useEffect(() => {
    if (!activeCardWidgets.includes("hrChartWidget")) return;
    const today = todayInTz();
    cachedFetch<{ readings: { timestamp: string; bpm: number; source: string | null }[]; sleep: HrSleepWindow | null }>(
      `oura-hr-day:${today}`, `/api/oura/hr-day?date=${today}`, TTL_MEDIUM,
      d => { if (d?.readings?.length) setOuraHrReadings(d.readings); setOuraSleepWindow(d?.sleep ?? null); }).catch(() => {});
    // Local-first seed (SYN-10) before the cachedFetch revalidates — same shape
    // as fetchMeta's body-metric fast-path above.
    if (userId) {
      const store = getLocalStore(userId);
      if (store) {
        store.getWorkoutSessions(today).then(sessions => {
          const rows = sessions
            .filter(s => !s.deletedAt && s.startedAt.slice(0, 10) === today)
            .map(s => ({ sessionName: s.sessionName, startedAt: s.startedAt, completedAt: s.completedAt }));
          if (rows.length > 0) setOuraWorkoutSessions(rows);
        }).catch(() => {});
      }
    }
    cachedFetch<{ sessions: { sessionName: string; startedAt: string; completedAt: string | null }[] }>(
      `workout-sessions-day:${today}`, `/api/workout-sessions/day?date=${today}`, TTL_MEDIUM,
      d => { if (d?.sessions?.length) setOuraWorkoutSessions(d.sessions) }).catch(() => {});
  }, [activeCardWidgets, refreshTick, userId]);

  useEffect(() => {
    let cancelled = false;
    fetchWithRetry<import('@/app/api/readiness-score/route').ReadinessScoreResponse>(
      'readiness-score', '/api/readiness-score', READINESS_SCORE_TTL,
      (d) => { if (d) setReadiness(d) },
      () => cancelled,
      0,
      cachedFetchToday,
    );
    return () => { cancelled = true; };
  }, [refreshTick]);

  useEffect(() => {
    if (!isAdmin) return;
    cachedFetch<{ count: number; feedbackCount: number }>(
      'admin-pending-count', '/api/admin/pending-count', TTL_MEDIUM,
      d => { if (d?.count > 0) setAdminBadge(d.count) },
    ).catch(() => {});
  }, [isAdmin]);

  const showGoalsCheckin = !goalsCheckinDismissed
    && !!goalsProfile?.activityLevel
    && !!goalsProfile?.fitnessGoal
    && (goalsProfile.lastGoalReviewAt == null
      || (Date.now() - new Date(goalsProfile.lastGoalReviewAt).getTime()) > 14 * 24 * 3600 * 1000);

  const handleGoalsReviewNow = useCallback(async () => {
    try {
      const res = await fetch('/api/nutrition-goals/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'scheduled' }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error('Failed to get recommendation'); return; }
      setGoalsRecommendation(data);
      setGoalsSheetOpen(true);
      setGoalsCheckinDismissed(true);
    } catch {
      toast.error('Failed to get recommendation');
    }
  }, []);

  const handleExerciseDetectedReview = useCallback((id: string) => {
    setReviewingSessionId(id);
  }, []);

  const handleEarlyDeloadConfirm = useCallback(() => {
    // Q-117: /api/confirm-early-deload changes what's prescribed (programs.ts → phase-engine.ts →
    // workout-data/route.ts) but this handler only updated local readiness state — the
    // workout-data:all / workout-card:<id> caches (freshWithinTtl, TTL_LONG) never invalidated, so
    // every card kept showing full-intensity target weights for up to 6 hours.
    invalidatePrescriptionChanged().catch(() => {});
    setReadiness(prev => prev ? { ...prev, earlyDeloadRecommended: false } : prev);
  }, []);

  const handleEarlyDeloadDismiss = useCallback(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const weekKey = `ta_early_deload_dismissed_${formatInTimeZone(new Date(), tz, 'yyyy-MM')}`;
    localStorage.setItem(weekKey, '1');
    setEarlyDeloadDismissed(true);
  }, []);

  const handleGoalsRemindLater = useCallback(async () => {
    setGoalsCheckinDismissed(true);
    setGoalsProfile(prev => prev ? { ...prev, lastGoalReviewAt: new Date().toISOString() } : prev);
    await fetch('/api/nutrition-goals/touch-review', { method: 'POST' }).catch(() => {});
  }, []);

  function handleGoalsUserSaved(updated: User) {
    setGoalsProfile(prev => prev ? { ...prev, activityLevel: updated.activityLevel ?? null, fitnessGoal: updated.fitnessGoal ?? null } : prev);
  }

  // The calorie goal is deliberately not tracked here any more (Q-415): Home renders the derived
  // baseline from `/api/nutrition/energy-balance`, and the stored goal is the rest-day floor that
  // baseline is built from rather than a budget to display.
  function handleGoalsApplied(applied: { stepsGoal?: number; calorieGoal?: number; waterGoalMl?: number }) {
    if (applied.stepsGoal != null) setStepsGoal(applied.stepsGoal);
  }

  const handleHideSection = useCallback((id: string) => {
    setHiddenSections(prev => {
      const next = new Set(prev);
      next.add(id as SectionKey);
      localStorage.setItem(HIDDEN_SECTIONS_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  const handleShowSection = useCallback((id: SectionKey) => {
    setHiddenSections(prev => {
      const next = new Set(prev);
      next.delete(id);
      localStorage.setItem(HIDDEN_SECTIONS_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  // Keep sectionOrder in sync when card widgets are toggled on/off in Profile.
  // Reads sectionOrderRef directly (always fresh) and writes localStorage synchronously
  // before calling setSectionOrder, so the save can't be skipped on unmount.
  useEffect(() => {
    const prev = sectionOrderRef.current;
    const enabledKeys = new Set(activeCardWidgets.map(k => `card_${k}` as CardSectionKey));
    const filtered = prev.filter(k => !k.startsWith("card_") || enabledKeys.has(k as CardSectionKey));
    const existingSet = new Set(filtered);
    const toAdd = activeCardWidgets
      .map(k => `card_${k}` as CardSectionKey)
      .filter(k => !existingSet.has(k));
    if (toAdd.length === 0 && filtered.length === prev.length) return;
    const metricIdx = filtered.indexOf("metricTiles");
    const insertAt = metricIdx >= 0 ? metricIdx : filtered.length;
    const next = [...filtered.slice(0, insertAt), ...toAdd, ...filtered.slice(insertAt)];
    localStorage.setItem(SECTION_ORDER_KEY, JSON.stringify(next));
    setSectionOrder(next);
  }, [activeCardWidgets]);

  // ta_session is a separate, human-readable label read by the AI chat route for
  // context — keep it the session name. The URL/cache key is the DB id, never the
  // name (CLAUDE.md no-hardcoded-names rule) — matches workout-select's existing nav.
  const handleSelect = useCallback((session: ProgramSession) => {
    document.cookie = `ta_session=${encodeURIComponent(session.name)}; path=/; max-age=${60 * 60 * 24 * 7}`;
    router.push(`/workout?session=${encodeURIComponent(session.id)}`);
  }, [router]);

  // ai_dynamic: user chose Full Session despite deload recommendation — record override
  const handleFullSessionOverride = useCallback((session: ProgramSession) => {
    document.cookie = `ta_session=${encodeURIComponent(session.name)}; path=/; max-age=${60 * 60 * 24 * 7}`;
    router.push(`/workout?session=${encodeURIComponent(session.id)}&wasOverride=1`);
  }, [router]);

  // ai_dynamic: user chose Rest Day
  const handleRestDay = useCallback(() => {
    // Persist the choice for today, then optimistically show the rest-day card.
    // Do NOT refetch /api/next-session here — it persists no rest-day state and would
    // just recompute the prompt, reverting the selection (the "doesn't select / glitches"
    // bug). The marker keeps the choice across navigation; isRestDayChosen() re-applies it.
    markRestDayChosen();
    setRecommendation(prev => prev ? { ...prev, isRestDay: true, deloadOrRestRecommended: false } : prev);
    fetch('/api/log-rest-day', { method: 'POST' }).catch(() => {});
  }, []);

  const visibleDefs = useMemo(() => WIDGET_DEFS.filter((d) => activeWidgets.includes(d.key)), [activeWidgets]);

  // Additive union, so a pending workout adds itself to a day the server already knows about
  // instead of being masked by it.
  const trainedDays = useMemo(
    () => mergeCalendarOverlay(
      { trainedDays: calendarDays, activityDays: {} },
      { trainedDays: pendingDays, activityDays: {} },
    ).trainedDays,
    [calendarDays, pendingDays],
  );

  // Current ISO week Mon–Sun, keyed off the server tz (DATE-A7) — matches the AEST bucketing
  // the server uses for day summaries/session dots, so the strip, morning-checkin marker, and
  // server data never disagree by a day.
  const weekStrip = useMemo(() => {
    const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];
    const todayStr = todayInTz().replace(/-/g, "/");
    const todayDowIdx = todayDayOfWeek();
    const mondayStr = startOfWeekInTz();

    return Array.from({ length: 7 }, (_, i) => {
      const dateKey = shiftDateStr(mondayStr, i).replace(/-/g, "/");
      return {
        label: DAY_LABELS[i],
        dateKey,
        dayNum: parseInt(dateKey.slice(8), 10),
        sessions: trainedDays[dateKey] ?? [] as string[],
        isToday: dateKey === todayStr,
        isFuture: i > todayDowIdx,
      };
    });
  }, [trainedDays]);

  // Streak: counts calendar days in the active window (training + allowed rest days)
  const streak = useMemo(() => {
    let count = 0;
    let consecutiveRest = 0;
    // 2 consecutive rest days keep the streak (warning); the 3rd breaks it — mirrors
    // the server rule in lib/ai-periodization/ai-dynamic.ts (streakWarning at 2,
    // streakBroken at >= 3) and the StreakCard banner copy. Breaking here at > 1 made
    // the count one day stricter than the banner promised.
    const MAX_REST_GAP = 2;
    // Only credit today if already trained — don't consume the rest-day allowance
    // for a day that hasn't ended yet.
    if ((trainedDays[dayKey(0)] ?? []).length > 0) count = 1;
    // Walk back from yesterday so an untrained today doesn't break the streak.
    for (let ago = 1; ago < 365; ago++) {
      const trained = (trainedDays[dayKey(ago)] ?? []).length > 0;
      if (trained) {
        count += 1 + consecutiveRest;
        consecutiveRest = 0;
      } else {
        consecutiveRest++;
        if (consecutiveRest > MAX_REST_GAP) break;
      }
    }
    return count;
  }, [trainedDays]);

  // This Week: Mon → today count (not rolling 7-day)
  const weekSessionCount = useMemo(
    () => weekStrip.filter(d => !d.isFuture && d.sessions.length > 0).length,
    [weekStrip],
  );

  // True only on a genuinely cold cache (first-ever visit / cleared cache) while the
  // initial fetch is still in flight — never flashes over cache-seeded content.
  const showHomeSkeleton = refreshing && activeSessions.length === 0 && recommendation === null && readiness === null;

  return (
    <div className="flex h-screen flex-col bg-page">
      <PullToSync
        onSync={handlePullSync}
        scrollClassName="flex-1 overflow-y-auto overflow-x-hidden pb-nav-safe"
        className="flex-1 flex flex-col overflow-hidden"
      >
        <div className="pointer-events-none fixed inset-0 overflow-hidden opacity-30"><Meteors number={10} /></div>

        {/* ── Header ── */}
        <ScreenHeader className="items-center" bordered={false}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                {formatInTimeZone(new Date(), tz, "EEEE d MMMM")}
              </p>
              <WeatherChip />
            </div>
            <h1 className="text-xl font-bold leading-tight line-clamp-2">
              {displayName ? getGreeting(displayName, tz) : "TrainingAI"}
            </h1>
          </div>
          <div className="flex items-center gap-2 flex-none">
            <button
              onClick={() => setSectionEditMode(e => !e)}
              className={cn("rounded-xl p-2 min-h-11 min-w-11 flex items-center justify-center transition", sectionEditMode ? "text-brand bg-brand/10" : "text-muted-foreground hover:bg-muted")}
              aria-label="Reorder sections"
            >
              <LayoutGridIcon className="h-4 w-4" />
            </button>
            <button
              onClick={() => {
                invalidateWorkoutMetaRefresh();
                fetchWorkoutData();
                fetchMeta();
                void syncOuraRing();                              // BLE drain — replaces the dead Cloud sync
                if (userId) pullDelta(userId, true).catch(() => {});
              }}
              disabled={refreshing}
              className="rounded-xl p-2 min-h-11 min-w-11 flex items-center justify-center text-muted-foreground hover:bg-muted transition"
              aria-label="Refresh"
            >
              <RefreshCwIcon className={cn("h-4 w-4", refreshing && "animate-spin")} />
            </button>
            <div className="relative flex-none">
              <button
                onClick={() => navigateToTab(router, "/more")}
                className="relative h-9 w-9 rounded-full flex items-center justify-center overflow-hidden border-2 border-border hover:border-brand transition"
                style={{ background: "var(--brand-card-bg)" }}
                aria-label="Profile"
              >
                {userAvatar ? (
                  <Image src={userAvatar} alt="avatar" fill sizes="36px"
                    unoptimized={userAvatar.startsWith('data:')} className="object-cover" />
                ) : (
                  <span className="text-xs font-bold" style={{ color: "var(--color-brand)" }}>
                    {displayName ? displayName.slice(0, 2).toUpperCase() : "?"}
                  </span>
                )}
              </button>
              {adminBadge > 0 && (
                <span className="absolute -top-1 -right-1 h-4 min-w-4 rounded-full bg-destructive text-xs font-bold text-destructive-foreground flex items-center justify-center px-0.5">
                  {adminBadge}
                </span>
              )}
            </div>
          </div>
        </ScreenHeader>

        {/* ── First-paint skeleton (cold cache only) ── */}
        {showHomeSkeleton && (
          <div className="px-4 pt-2 pb-3 flex flex-col gap-3">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        )}

        {/* ── Oura Score Chips ── */}
        {readiness && <OuraScoreChipRow readiness={readiness} />}

        {/* ── Illness advisory (elevated/fever only — self-hides otherwise) ── */}
        {readiness && <IllnessAdvisoryBanner readiness={readiness} />}

        {/* ── Body Battery ── */}
        {bodyBattery && <BodyBatteryCard battery={bodyBattery} />}

        {/* ── Auto-detected walk/run review prompt (hides itself when none pending) ── */}
        <div className="mx-4">
          <ExerciseDetectedCard onReview={handleExerciseDetectedReview} />
        </div>

        {readiness?.earlyDeloadRecommended && !earlyDeloadDismissed && (
          <div className="mx-4 mb-3">
            <EarlyDeloadCard
              onConfirm={handleEarlyDeloadConfirm}
              onDismiss={handleEarlyDeloadDismiss}
              reason={readiness.earlyDeload}
            />
          </div>
        )}

        {/* ── APK Download Banner ── */}
        {!apkBannerDismissed && (
          <div className="mx-4 mb-3 rounded-2xl border border-border p-3 flex items-center gap-3" style={{ background: "color-mix(in oklab, var(--color-brand) 8%, var(--color-background))", borderColor: "color-mix(in oklch, var(--color-brand) 25%, transparent)" }}>
            <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-none" style={{ background: "color-mix(in oklab, var(--color-brand) 15%, var(--color-muted))" }}>
              <Download className="h-4 w-4" style={{ color: "var(--color-brand)" }} />
            </div>
            <a href="/api/download-apk" className="flex-1 min-w-0">
              <p className="text-sm font-semibold leading-tight">Download Android App</p>
              <p className="text-[10px] text-muted-foreground">Get the latest APK</p>
            </a>
            <button
              onClick={() => {
                localStorage.setItem('apk-banner-dismissed', '1');
                setApkBannerDismissed(true);
              }}
              className="flex-none rounded-lg p-2.5 -m-1 text-muted-foreground hover:bg-muted/60 transition"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {showGoalsCheckin && (
          <div className="mx-4 mb-3">
            <GoalsCheckinCard onReviewNow={handleGoalsReviewNow} onRemindLater={handleGoalsRemindLater} />
          </div>
        )}

        {!dayReviewDismissed && (
          <DismissibleBanner
            title="Your day in review is ready"
            onActivate={() => setDayReviewOpen(true)}
            onDismiss={() => {
              localStorage.setItem(`ta_day_review_dismissed_${todayInTz()}`, '1');
              setDayReviewDismissed(true);
            }}
          />
        )}
        <DayReviewSheet open={dayReviewOpen} onOpenChange={setDayReviewOpen} />

        {/* ── Weekly recap notification (self-hides once dismissed or generated) ── */}
        <WeeklyRecapBanner />

        {/* ── Sections ── */}
        {!showHomeSkeleton && <div className="content-fade-in">
          {sectionOrder.filter(key => !hiddenSections.has(key)).map((key, idx) => {
            const content = (() => {
              // Every `card_*` key routes to the one component, which no-ops on a key the user has
              // toggled off. This was a nine-case fall-through list, so a newly registered widget
              // rendered nothing until someone remembered to add its line.
              if (key.startsWith("card_")) return (
                <HomeCardWidget
                  sectionKey={key as CardSectionKey}
                  sectionEditMode={sectionEditMode}
                  activeCardWidgets={activeCardWidgets}
                  cardColors={cardColors}
                  onColorChange={updateCardColor}
                  metaToday={metaToday}
                  metaRecent={metaRecent}
                  metaLoading={metaLoading}
                  weekToDate={weekToDate}
                  calorieType={calorieType}
                  weightLookback={weightLookback}
                  stepsGoal={stepsGoal}
                  stepsGoalType={stepsGoalType}
                  sleepGoal={sleepGoal}
                  sleepData={sleepData}
                  moodLog={moodLog}
                  acwrData={trainingLoad}
                  muscleData={muscleRecovery}
                  hrData={hrData}
                  setMoodSheetOpen={setMoodSheetOpen}
                />
              );
              switch (key) {
                case "recommendation": {
                  const showDeloadBanner = (
                    (recommendation?.deloadOrRestRecommended &&
                      (recommendation.consecutiveTrainingDays ?? 0) >= 4) ||
                    recommendation?.temperatureAlert
                  )
                  // Gate the workout recommendation behind mood check-in.
                  // Show check-in card while moodLog is loading or not yet entered.
                  if (moodLog === undefined || moodLog === null) {
                    return (
                      <>
                        {showDeloadBanner && recommendation && (
                          <DeloadBanner
                            consecutiveTrainingDays={recommendation.consecutiveTrainingDays ?? 0}
                            deloadStrength={recommendation.deloadStrength ?? 'soft'}
                            temperatureAlert={recommendation.temperatureAlert ?? false}
                            consecutiveRestDays={recommendation.consecutiveRestDays ?? 0}
                            streakBroken={recommendation.streakBroken ?? false}
                          />
                        )}
                      <ReadinessCheckinCard moodLog={moodLog} onOpen={handleOpenMoodSheet} />
                      </>
                    );
                  }
                  const todaySessionNames = trainedDays[dayKey(0)] ?? [];
                  const todaySessionName = todaySessionNames[0] ?? null;
                  return (
                    <>
                      <RecommendationCard
                        recommendation={recommendation}
                        todaySessionName={todaySessionName}
                        activeSessions={activeSessions}
                        moodLog={moodLog}
                        phaseStatus={phaseStatus}
                        perSessionPhaseStatus={perSessionPhaseStatus}
                        cardColors={cardColors}
                        sectionEditMode={sectionEditMode}
                        dayKey={dayKey}
                        workoutCardEpoch={workoutCardEpoch}
                        onStartWorkout={recommendation?.deloadOrRestRecommended ? handleFullSessionOverride : handleSelect}
                        onRestDay={handleRestDay}
                        onLogMood={handleOpenMoodSheet}
                        onColorChange={handleRecommendedColorChange}
                      />
                      {recommendation?.isRestDay && !todaySessionName && (
                        <div className="px-4 pb-3">
                          <RestDayCard
                            readiness={readiness}
                            moodLog={moodLog}
                            consecutiveRestDays={recommendation?.consecutiveRestDays}
                          />
                        </div>
                      )}
                    </>
                  );
                }
                case "streak":
                  return (
                    <StreakCard
                      streak={streak}
                      weekSessionCount={weekSessionCount}
                      weeklyTarget={weeklyTarget}
                      calendarDays={trainedDays}
                      cardColors={cardColors}
                      sectionEditMode={sectionEditMode}
                      dayKey={dayKey}
                      onNavigateStats={handleNavigateStats}
                      onColorChangeLeft={handleStreakLeftColorChange}
                      onColorChangeRight={handleStreakRightColorChange}
                      consecutiveRestDays={recommendation?.consecutiveRestDays}
                      streakWarning={recommendation?.streakWarning}
                      streakBroken={recommendation?.streakBroken}
                      isAiDynamic={isAiDynamic}
                    />
                  );
                case "weekStrip":
                  return (
                    <WeekStripCard
                      weekStrip={weekStrip}
                      activeSessions={activeSessions}
                      onDayClick={setWeekOverlayDate}
                    />
                  );
                case "metricTiles":
                  return (
                    <MetricTilesCard
                      visibleDefs={visibleDefs}
                      metaToday={metaToday}
                      metaRecent={metaRecent}
                      metaLoading={metaLoading}
                      pillColors={pillColors}
                      weekToDate={weekToDate}
                      waterGoal={waterGoal}
                      waterGoalType={waterGoalType}
                      onTileClick={handleNavigateHealthBody}
                      onLogTile={setLogWidget}
                      onLogWater={handleOpenWaterLog}
                    />
                  );
                default: return null;
              }
            })();
            if (content === null) return null;
            return (
              <HomeSortableSection key={key} id={key} editMode={sectionEditMode} onHide={handleHideSection}>
                {content}
              </HomeSortableSection>
            );
          })}
        </div>}

        {/* ── Hidden sections restore panel (edit mode only) ── */}
        {sectionEditMode && hiddenSections.size > 0 && (
          <div className="mx-4 mb-4 rounded-2xl border border-dashed border-border p-3 space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Hidden sections</p>
            {([...hiddenSections] as SectionKey[]).map(key => {
              const label: Record<SectionKey, string> = {
                recommendation:             'Recommended Today',
                streak:                     'Streak & This Week',
                weekStrip:                  'Week Strip',
                metricTiles:                'Metric Tiles',
                card_weightSparkline:    'Weight Trend',
                card_nutritionDonut:     'Nutrition',
                card_sleepWidget:        'Sleep',
                card_stepsWidget:        'Steps',
                card_moodWidget:         'Readiness',
                card_acwrWidget:         'ACWR',
                card_muscleStatusWidget: 'Muscle Status',
                card_hrChartWidget:      'Heart Rate Chart',
                card_energyBalanceWidget: 'Energy Balance',
              };
              return (
                <button
                  key={key}
                  onClick={() => handleShowSection(key)}
                  className="flex w-full items-center justify-between gap-2 rounded-xl bg-muted px-3 py-2.5 text-sm"
                >
                  <span className="font-medium">{label[key] ?? key}</span>
                  <span className="flex items-center gap-1 text-xs text-brand font-semibold">
                    <Eye className="h-3.5 w-3.5" /> Show
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* ── Day Timeline (bottom of home) ── */}
        <HomeDayTimeline />

      </PullToSync>

      <CoachFab />

      <GoalRecommendationSheet
        open={goalsSheetOpen}
        onOpenChange={setGoalsSheetOpen}
        data={goalsRecommendation}
        onUserSaved={handleGoalsUserSaved}
        onGoalsApplied={handleGoalsApplied}
      />

      <ExerciseHistorySheet exerciseName={historyEx} userId={userId} onClose={() => setHistoryEx(null)} />

      <ExerciseReviewSheet sessionId={reviewingSessionId} userId={userId} onClose={() => setReviewingSessionId(null)} />

      <MoodCheckInSheet
        open={moodSheetOpen}
        onOpenChange={setMoodSheetOpen}
        userId={userId}
        readiness={readiness?.score ?? null}
        onSaved={handleMoodSaved}
        // The raw setter, deliberately: it flips the card the moment the user taps save instead of
        // waiting on the local write handleMoodSaved sits behind, and being the setter it is both
        // stable and structurally incapable of carrying the refetch that must stay ordered (Q-248).
        onOptimisticSave={setMoodLog}
        initialLog={moodLog ?? null}
        sessionName={recommendation?.session?.name}
        sessionId={recommendation?.isRestDay ? undefined : recommendation?.session?.id}
        sessionBudgetMin={recommendation?.session?.timeBudgetMinutes}
        sessionMuscles={moodSheetSessionMuscles}
        sessionExercises={moodSheetSessionExercises}
      />

      <MorningCheckinSheet
        open={morningCheckinOpen}
        onClose={() => { markMorningCheckinPromptDone(); setMorningCheckinOpen(false); }}
        userId={userId}
        readiness={readiness?.score ?? null}
        onSaved={markMorningCheckinPromptDone}
      />

      <WaterLogSheet
        open={waterLogOpen}
        onOpenChange={setWaterLogOpen}
        // Q-243: the sheet owns its own invalidation on both write paths, so repeating it here was
        // redundant — and `invalidateReadinessInputs()` was worse than redundant. It drops
        // readiness-score, weekly-stats, progress-summary, muscle-recovery and body-battery, none of
        // which read water at all, so logging a glass made five instant-paint cards refetch for
        // nothing. `fetchMeta()` stays: that is this screen's own refresh, not cache invalidation.
        onLogged={() => { fetchMeta(); }}
        userId={userId}
      />

      <WeekDaySheet date={weekOverlayDate} onClose={() => setWeekOverlayDate(null)} onExerciseTap={setHistoryEx} />

      <LogValueSheet
        widget={logWidget}
        onClose={() => setLogWidget(null)}
        userId={userId}
        metaToday={metaToday}
        metaRecent={metaRecent}
        setMetaToday={setMetaToday}
        fetchMeta={fetchMeta}
      />

    </div>
  );
}
