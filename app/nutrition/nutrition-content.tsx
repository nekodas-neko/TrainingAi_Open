"use client";

import { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useTabVisibility } from "@/components/shell/tab-visibility";
import dynamic from "next/dynamic";
import { useDrag } from "@use-gesture/react";
import { AnimatePresence, motion } from "motion/react";
import { Settings, ChevronLeft, ChevronRight, MoonIcon } from "lucide-react";
import { MacroRing } from "@/components/nutrition/macro-ring";
import { MealCard } from "@/components/nutrition/meal-card";
import { FoodLoggerSheet } from "@/components/nutrition/food-logger-sheet";
import { QuickEditLogSheet } from "@/components/nutrition/quick-edit-log-sheet";
const MealTypeManager = dynamic(
  () => import("@/components/nutrition/meal-type-manager").then(m => m.MealTypeManager),
  { ssr: false },
);
const WeeklyNutritionChart = dynamic(
  () => import("@/components/nutrition/weekly-nutrition-chart").then(m => m.WeeklyNutritionChart),
  { ssr: false },
);
const EndOfDayReview = dynamic(
  () => import("@/components/nutrition/end-of-day/end-of-day-review").then(m => m.EndOfDayReview),
  { ssr: false },
);
import { SavedMealsSheet } from "@/components/nutrition/saved-meals-sheet";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScreenHeader } from "@/components/shell/screen-header";
import { Switch } from "@/components/ui/switch";
import { SupplementsSection } from "@/components/nutrition/supplements-section";
import type { MealType, FoodLogWithItem, NutritionTargets, MealPlan } from "@trainingai/shared/types/nutrition";
import type { SupplementWithStatus } from "@trainingai/shared/types/supplement";
import { toast } from "sonner";
import { cachedFetch, cachedFetchToday, readCacheSync, readTodayCacheSync, isBodyMetadataFresh } from "@/lib/sqlite/cache";
import { invalidateNutritionWrite } from "@/lib/cache-groups";
import { TTL_MEDIUM, TTL_LONG, NUTRITION_FOOD_LOGS_TTL, ENERGY_BALANCE_TTL } from '@trainingai/shared/cache-ttl';
import { todayInTz, shiftDateStr } from "@trainingai/shared/date-utils";
import { reconcileMealReminders, cancelAllMealReminders } from "@/lib/meal-reminders";
import type { BodyMetaRow } from "@/app/api/body-metadata/route";
import type { NutritionAdherenceResponse } from "@/app/api/nutrition/adherence/route";
import { getLocalStore } from "@/lib/local-store";
import { pushMutations } from "@/lib/local-store/sync-engine";
import { TdeeAdaptationCard } from "@/components/nutrition/tdee-adaptation-card";
import { CalorieBalanceBar } from "@/components/nutrition/calorie-balance-bar";
import { MealPlanSection } from "@/components/nutrition/meal-plan-section";
import { usePlanMealLogging } from "./use-plan-meal-logging";
import { decideLogsApplication } from "./food-log-application";
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
  const todayStr = todayInTz();
  const searchParams = useSearchParams();
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const selectedDateRef = useRef(selectedDate);
  useEffect(() => { selectedDateRef.current = selectedDate; }, [selectedDate]);
  // Direction of the most recent date change (+1 = forward, -1 = back), used by
  // the AnimatePresence slide below — set by both the chevron buttons and the swipe.
  const dateChangeDirRef = useRef(1);

  const [mealTypes, setMealTypes] = useState<MealType[]>([]);
  const [logs, setLogs] = useState<FoodLogWithItem[]>([]);
  // Which date `logs` currently holds data for. The anti-flicker guards in loadFoodLogs keep the
  // previous value when a fetch comes back empty, and without this they cannot tell a transient
  // empty response for the day on screen from the correct answer for a genuinely empty other day —
  // which is how yesterday's meals rendered on a fresh today after swiping back (Q-245).
  const logsDateRef = useRef<string | null>(null);
  const [targets, setTargets] = useState<NutritionTargets | null>(null);
  const [weeklyData, setWeeklyData] = useState<{ date: string; calories: number; proteinG: number; carbsG: number; fatG: number }[]>([]);
  const [adherence, setAdherence] = useState<NutritionAdherenceResponse | null>(null);
  const [activeEnergyKcalToday, setActiveEnergyKcalToday] = useState<number | null>(null);
  const [todayWaterMl, setTodayWaterMl] = useState<number | null>(null);
  const [waterLogOpen, setWaterLogOpen] = useState(false);
  const [energyBalance, setEnergyBalance] = useState<EnergyBalanceResponse | null>(null);
  const [mealPlan, setMealPlan] = useState<MealPlan | null>(null);
  const [planSetupOpen, setPlanSetupOpen] = useState(false);
  const [planReviewDismissed, setPlanReviewDismissed] = useState(false);
  const [planManageOpen, setPlanManageOpen] = useState(false);
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
    const meta = readCacheSync<{ today: BodyMetaRow | null; activeEnergyKcalToday?: number | null }>('body-metadata');
    if (meta && isBodyMetadataFresh(meta, tz)) {
      if (meta.activeEnergyKcalToday != null) setActiveEnergyKcalToday(meta.activeEnergyKcalToday);
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
  const loadFoodLogs = useCallback(async (today: string) => {
    const applyLogs = (next: FoodLogWithItem[]) => {
      // Read outside the updater: reading the ref *inside* would let React's dev-mode double-invoke
      // see its own write and flip 'replace' to 'keep' on the second pass.
      const logsDate = logsDateRef.current;
      const selectedDate = selectedDateRef.current;
      setLogs(prev => {
        const decision = decideLogsApplication({
          fetchDate: today, selectedDate, logsDate,
          nextIsEmpty: next.length === 0, prevIsEmpty: prev.length === 0,
        });
        if (decision === 'drop') return prev;
        logsDateRef.current = today;
        return decision === 'keep' ? prev : next;
      });
    };
    const store = userId ? getLocalStore(userId) : null;
    if (!store) {
      await cachedFetch<FoodLogWithItem[]>(
        `nutrition-food-logs-${today}`, `/api/nutrition/food-logs?date=${today}`, NUTRITION_FOOD_LOGS_TTL,
        d => applyLogs(Array.isArray(d) ? d : []),
      );
      return;
    }
    // Best-effort instant local render (offline-first; includes unsynced adds).
    try {
      applyLogs(await store.getFoodLogsWithItems(today));
    } catch { /* local store not ready — the server render below still runs */ }

    // The server copy is authoritative and MUST render whenever we're online —
    // a local-store error must never blank the list. (A local read/hydrate that
    // threw here previously left the page empty, so logged food "vanished on
    // reload" even though the server had it.) Fetch it, hydrate the local store
    // for offline use, and if that hydration/read fails, render the server copy.
    let server: FoodLogWithItem[] | null = null;
    try {
      const res = await fetch(`/api/nutrition/food-logs?date=${today}`);
      if (res.ok) {
        const d = await res.json();
        if (Array.isArray(d)) server = d as FoodLogWithItem[];
      }
    } catch { /* offline — keep whatever the local render above produced */ }
    if (!server) return;

    try {
      const nowIso = new Date().toISOString();
      await store.applyDelta({
        foodItems: server.map(l => ({
          id: l.foodItemId, name: l.foodItem.name, brand: l.foodItem.brand ?? null,
          servingSizeG: l.foodItem.servingSizeG, calories: l.foodItem.calories,
          proteinG: l.foodItem.proteinG, carbsG: l.foodItem.carbsG, fatG: l.foodItem.fatG,
          fiberG: l.foodItem.fiberG ?? null, sugarG: l.foodItem.sugarG ?? null,
          sodiumMg: l.foodItem.sodiumMg ?? null, satFatG: l.foodItem.satFatG ?? null,
          source: l.foodItem.source, updatedAt: nowIso,
        })),
        foodLogs: server.map(l => ({
          id: l.id, date: today, mealTypeId: l.mealTypeId, foodItemId: l.foodItemId,
          quantityMultiplier: l.quantityMultiplier,
          loggedAt: typeof l.loggedAt === 'string' ? l.loggedAt : new Date(l.loggedAt).toISOString(),
          updatedAt: nowIso, deletedAt: null, syncStatus: 'synced' as const,
        })),
      });
      applyLogs(await store.getFoodLogsWithItems(today));
    } catch {
      // Local hydrate/read failed (e.g. the on-device table isn't there yet) —
      // render the authoritative server copy so food always shows when online.
      applyLogs(server);
    }
  }, [userId]);

  // Date-dependent only: today's calories-burned-from-activity + the food log itself.
  // The mount-scoped fetches below (meal types, targets, weekly summary, adherence,
  // body-metadata) don't depend on selectedDate — see fetchMountData.
  const fetchData = useCallback(async (date?: string) => {
    const today = date ?? selectedDateRef.current;
    setLoading(true);
    try {
      const store = userId ? getLocalStore(userId) : null;
      if (store) {
        try {
          // Optimistic local paint only, ahead of the mount-scoped body-metadata network fetch
          // (which sets the authoritative activeEnergyKcalToday). NOTE: still narrower than that
          // fetch — activity_logs carries only logged walk/run/cycle activities (and a Guided Walk
          // writes caloriesBurned:null, same as the Q-96 root cause), never strength workouts. A
          // full computeActiveEnergy port to the local store would be needed to close that gap;
          // out of scope here since the network fetch corrects it moments later.
          const acts = (await store.getActivityLogs(today)).filter(a => a.date === today);
          if (acts.length) {
            setActiveEnergyKcalToday(acts.reduce((sum, a) => sum + (a.caloriesBurned ?? 0), 0));
          }
        } catch { /* local store unavailable — server/cache path below still runs */ }
      }
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
  }, [loadFoodLogs, userId]);

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
        cachedFetch<{ today: BodyMetaRow | null; activeEnergyKcalToday?: number | null }>(
          'body-metadata', '/api/body-metadata', TTL_MEDIUM,
          d => {
            if (isBodyMetadataFresh(d, tz)) {
              setActiveEnergyKcalToday(d.activeEnergyKcalToday ?? null);
              setTodayWaterMl(d.today?.waterMl ?? null);
            }
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

  const handleQuickEditSaved = useCallback((updated: FoodLogWithItem) => {
    setLogs(prev => prev.map(l => l.id === updated.id ? updated : l))
  }, [])

  useEffect(() => { fetchMountData(); }, [fetchMountData, userId]);
  useEffect(() => { fetchData(selectedDate); }, [fetchData, selectedDate]);

  const { epoch: tabEpoch } = useTabVisibility();
  const lastVisibleDayRef = useRef(todayStr);
  useEffect(() => {
    if (tabEpoch === 0) return;
    const today = todayInTz();
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
  }, [tabEpoch, fetchData]);

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
    const today = todayInTz();
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
  }, [userId, tabEpoch])

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
  const openQuickEdit = useCallback((log: FoodLogWithItem) => setEditingLog(log), []);

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
        pushMutations(userId!).then(() => {
          invalidateNutritionWrite().catch(() => {});
          refreshAffected();
        }).catch(() => {});
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

  // activeEnergyKcalToday genuinely only ever holds *today's* burn (the mount-scoped
  // body-metadata fetch is today-scoped) — never apply it to a past day's ring/goal, or
  // yesterday's macros read against an inflated target.
  const burnedForSelectedDate = selectedDate === todayStr ? activeEnergyKcalToday : null;
  const effectiveCalorieGoal = targets?.calories != null && burnedForSelectedDate != null && burnedForSelectedDate > 0
    ? targets.calories + Math.round(burnedForSelectedDate)
    : targets?.calories ?? null;
  const effectiveTargets = targets != null && effectiveCalorieGoal != null
    ? { ...targets, calories: effectiveCalorieGoal }
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
      <ScreenHeader>
        <div className="w-full">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-xl font-bold">Nutrition</h1>
              <p className="text-sm text-muted-foreground">Food diary &amp; macros</p>
            </div>
            <button
              onClick={() => setSettingsOpen(true)}
              aria-label="Nutrition settings"
              className="p-2 text-muted-foreground hover:text-foreground mt-1"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
          {/* Date navigation */}
          <div className="flex items-center justify-between mt-2">
            <button
              onClick={() => {
                dateChangeDirRef.current = -1;
                setSelectedDate(shiftDateStr(selectedDate, -1));
              }}
              aria-label="Previous day"
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-semibold">{formatDateLabel(selectedDate, todayStr)}</span>
            <button
              onClick={() => {
                if (selectedDate >= todayStr) return;
                dateChangeDirRef.current = 1;
                setSelectedDate(shiftDateStr(selectedDate, 1));
              }}
              aria-label="Next day"
              aria-disabled={selectedDate >= todayStr}
              className={`p-1.5 rounded-lg transition-colors ${selectedDate >= todayStr ? 'text-muted-foreground/30 cursor-default' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
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
            {/* Guarded on the payload's own date: the swipe re-renders before the new date's
                fetch resolves, and showing the previous day's balance is worse than a skeleton. */}
            <CalorieBalanceBar
              data={energyBalance?.date === selectedDate ? energyBalance : null}
              isToday={selectedDate === todayStr}
              loading={loading}
            />

            <MacroRing
              calories={totals.calories}
              proteinG={totals.proteinG}
              carbsG={totals.carbsG}
              fatG={totals.fatG}
              targets={effectiveTargets}
              calsBurnedToday={burnedForSelectedDate}
            />

            {/* Actions sit here, directly under the ring, rather than being reached by scroll depth
                (Q-237). Saved Meals is a library, not an action, and it used to be reachable only
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
                onDismiss={() => setPlanReviewDismissed(true)}
                onRebuild={() => { setPlanReviewDismissed(true); setPlanSetupOpen(true); }}
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
                onCreate={() => setPlanSetupOpen(true)}
                onViewPlan={() => setPlanManageOpen(true)}
              />
            )}

            <TdeeAdaptationCard
              energyBalance={energyBalance?.date === selectedDate ? energyBalance : null}
              onApplied={() => {
                cachedFetch<NutritionTargets>('nutrition-targets', '/api/nutrition/targets', TTL_LONG, d => setTargets(d ?? null));
              }}
            />

            {mealTypes.map(mt => (
              <MealCard
                key={mt.id}
                mealType={mt}
                logs={logsByMealType.get(mt.id) ?? EMPTY_LOGS}
                onAdd={openLogger}
                onDeleteLog={requestDeleteLog}
                onQuickEdit={openQuickEdit}
              />
            ))}

            {loading && mealTypes.length === 0 && (
              <div className="space-y-3" aria-label="Loading meals" aria-busy="true">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-20 rounded-2xl bg-muted/50 animate-pulse" />
                ))}
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* End of Day deliberately stays put: it is a daily-review feature, and merging it with
            Home's "Your Day in Review" banner is Q-112's call, not this placement change's. Moving
            it halfway would be worse than either end state. */}
        <button
          onClick={() => setChatOpen(true)}
          className="w-full min-h-[48px] flex items-center justify-center gap-2 rounded-2xl border border-border bg-muted/60 py-3 active:bg-muted/20 transition-colors"
        >
          <MoonIcon className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold">End of Day</span>
        </button>

        <WeeklyNutritionChart data={weeklyData} calorieTarget={targets?.calories ?? null} adherence={adherence} />

        {selectedDate === todayStr && (
          <SupplementsSection
            supplements={supplements}
            loading={supplementsLoading}
            onChanged={setSupplements}
            userId={userId}
          />
        )}
      </div>

      <WaterLogSheet
        open={waterLogOpen}
        onOpenChange={setWaterLogOpen}
        onLogged={(ml) => setTodayWaterMl(v => (v ?? 0) + ml)}
        userId={userId}
      />

      <FoodLoggerSheet
        open={loggerOpen}
        preselectedMealTypeId={loggerMealTypeId}
        onClose={() => { setLoggerOpen(false); setLoggerMealTypeId(null); }}
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
      />

      <SavedMealsSheet
        open={savedMealsOpen}
        onOpenChange={setSavedMealsOpen}
        onLogged={handleFoodLogged}
        userId={userId}
        logDate={selectedDate}
      />

      <QuickEditLogSheet key={editingLog?.id} log={editingLog} onClose={() => setEditingLog(null)} onSaved={handleQuickEditSaved} userId={userId} />

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
