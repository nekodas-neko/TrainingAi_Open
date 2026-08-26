"use client";

import { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useTabVisibility } from "@/components/shell/tab-visibility";
import dynamic from "next/dynamic";
import { useDrag } from "@use-gesture/react";
import { AnimatePresence, motion } from "motion/react";
import { Settings, ChevronLeft, ChevronRight } from "lucide-react";
import { MacroRing } from "@/components/nutrition/macro-ring";
import { DayToolsSection } from "@/components/nutrition/day-tools-section";
import { MIN_LOGGED_DAYS } from "@trainingai/shared/nutrition/adaptive-tdee";
import { budgetProvenance } from "@trainingai/shared/nutrition/calorie-balance";
import { MealCard } from "@/components/nutrition/meal-card";
import { FoodLoggerSheet } from "@/components/nutrition/food-logger-sheet";
import { QuickEditLogSheet } from "@/components/nutrition/quick-edit-log-sheet";
const MealTypeManager = dynamic(
  () => import("@/components/nutrition/meal-type-manager").then(m => m.MealTypeManager),
  { ssr: false },
);
const EndOfDayReview = dynamic(
  () => import("@/components/nutrition/end-of-day/end-of-day-review").then(m => m.EndOfDayReview),
  { ssr: false },
);
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScreenHeader } from "@/components/shell/screen-header";
import { Switch } from "@/components/ui/switch";
import type { MealType, FoodLogWithItem, NutritionTargets, MealPlan } from "@trainingai/shared/types/nutrition";
import type { SupplementWithStatus } from "@trainingai/shared/types/supplement";
import { toast } from "sonner";
import { cachedFetch, cachedFetchToday, readCacheSync, readTodayCacheSync, isBodyMetadataFresh } from "@/lib/sqlite/cache";
import { invalidateNutritionWrite } from "@/lib/cache-groups";
import { TTL_MEDIUM, TTL_LONG, ENERGY_BALANCE_TTL } from '@trainingai/shared/cache-ttl';
import { todayInTz, shiftDateStr } from "@trainingai/shared/date-utils";
import { reconcileMealReminders, cancelAllMealReminders } from "@/lib/meal-reminders";
import type { BodyMetaRow } from "@/app/api/body-metadata/route";
import type { NutritionAdherenceResponse } from "@/app/api/nutrition/adherence/route";
import { getLocalStore } from "@/lib/local-store";
import { pushThenRevalidate } from "@/lib/local-store/push-then-revalidate";
import { TdeeAdaptationCard } from "@/components/nutrition/tdee-adaptation-card";
import { CalorieBalanceBar } from "@/components/nutrition/calorie-balance-bar";
import { MealPlanSection } from "@/components/nutrition/meal-plan-section";
import { usePlanMealLogging } from "./use-plan-meal-logging";
import { usePlanMealSaving } from "./use-plan-meal-saving";
import { MealPlanReviewCard } from "@/components/nutrition/meal-plan-review-card";
const MealPlanEditSheet = dynamic(
  () => import("@/components/nutrition/meal-plan-edit-sheet").then(m => m.MealPlanEditSheet),
  { ssr: false },
);
const MealPlanManageSheet = dynamic(
  () => import("@/components/nutrition/meal-plan-manage-sheet").then(m => m.MealPlanManageSheet),
  { ssr: false },
);
import type { MealPlansResponse } from "@/app/api/nutrition/meal-plans/route";
const MealPlanSetupSheet = dynamic(
  () => import("@/components/nutrition/meal-plan-setup-sheet").then(m => m.MealPlanSetupSheet),
  { ssr: false },
);
import type { EnergyBalanceResponse } from "@/app/api/nutrition/energy-balance/route";
import { WaterLogSheet } from "@/components/profile/water-log-sheet";
import { mealTypeForHour } from "@trainingai/shared/nutrition/log-plan-meal";
import { NutritionActionRow } from "@/components/nutrition/nutrition-action-row";
import { useFoodLogsLoader } from "./use-food-logs-loader";
import { useUserTimezone } from "@/components/shell/user-timezone-provider";

const MEAL_PLAN_REVIEW_DAYS = 28;

/** True once the active plan has gone a review window without being looked at. Reads the date the
 *  server already sends rather than costing another round trip — there is no cron layer, so the
 *  check happens when the tab opens. */
function isPlanStale(plan: MealPlan): boolean {
  const last = plan.lastReviewedAt ?? plan.generatedAt;
  const ms = Date.now() - new Date(last).getTime();
  return ms > MEAL_PLAN_REVIEW_DAYS * 86_400_000;
}

const EMPTY_LOGS: FoodLogWithItem[] = [];

function formatDateLabel(dateStr: string, todayStr: string): string {
  if (dateStr === todayStr) return 'Today';
  const yStr = shiftDateStr(todayStr, -1);
  if (dateStr === yStr) return 'Yesterday';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function NutritionContent({ userId }: { userId?: string }) {
  const tz = useUserTimezone();
  const todayStr = todayInTz(tz);
  const searchParams = useSearchParams();
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const selectedDateRef = useRef(selectedDate);
  useEffect(() => { selectedDateRef.current = selectedDate; }, [selectedDate]);
  // Direction of the most recent date change (+1 = forward, -1 = back), used by
  // the AnimatePresence slide below — set by both the chevron buttons and the swipe.
  const dateChangeDirRef = useRef(1);

  const [mealTypes, setMealTypes] = useState<MealType[]>([]);
  const [logs, setLogs] = useState<FoodLogWithItem[]>([]);
  // Read by `openQuickEdit`, which takes an id so the diary row can stay on scalar props (Q-490).
  // A ref rather than a dep so the callback identity stays stable across every log change.
  const logsRef = useRef<FoodLogWithItem[]>([]);
  useEffect(() => { logsRef.current = logs; }, [logs]);
  // Which date `logs` currently holds data for. The anti-flicker guards in loadFoodLogs keep the
  // previous value when a fetch comes back empty, and without this they cannot tell a transient
  // empty response for the day on screen from the correct answer for a genuinely empty other day —
  // which is how yesterday's meals rendered on a fresh today after swiping back (Q-245).
  const logsDateRef = useRef<string | null>(null);
  const [targets, setTargets] = useState<NutritionTargets | null>(null);
  const [weeklyData, setWeeklyData] = useState<{ date: string; calories: number; proteinG: number; carbsG: number; fatG: number }[]>([]);
  const [adherence, setAdherence] = useState<NutritionAdherenceResponse | null>(null);
  const [todayWaterMl, setTodayWaterMl] = useState<number | null>(null);
  const [waterLogOpen, setWaterLogOpen] = useState(false);
  const [energyBalance, setEnergyBalance] = useState<EnergyBalanceResponse | null>(null);
  const [mealPlan, setMealPlan] = useState<MealPlan | null>(null);
  const [planSetupOpen, setPlanSetupOpen] = useState(false);
  const [planReviewDismissed, setPlanReviewDismissed] = useState(false);
  const [planManageOpen, setPlanManageOpen] = useState(false);
  // Q-357: `MealPlanReviewCard` and `MealPlanSection` are both `memo()`, and four inline arrows
  // here gave them a new identity every render, so both re-rendered on every keystroke elsewhere on
  // the screen while still reading as optimised. Setters only, so `[]` is stable by React's
  // guarantee.
  const dismissPlanReview = useCallback(() => setPlanReviewDismissed(true), []);
  const rebuildPlan = useCallback(() => { setPlanReviewDismissed(true); setPlanSetupOpen(true); }, []);
  const openPlanSetup = useCallback(() => setPlanSetupOpen(true), []);
  const openPlanManage = useCallback(() => setPlanManageOpen(true), []);
  const [planEditOpen, setPlanEditOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loggerOpen, setLoggerOpen] = useState(false);
  const [loggerMealTypeId, setLoggerMealTypeId] = useState<string | null>(null);
  const [editingLog, setEditingLog] = useState<FoodLogWithItem | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savedMealsOpen, setSavedMealsOpen] = useState(false);
  const [confirmDeleteLogId, setConfirmDeleteLogId] = useState<string | null>(null);
  const [mealRemindersEnabled, setMealRemindersEnabled] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [supplements, setSupplements] = useState<SupplementWithStatus[]>([])
  const [supplementsLoading, setSupplementsLoading] = useState(true)

  // Seed from localStorage/SQLite cache synchronously before first paint so the
  // page renders with data immediately rather than showing a blank state.
  useLayoutEffect(() => {
    const today = todayStr;
    const types = readCacheSync<MealType[]>('nutrition-meal-types');
    if (types) setMealTypes(Array.isArray(types) ? types : []);
    const food = readCacheSync<FoodLogWithItem[]>(`nutrition-food-logs-${today}`);
    if (food) { setLogs(Array.isArray(food) ? food : []); logsDateRef.current = today; }
    const tgts = readCacheSync<NutritionTargets>('nutrition-targets');
    if (tgts) setTargets(tgts);
    const weekly = readCacheSync<{ date: string; calories: number; proteinG: number; carbsG: number; fatG: number }[]>('nutrition-weekly-summary');
    if (weekly) setWeeklyData(Array.isArray(weekly) ? weekly : []);
    const cachedAdherence = readCacheSync<NutritionAdherenceResponse>('nutrition-adherence');
    if (cachedAdherence) setAdherence(cachedAdherence);
    const meta = readCacheSync<{ today: BodyMetaRow | null }>('body-metadata');
    if (meta && isBodyMetadataFresh(meta, tz)) {
      if (meta.today?.waterMl != null) setTodayWaterMl(meta.today.waterMl);
    }
    const supps = readTodayCacheSync<SupplementWithStatus[]>('supplements');
    if (supps) { setSupplements(Array.isArray(supps) ? supps : []); setSupplementsLoading(false); }
    const balance = readCacheSync<EnergyBalanceResponse>(`energy-balance:${today}`);
    if (balance) setEnergyBalance(balance);
    const plans = readCacheSync<MealPlansResponse>('meal-plans');
    if (plans) setMealPlan(plans.plans.find(p => p.isActive) ?? null);
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("ta_pref_meal_reminders");
    if (stored !== null) setMealRemindersEnabled(stored !== "false");
  }, []);

  useEffect(() => {
    if (searchParams.get("chat") === "backfill") setChatOpen(true);
  }, [searchParams]);

  // Deep-link from the home/health timeline's meal card (Q-93) — jump straight to that day's
  // log. Only ever a past-or-today date coming from a real logged meal, but clamp defensively
  // since this is untrusted input from the URL.
  useEffect(() => {
    const d = searchParams.get("date");
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= todayStr) setSelectedDate(d);
  }, [searchParams, todayStr]);

  const toggleMealReminders = (val: boolean) => {
    setMealRemindersEnabled(val);
    localStorage.setItem("ta_pref_meal_reminders", String(val));
    if (val) {
      reconcileMealReminders(mealTypes, logs);
    } else {
      cancelAllMealReminders(mealTypes.map(mt => mt.id));
    }
  };

  // Food logs are read local-first (the on-device store is the source of truth):
  // render the local store immediately (includes not-yet-synced adds), then
  // reconcile with the server and hydrate the local store so history renders
  // offline next time. applyDelta preserves locally-pending rows. When there is
  // no local store (web), fall back to the server-only read.
  const loadFoodLogs = useFoodLogsLoader({ userId, logsDateRef, selectedDateRef, setLogs });

  // Date-dependent only: today's calories-burned-from-activity + the food log itself.
  // The mount-scoped fetches below (meal types, targets, weekly summary, adherence,
  // body-metadata) don't depend on selectedDate — see fetchMountData.
  const fetchData = useCallback(async (date?: string) => {
    const today = date ?? selectedDateRef.current;
    setLoading(true);
    try {
      // Q-417: an optimistic local paint of today's burn used to sit here, summing
      // `activity_logs.caloriesBurned` ahead of the `body-metadata` fetch that would correct it.
      // Nothing sequenced the two, so whichever resolved last won — and the local sum is much
      // narrower (no strength sessions, no steps, and a Guided Walk writes `caloriesBurned: null`),
      // which is how the ring came to show a budget 179 kcal below the bar on the same card. It is
      // deleted rather than sequenced because nothing reads that value on this screen any more:
      // the budget comes from `/api/nutrition/energy-balance`.
      // Date-scoped, so it belongs here rather than in the mount-scoped block below. Seeded
      // synchronously from the same key in the layout effect, so a revisit paints last-known
      // numbers instead of a skeleton.
      await Promise.all([
        loadFoodLogs(today),
        cachedFetch<EnergyBalanceResponse>(
          `energy-balance:${today}`, `/api/nutrition/energy-balance?date=${today}`, ENERGY_BALANCE_TTL,
          d => setEnergyBalance(d ?? null),
        ),
      ]);
    } catch { /* non-fatal */ }
    finally { setLoading(false); }
  }, [loadFoodLogs]);

  // Mount-scoped (PERF-5) — these seven fetches don't depend on selectedDate, so they
  // previously all re-ran on every date-swipe (≈40 requests browsing back 5 days).
  const fetchMountData = useCallback(async () => {
    try {
      await Promise.all([
        cachedFetch<MealType[]>(
          'nutrition-meal-types', '/api/nutrition/meal-types', TTL_LONG,
          d => {
            const types = Array.isArray(d) ? d : [];
            setMealTypes(types);
            // Hydrate the offline mirror so a food log opened later without network still
            // groups under a real name/emoji instead of vanishing into an "Unknown" bucket.
            const store = userId ? getLocalStore(userId) : null;
            if (store && types.length) store.replaceMealTypes(types).catch(() => {});
          },
        ),
        cachedFetch<NutritionTargets>(
          'nutrition-targets', '/api/nutrition/targets', TTL_LONG,
          d => setTargets(d ?? null),
        ),
        cachedFetch<{ date: string; calories: number; proteinG: number; carbsG: number; fatG: number }[]>(
          'nutrition-weekly-summary', '/api/nutrition/weekly-summary', TTL_MEDIUM,
          d => setWeeklyData(Array.isArray(d) ? d : []),
        ),
        (async () => {
          // Local first — the plan has to render with no network, which is the whole point of
          // storing its names and macros on the device rather than just ids.
          const store = userId ? getLocalStore(userId) : null;
          if (store) {
            try {
              const local = await store.getActiveMealPlan();
              if (local) setMealPlan(local);
            } catch { /* local store not ready — the fetch below still runs */ }
          }
          await cachedFetch<MealPlansResponse>(
            'meal-plans', '/api/nutrition/meal-plans', TTL_MEDIUM,
            d => setMealPlan(d?.plans.find(p => p.isActive) ?? null),
          );
        })(),
        cachedFetch<NutritionAdherenceResponse>(
          'nutrition-adherence', '/api/nutrition/adherence', TTL_MEDIUM,
          d => setAdherence(d),
        ),
        cachedFetch<{ today: BodyMetaRow | null }>(
          'body-metadata', '/api/body-metadata', TTL_MEDIUM,
          d => {
            if (isBodyMetadataFresh(d, tz)) setTodayWaterMl(d.today?.waterMl ?? null);
          },
        ),
      ]);
    } catch { /* non-fatal */ }
  }, [userId, tz]);

  const handleFoodLogged = useCallback((newLog?: FoodLogWithItem) => {
    if (newLog) {
      if (newLog.date && newLog.date !== selectedDateRef.current) return; // lands via cache invalidation
      setLogs(prev => [...prev, newLog])
    } else {
      fetchData(selectedDateRef.current)
    }
  }, [fetchData])

  const {
    logMeal: handleLogPlanMeal, loggingPosition: loggingPlanPosition,
    loggedPositions: loggedPlanPositions, declinedMealIds, setDeclined: handleSetPlanMealDeclined,
  } = usePlanMealLogging({ mealPlan, mealTypes, logs, userId, dateRef: selectedDateRef, onLogged: handleFoodLogged })

  const {
    saveMeal: handleSavePlanMeal, saveMeals: handleSavePlanMeals, savingPositions: savingPlanPositions,
  } = usePlanMealSaving({ mealPlan, userId, onPlanChanged: setMealPlan })

  const handleQuickEditSaved = useCallback((updated: FoodLogWithItem) => {
    setLogs(prev => prev.map(l => l.id === updated.id ? updated : l))
  }, [])

  useEffect(() => { fetchMountData(); }, [fetchMountData, userId]);
  useEffect(() => { fetchData(selectedDate); }, [fetchData, selectedDate]);

  const { epoch: tabEpoch } = useTabVisibility();
  const lastVisibleDayRef = useRef(todayStr);
  useEffect(() => {
    if (tabEpoch === 0) return;
    const today = todayInTz(tz);
    if (lastVisibleDayRef.current !== today && selectedDateRef.current === lastVisibleDayRef.current) {
      // Midnight rolled while hidden and the user was on "today" — follow it,
      // as a fresh mount used to. fetchData re-runs via the [selectedDate] effect.
      lastVisibleDayRef.current = today;
      dateChangeDirRef.current = 1;
      setSelectedDate(today);
      return;
    }
    lastVisibleDayRef.current = today;
    fetchData(selectedDateRef.current);
  }, [tabEpoch, fetchData, tz]);

  // Local-first meal-type read: paint the mirrored names/emoji before the network cache
  // resolves, so a food log opened offline groups under a real meal type. `fetchMountData`'s
  // network read still runs and overwrites this with the authoritative server copy.
  useEffect(() => {
    const store = userId ? getLocalStore(userId) : null;
    if (!store) return;
    store.getMealTypes().then(types => {
      if (types.length) {
        setMealTypes(types.map(t => ({ ...t, userId: userId!, createdAt: new Date(0) })));
      }
    }).catch(() => {});
  }, [userId]);

  useEffect(() => {
    const today = todayInTz(tz);
    const store = userId ? getLocalStore(userId) : null;
    if (store) {
      Promise.all([store.getSupplements(), store.getSupplementLogs(today)]).then(([defs, logs]) => {
        if (defs.length > 0) {
          const loggedIds = new Set(logs.map(l => l.supplementId));
          setSupplements(defs.map(s => ({
            id: s.id, userId: userId!, name: s.name, dose: s.dose,
            reminderEnabled: s.reminderEnabled, reminderTime: s.reminderTime,
            sortOrder: s.sortOrder, active: s.active,
            createdAt: s.updatedAt, loggedToday: loggedIds.has(s.id),
          })));
          setSupplementsLoading(false);
          return;
        }
        throw new Error('empty');
      }).catch(() => {
        cachedFetchToday<SupplementWithStatus[]>(
          'supplements', '/api/supplements', TTL_MEDIUM,
          d => setSupplements(Array.isArray(d) ? d : []),
        ).catch(() => {}).finally(() => setSupplementsLoading(false));
      });
    } else {
      // cachedFetchToday, not cachedFetch: the same key is written by the today-variant at the
      // seed site (`readTodayCacheSync` above), by the sync-provider's warm pass, and by the
      // fallback directly above. Mixing variants on one key means incompatible envelopes
      // ({date,data} vs a raw array), so whichever wrote last decided whether this branch saw an
      // array at all — and when it did not, the section rendered empty (Q-124b, the weekly-stats
      // crash class). This branch is reachable on device too, not just web: getLocalStore returns
      // null whenever the store failed to open or before userId resolves.
      cachedFetchToday<SupplementWithStatus[]>(
        'supplements', '/api/supplements', TTL_MEDIUM,
        d => setSupplements(Array.isArray(d) ? d : []),
      ).catch(() => {}).finally(() => setSupplementsLoading(false));
    }
  }, [userId, tabEpoch, tz])

  const totals = logs.reduce(
    (acc, l) => ({ calories: acc.calories + l.calories, proteinG: acc.proteinG + l.proteinG, carbsG: acc.carbsG + l.carbsG, fatG: acc.fatG + l.fatG }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );

  const logsByMealType = useMemo(() => {
    const m = new Map<string, FoodLogWithItem[]>();
    for (const l of logs) { const arr = m.get(l.mealTypeId) ?? []; arr.push(l); m.set(l.mealTypeId, arr); }
    return m;
  }, [logs]);
  const openLogger = useCallback((mealTypeId: string) => { setLoggerMealTypeId(mealTypeId); setLoggerOpen(true); }, []);
  const requestDeleteLog = useCallback((logId: string) => setConfirmDeleteLogId(logId), []);
  // By id: the diary row is the shared `FoodRow` now and passes scalars, so the lookup happens
  // here, where the logs live (Q-406).
  const openQuickEdit = useCallback((logId: string) => {
    setEditingLog(logsRef.current.find(l => l.id === logId) ?? null);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!confirmDeleteLogId) return;
    const id = confirmDeleteLogId;
    setConfirmDeleteLogId(null);
    const today = selectedDateRef.current;
    // Optimistically remove from UI
    setLogs(prev => prev.filter(l => l.id !== id));
    // A delete only ever affects today's log + the weekly-summary total — not the other
    // five mount-scoped fetches (meal types, targets, adherence, body-metadata, profile).
    const refreshAffected = () => {
      loadFoodLogs(today);
      cachedFetch<{ date: string; calories: number; proteinG: number; carbsG: number; fatG: number }[]>(
        'nutrition-weekly-summary', '/api/nutrition/weekly-summary', TTL_MEDIUM,
        d => setWeeklyData(Array.isArray(d) ? d : []),
      ).catch(() => {});
    };
    const store = userId ? getLocalStore(userId) : null;
    if (store) {
      try {
        await store.deleteFoodLog(id);
        await store.queueMutation({ userId: userId!, domain: 'food_logs', date: today, payload: { id, deleted: true } });
        // The mirror image of LB-4's bug, and the reason this site needed changing rather than
        // being held up as the correct one: invalidating ONLY after the push means an offline
        // delete repaints nothing at all, because `pushMutations` never resolves usefully with no
        // network. Both halves are needed — immediately for this device, again once the server has
        // the delete.
        const revalidate = async () => {
          await invalidateNutritionWrite().catch(() => {});
          refreshAffected();
        };
        void revalidate();
        pushThenRevalidate(userId!, revalidate);
        return;
      } catch (e) {
        // Fall through to the server delete rather than reporting failure (Q-216). This used to
        // toast and return, so a local-store throw left the row on the server with nothing queued
        // to remove it — the delete simply did not happen.
        console.error('Food-log delete SQLite write failed, falling back to API:', e);
      }
    }
    // Web fallback — also the on-device recovery path when the local delete above threw.
    try {
      const res = await fetch(`/api/nutrition/food-logs/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
    } catch {
      toast.error('Failed to delete food entry');
      return;
    }
    await invalidateNutritionWrite();
    refreshAffected();
  }, [confirmDeleteLogId, loadFoodLogs, userId]);

  /**
   * The day's budget and macro grams, both taken from `/api/nutrition/energy-balance` (Q-417/Q-323).
   *
   * **This used to be `targets.calories + activeEnergyKcalToday`, and it produced a third budget.**
   * Measured on the owner's screen: the zone bar two rows below said 2,180, Home's donut said
   * 2,451, and this ring said 2,001 — so the same card printed "Goal reached" against 2,014 eaten
   * while the card above it said "166 kcal left". Two separate faults fed it, and reading the
   * budget from the payload removes both at once:
   *
   *  - `nutrition_targets.calories` is the **rest-day floor**, not `restingBase + targetNet`, so
   *    adding movement to it was never the same quantity the rest of the app shows.
   *  - `activeEnergyKcalToday` is painted optimistically from the local store ahead of the
   *    `body-metadata` fetch, and **nothing sequences the two**. Whichever resolved last won; here
   *    the local one did, at 101 against the server's 551, because the local sum sees neither
   *    strength sessions nor steps and a Guided Walk writes `caloriesBurned: null` (Q-96).
   *
   * The date guard stays and is load-bearing for a different reason than before: the payload is
   * fetched per selected date, so a response for another day must not be read against this one.
   */
  const balanceForDate = energyBalance?.date === selectedDate ? energyBalance : null;
  const budget = balanceForDate?.balance ? budgetProvenance(balanceForDate.balance) : null;
  // Falls back to the stored goal alone rather than composing one: with no payload there is no
  // measured movement to add, and inventing an addend is what produced the third number.
  const effectiveCalorieGoal = budget?.total ?? targets?.calories ?? null;
  const earnedForSelectedDate = budget?.earned ?? null;
  // Q-323's remaining half: `scaled` is already computed server-side by `scaleMacrosForEarnedKcal`
  // (carbs and fat absorb the earned kcal in their existing ratio; protein is dosed per kg of
  // bodyweight and holds). The ring rendered `base`, so a day with 551 earned reported fat *over*
  // when it was well under. Never re-derive it here — that is the second implementation the
  // one-formula rule exists to stop.
  const scaledMacros = balanceForDate?.macroTargets?.scaled ?? null;
  const effectiveTargets = targets != null
    ? {
        ...targets,
        calories: effectiveCalorieGoal ?? targets.calories,
        ...(scaledMacros ?? {}),
      }
    : targets;

  const bindDateSwipe = useDrag(
    ({ movement: [mx], last, velocity: [vx] }) => {
      if (!last) return;
      if (Math.abs(mx) < 60 && vx < 0.5) return;
      if (mx < 0 && selectedDate < todayStr) {
        dateChangeDirRef.current = 1;
        setSelectedDate(shiftDateStr(selectedDate, 1));
      } else if (mx > 0) {
        dateChangeDirRef.current = -1;
        setSelectedDate(shiftDateStr(selectedDate, -1));
      }
    },
    { axis: "x", filterTaps: true, pointer: { touch: true } },
  );

  return (
    <div className="flex flex-col bg-page h-screen">
      {/* BF-24 ①: one band, not two. Artboard 1 draws a 26 px title with the DATE as its subtitle
          and the gear at the right; the shipped screen had a static "Food diary & macros" line that
          said nothing and pushed the date onto a second row of its own. The day chevrons stay —
          the drawing depicts a state, not the controls that reach it, and the swipe alone is not a
          discoverable affordance — but they sit on the subtitle line now, so the header is one
          band. Their hit area is 44 px with negative margins, so the row's height still comes from
          the text: bigger than the 28 px they shipped at, not smaller. */}
      <ScreenHeader>
        <div className="flex w-full items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-[26px] font-semibold leading-none tracking-[-0.02em]">Nutrition</h1>
            <div className="mt-1 flex items-center gap-0.5">
              <span className="text-[13px] text-muted-foreground">{formatDateLabel(selectedDate, todayStr)}</span>
              <button
                onClick={() => {
                  dateChangeDirRef.current = -1;
                  setSelectedDate(shiftDateStr(selectedDate, -1));
                }}
                aria-label="Previous day"
                className="-my-3 ml-1 flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => {
                  if (selectedDate >= todayStr) return;
                  dateChangeDirRef.current = 1;
                  setSelectedDate(shiftDateStr(selectedDate, 1));
                }}
                aria-label="Next day"
                aria-disabled={selectedDate >= todayStr}
                className={`-my-3 flex h-11 w-11 items-center justify-center rounded-lg transition-colors ${selectedDate >= todayStr ? 'cursor-default text-muted-foreground/30' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
          <button
            onClick={() => setSettingsOpen(true)}
            aria-label="Nutrition settings"
            className="-mr-2 flex h-11 w-11 flex-none items-center justify-center text-muted-foreground hover:text-foreground"
          >
            <Settings className="h-5 w-5" />
          </button>
        </div>
      </ScreenHeader>

      <div
        {...bindDateSwipe()}
        data-swipe-carousel
        style={{ touchAction: "pan-y" }}
        className="flex-1 overflow-y-auto scrollbar-hide px-4 pt-5 pb-nav-safe space-y-5"
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={selectedDate}
            initial={{ opacity: 0, x: dateChangeDirRef.current * 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -dateChangeDirRef.current * 24 }}
            transition={{ duration: 0.18 }}
            className="space-y-5"
          >
            {/* Q-395b: today's energy is ONE section — the balance bar and the ring are two views of
                the same number, and a gap between them read as two unrelated cards. */}
            <div className="divide-y divide-border/50 overflow-hidden rounded-2xl border border-border">
              {/* Guarded on the payload's own date: the swipe re-renders before the new date's
                  fetch resolves, and showing the previous day's balance is worse than a skeleton. */}
              <CalorieBalanceBar
                data={energyBalance?.date === selectedDate ? energyBalance : null}
                isToday={selectedDate === todayStr}
                loading={loading}
                grouped
              />

              <MacroRing
                calories={totals.calories}
                proteinG={totals.proteinG}
                carbsG={totals.carbsG}
                fatG={totals.fatG}
                targets={effectiveTargets}
                earnedKcal={earnedForSelectedDate}
                grouped
              />
            </div>

            {/* Actions sit here, directly under the ring, rather than being reached by scroll depth
                (Q-237). My Foods is a library, not an action, and it used to be reachable only
                after scrolling past every meal card — so where it landed depended on how many meals
                the day had. Water was mid-scroll for the same reason. */}
            {/* Q-257: the bucket comes from `mealTypeForHour`, which is not a choice made here —
                it is how the saved-meals sheet and `logPlanMeal` already decide, and its doc comment
                says it is shared so the two cannot drift when meal-type hours change. A third rule
                would be that drift. Device hour, like both existing callers: "which meal am I eating
                right now" is about where the user physically is, and this is not a key that has to
                match server bucketing. */}
            {selectedDate === todayStr && (
              <NutritionActionRow
                todayWaterMl={todayWaterMl}
                canLogFood={mealTypes.length > 0}
                onLogFood={() => { const id = mealTypeForHour(mealTypes, new Date().getHours()); if (id) openLogger(id) }}
                onLogWater={() => setWaterLogOpen(true)}
                onOpenSavedMeals={() => setSavedMealsOpen(true)}
              />
            )}

            {selectedDate === todayStr && mealPlan && !planReviewDismissed && isPlanStale(mealPlan) && (
              <MealPlanReviewCard
                plan={mealPlan}
                maintenanceKcal={energyBalance?.maintenance?.source === 'calibrated'
                  ? energyBalance.maintenance.kcal : null}
                recommendedKcal={energyBalance?.target.recommendedKcal ?? null}
                onDismiss={dismissPlanReview}
                onRebuild={rebuildPlan}
              />
            )}

            {selectedDate === todayStr && (
              <MealPlanSection
                plan={mealPlan}
                loading={loading && mealPlan === null}
                eaten={logs.length > 0 ? totals : undefined}
                onLogMeal={mealTypes.length > 0 ? handleLogPlanMeal : undefined}
                loggingPosition={loggingPlanPosition}
                loggedPositions={loggedPlanPositions}
                declinedMealIds={declinedMealIds}
                onSetDeclined={mealTypes.length > 0 ? handleSetPlanMealDeclined : undefined}
                onSaveMeal={handleSavePlanMeal}
                onSaveAllMeals={handleSavePlanMeals}
                savingPositions={savingPlanPositions}
                onCreate={openPlanSetup}
                onViewPlan={openPlanManage}
              />
            )}

            <TdeeAdaptationCard
              energyBalance={energyBalance?.date === selectedDate ? energyBalance : null}
              onApplied={() => {
                cachedFetch<NutritionTargets>('nutrition-targets', '/api/nutrition/targets', TTL_LONG, d => setTargets(d ?? null));
              }}
            />

            {/* BF-24 ④: each meal is its own card with its name as a label above it — artboard 1
                groups the food ROWS within a meal, where Q-395b grouped the MEALS within one
                container. That reversal is what the owner reacted to. 14 px between meal groups is
                the drawing's own figure. */}
            {mealTypes.length > 0 && (
              <div className="space-y-3.5">
                {mealTypes.map(mt => (
                  <MealCard
                    key={mt.id}
                    mealType={mt}
                    logs={logsByMealType.get(mt.id) ?? EMPTY_LOGS}
                    onAdd={openLogger}
                    onQuickEdit={openQuickEdit}
                  />
                ))}
              </div>
            )}

            {loading && mealTypes.length === 0 && (
              <div className="space-y-3" aria-label="Loading meals" aria-busy="true">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-20 rounded-2xl bg-muted/50 animate-pulse" />
                ))}
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        <DayToolsSection
          selectedDate={selectedDate}
          isToday={selectedDate === todayStr}
          daysLogged={balanceForDate?.maintenance?.daysLogged ?? null}
          minDays={MIN_LOGGED_DAYS}
          calibrated={balanceForDate?.maintenance?.source === 'calibrated'}
          tz={tz}
          weeklyData={weeklyData}
          calorieTarget={targets?.calories ?? null}
          adherence={adherence}
          supplements={supplements}
          supplementsLoading={supplementsLoading}
          onSupplementsChanged={setSupplements}
          userId={userId}
          onEndOfDay={() => setChatOpen(true)}
        />
      </div>

      <WaterLogSheet
        open={waterLogOpen}
        onOpenChange={setWaterLogOpen}
        onLogged={(ml) => setTodayWaterMl(v => (v ?? 0) + ml)}
        userId={userId}
      />

      {/* My Foods opens the logger onto its list rather than opening the list alone: the list now
          shows foods as well as meals, and a food's tap needs the assign step this sheet owns. */}
      <FoodLoggerSheet
        open={loggerOpen || savedMealsOpen}
        openMyFoods={savedMealsOpen}
        preselectedMealTypeId={loggerMealTypeId}
        onClose={() => { setLoggerOpen(false); setSavedMealsOpen(false); setLoggerMealTypeId(null); }}
        onLogged={handleFoodLogged}
        userId={userId}
        logDate={selectedDate}
      />

      <MealPlanManageSheet
        plan={planManageOpen ? mealPlan : null}
        onOpenChange={o => setPlanManageOpen(o)}
        onChanged={p => { setMealPlan(p); setPlanManageOpen(false); }}
        onRebuild={() => { setPlanManageOpen(false); setPlanSetupOpen(true); }}
        onEditMeals={() => { setPlanManageOpen(false); setPlanEditOpen(true); }}
      />

      <MealPlanEditSheet
        plan={planEditOpen ? mealPlan : null}
        onOpenChange={o => setPlanEditOpen(o)}
        onChanged={setMealPlan}
      />

      <MealPlanSetupSheet
        open={planSetupOpen}
        onOpenChange={setPlanSetupOpen}
        onSaved={setMealPlan}
        userId={userId}
      />

      <QuickEditLogSheet key={editingLog?.id} log={editingLog} onClose={() => setEditingLog(null)} onSaved={handleQuickEditSaved} onDelete={requestDeleteLog} userId={userId} />

      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] flex flex-col">
          <SheetHeader className="border-b border-border/30 pb-3 shrink-0">
            <SheetTitle>Nutrition Settings</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto scrollbar-hide p-4 space-y-6">
            <div>
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Meal Reminders</h3>
              <div className="rounded-xl bg-muted px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">Remind me to log meals</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Get a notification if a meal window ends with nothing logged
                  </p>
                </div>
                <Switch checked={mealRemindersEnabled} onCheckedChange={toggleMealReminders} />
              </div>
            </div>
            <div>
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Meal Types</h3>
              <MealTypeManager />
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={confirmDeleteLogId !== null} onOpenChange={open => { if (!open) setConfirmDeleteLogId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete food log?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">This cannot be undone.</p>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => setConfirmDeleteLogId(null)}>Cancel</Button>
            <Button variant="destructive" className="flex-1" onClick={handleConfirmDelete}>Delete</Button>
          </div>
        </DialogContent>
      </Dialog>

      <EndOfDayReview
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        mealTypes={mealTypes}
        logs={logs}
        date={selectedDate}
        userId={userId}
        targets={targets}
        onLogged={handleFoodLogged}
      />
    </div>
  );
}
