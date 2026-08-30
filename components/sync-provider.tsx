'use client';

import { useEffect } from 'react';
import { useUserTimezone } from "@/components/shell/user-timezone-provider";
import { initSQLite } from '@/lib/sqlite/sqlite-service';
import { MIGRATIONS } from '@/lib/sqlite/migrations';
import { getCached, setCached, mirrorToSessionCache, cachedFetch, cachedFetchToday } from '@/lib/sqlite/cache';
import { reconcileMealReminders, scheduleEndOfDayReminder } from '@/lib/meal-reminders';
import { scheduleEveningReminder, scheduleWeeklyRecapReminder } from '@/lib/day-review-reminders';
import { reconcileWorkoutReminder } from '@/lib/workout-reminders';
import { reconcileSupplementReminders } from '@/lib/supplement-reminders';
import { reconcileHealthAlerts } from '@/lib/health-alerts';
import type { ReadinessScoreResponse } from '@/app/api/readiness-score/route';
import type { BodyBatteryResponse } from '@/app/api/body-battery/route';
import { todayInTz } from '@trainingai/shared/date-utils';
import { pullDelta, pushMutations } from '@/lib/local-store/sync-engine';
import { markLocalStoreDead } from '@/lib/local-store/dead-store-signal';
import { reportClientError } from '@/lib/client-error';
import { hydrateGoalSeeds, type GoalSeedValues } from '@/lib/home/home-prefs';
import { hydrateUserPreferences } from '@/lib/user/preferences-sync';
import type { UserPreferences } from '@trainingai/shared/user/preferences';
import {
  invalidateBiometrics, invalidateProgramStructure, invalidateWorkoutSummaries,
  invalidateMealPlans,
  invalidateNutritionWrite, invalidateSupplements, invalidateActivityWrites, invalidateInjuryWrites, invalidateOuraSync, invalidateRunningPlan, invalidateFitnessTests,
} from '@/lib/cache-groups';
import { BODY_BATTERY_TTL, TTL_MEDIUM, TTL_LONG, READINESS_SCORE_TTL, MUSCLE_RECOVERY_TTL, NEXT_SESSION_TTL, NUTRITION_FOOD_LOGS_TTL, TRAINING_STRESS_TTL } from '@trainingai/shared/cache-ttl';
import { getStepOrchestrator } from '@/lib/oura-ble/step-orchestrator';
import { getContinuousCapture, isContinuousCaptureEnabled } from '@/lib/oura-ble/continuous-capture';
import { getOuraBle } from '@/lib/oura-ble/plugin';

interface CacheTask {
  key: string;
  url: string;
  ttl: number;
  // This key's readers are cachedFetchToday/readTodayCacheSync (a {date, data}
  // envelope so a stored value can't survive past local midnight as a false
  // cache hit) — the warm write below must match that shape or every reader
  // treats the warmed entry as a miss and it's wasted.
  today?: boolean;
  // Runs on the payload whether it came from the network or was already fresh in cache, so a
  // launch that warms nothing still applies it. Used to push the server's goals into their
  // localStorage seed (Q-241) — without it that seed only converges on a tab the user opens, and
  // the whole point is that a device which has never shown Health is not left holding stale goals.
  afterData?: (data: unknown) => void;
}

const CACHE_TASKS: CacheTask[] = [
  { key: 'body-metadata',           url: '/api/body-metadata',              ttl: TTL_MEDIUM },
  { key: 'next-session',            url: '/api/next-session',               ttl: NEXT_SESSION_TTL, today: true },
  { key: 'weekly-stats',            url: '/api/weekly-stats',               ttl: TTL_MEDIUM, today: true },
  { key: 'workout-data:meta',       url: '/api/workout-data?tab=meta',      ttl: TTL_LONG   },
  { key: 'progression-styles',      url: '/api/progression-styles',         ttl: TTL_LONG   },
  { key: 'workout-templates',       url: '/api/workout-templates',          ttl: TTL_LONG   },
  { key: 'exercise-library',        url: '/api/exercise-library',           ttl: TTL_LONG   },
  { key: 'activity-types',          url: '/api/activity-types',             ttl: TTL_LONG   },
  { key: 'weights-summary',         url: '/api/weights-summary',            ttl: TTL_MEDIUM },
  { key: 'progress-summary',        url: '/api/progress-summary',           ttl: TTL_MEDIUM, today: true },
  { key: 'user-goals',              url: '/api/user/goals',                 ttl: TTL_MEDIUM,
    afterData: d => hydrateGoalSeeds(d as GoalSeedValues | null) },
  // Q-392: the server bag seeds the `localStorage` keys every preference surface already reads, so
  // a fresh install picks up the settings this device chose. Warmed here beside goals because it is
  // the same shape of problem and the same one-directional rule — server wins, the device copy is a
  // seed. Nothing renders from the response; the seeding IS the effect.
  { key: 'user-preferences',        url: '/api/user/preferences',           ttl: TTL_MEDIUM,
    afterData: d => hydrateUserPreferences(d as UserPreferences | null) },
  { key: 'readiness-score',         url: '/api/readiness-score',            ttl: READINESS_SCORE_TTL, today: true },
  // Q-270: this route computes the day's OTS and persists it to oura_daily_derived as a side
  // effect, but nothing called it except the Health → Body card — so `training_load_ots` was 0 of
  // 89 days in production while every gate that could have blocked it passed. Warming it here is
  // what actually populates the column: once per launch, off the BLE ingest loop that Q-213 traced
  // an outage to. No `?date=` — the route resolves today from the SESSION timezone, which is more
  // correct than the client's. `today: true` matches the card's `cachedFetchToday` envelope.
  { key: 'training-stress',         url: '/api/training-stress',            ttl: TRAINING_STRESS_TTL, today: true },
  // Health tab
  { key: 'sleep-sessions',          url: '/api/sleep-sessions',             ttl: TTL_MEDIUM },
  { key: 'training-load',           url: '/api/training-load',              ttl: TTL_MEDIUM, today: true },
  { key: 'muscle-recovery',         url: '/api/muscle-recovery',            ttl: MUSCLE_RECOVERY_TTL },
  // Nutrition tab
  { key: 'nutrition-meal-types',    url: '/api/nutrition/meal-types',       ttl: TTL_LONG   },
  { key: 'nutrition-targets',       url: '/api/nutrition/targets',          ttl: TTL_LONG   },
  { key: 'nutrition-weekly-summary',url: '/api/nutrition/weekly-summary',   ttl: TTL_MEDIUM },
  // More tab (XP / level)
  { key: 'more-user-profile',       url: '/api/user/profile',               ttl: TTL_MEDIUM },
  { key: 'more-seasons',            url: '/api/seasons',                    ttl: TTL_MEDIUM },
];

async function warmCache(task: CacheTask, tz: string): Promise<void> {
  // Skip if still fresh, but ensure the sessionStorage mirror is populated for
  // this tab so readCacheSync(key) doesn't return null on a fresh session
  const cached = await getCached(task.key);
  if (cached !== null) {
    mirrorToSessionCache(task.key, cached);
    task.afterData?.(task.today ? (cached as { data?: unknown })?.data : cached);
    return;
  }

  try {
    const res = await fetch(task.url);
    if (!res.ok) return;
    const data = await res.json();
    await setCached(task.key, task.today ? { date: todayInTz(tz), data } : data, task.ttl);
    task.afterData?.(data);
  } catch {
    // Network unavailable — skip, will retry next mount
  }
}

interface SyncProviderProps {
  userId?: string;
}

export function SyncProvider({ userId }: SyncProviderProps) {
  const tz = useUserTimezone();
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await initSQLite(MIGRATIONS);
      } catch (err) {
        // K4: the local DB failed to open. getLocalStore now returns null (dead
        // store), so writes take the online API fallback instead of no-op'ing —
        // but that means degraded, online-only mode. Make it visible (banner) and
        // diagnosable (one telemetry row), the app's worst historical failure class.
        console.error('SyncProvider: initSQLite failed', err);
        markLocalStoreDead();
        reportClientError({
          message: `initSQLite failed: ${err instanceof Error ? err.message : String(err)}`,
          stack: err instanceof Error ? err.stack : undefined,
          url: 'sync-provider#initSQLite',
        });
        return;
      }
      if (cancelled) return;

      // Phase 1: Mirror already-fresh SQLite cache to sessionStorage so
      // readCacheSync() in useLayoutEffect has data before the first paint.
      if (!cancelled) {
        await Promise.all(CACHE_TASKS.map(async task => {
          const cached = await getCached(task.key);
          if (cached !== null) mirrorToSessionCache(task.key, cached);
        }));
      }
      if (cancelled) return;

      // Phase 2: Push pending local mutations then pull server changes.
      if (userId) {
        try { await pushMutations(userId); } catch { /* network unavailable */ }
        if (cancelled) return;
      }

      if (userId) {
        try {
          const delta = await pullDelta(userId);
          if (delta && delta.synced > 0) {
            if (delta.domains.biometrics)  await invalidateBiometrics();
            if (delta.domains.programs)    await invalidateProgramStructure();
            if (delta.domains.workouts)    await invalidateWorkoutSummaries();
            if (delta.domains.nutrition)   await invalidateNutritionWrite();
            if (delta.domains.supplements) await invalidateSupplements();
            if (delta.domains.activity)    await invalidateActivityWrites();
            if (delta.domains.running)     await invalidateRunningPlan();
            // B6: the delta sets a fitnessTests flag that no consumer acted on.
            if (delta.domains.fitnessTests) await invalidateFitnessTests();
            if (delta.domains.injuries)    await invalidateInjuryWrites();
            if (delta.domains.ouraDaily)   await invalidateOuraSync();
            if (delta.domains.mealPlans)   await invalidateMealPlans();
            // dayCheckins: no cache-groups entry — that UI reads the local store/API
            // directly, never through the sqlite-cache layer (see SyncedDomains).
          }
        } catch { /* network unavailable */ }
        if (cancelled) return;
      }

      // Phase 3: Refresh stale cache entries and fetch any that were missing.
      // Deferred a beat so the visible tab's own fetches win the network first
      // on cold start, then chunked (5 at a time, in CACHE_TASKS order —
      // home-screen keys first) so we never fire ~20 parallel requests.
      // Signed out every one of these 401s, so the whole phase is gated (Q-150).
      // Phase 1 above stays ungated on purpose: it only mirrors already-cached
      // rows to sessionStorage and never touches the network.
      if (!userId) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 2500));
      if (cancelled) return;
      const WARM_CHUNK = 5;
      for (let i = 0; i < CACHE_TASKS.length; i += WARM_CHUNK) {
        if (cancelled) break;
        await Promise.all(CACHE_TASKS.slice(i, i + WARM_CHUNK).map(t => warmCache(t, tz)));
      }
    })();

    return () => { cancelled = true; };
  }, [userId, tz]);

  // Drain the outbox again as soon as connectivity is restored (e.g. after a
  // GPS run through a dead zone), rather than waiting for the next mount.
  useEffect(() => {
    let handle: { remove: () => void } | undefined;

    import('@capacitor/network').then(({ Network }) => {
      Network.addListener('networkStatusChange', (status) => {
        if (status.connected) {
          if (userId) pushMutations(userId).catch(() => {});
          if (userId) pullDelta(userId).catch(() => {});
        }
      }).then((h) => { handle = h; });
    });

    return () => { handle?.remove(); };
  }, [userId]);

  // The throttled background Oura *Cloud* sync that used to live here was removed 2026-08-13
  // (owner: "get rid of oura cloud references we dont use it"). It fired on app open and native
  // resume, and could not succeed: the ring has been on our own BLE key since the 2026-07-07 re-key,
  // so the stored Cloud credential is dead. It already self-suppressed whenever BLE data was fresh
  // (`isBleDataFresh`), which meant the only times it actually reached out were the times the user
  // most needed the app responsive. Fresh biometrics come from the BLE ingest pipeline
  // (`/api/oura-ble/samples` → the rollup), not from here.

  // Reconcile meal reminder notifications on app open and on resume from background
  useEffect(() => {
    if (!userId) return;

    let handle: { remove: () => void } | undefined;

    async function reconcile() {
      // Scoped to its own early-return so the day-review reminders below still
      // run when meal reminders are disabled — they're unrelated preferences.
      if (localStorage.getItem('ta_pref_meal_reminders') !== 'false') {
        try {
          const today = todayInTz(tz);
          let mealTypes: unknown = null;
          let foodLogs: unknown = null;
          await Promise.all([
            cachedFetch('nutrition-meal-types', '/api/nutrition/meal-types', TTL_LONG, d => { mealTypes = d; }),
            cachedFetch(`nutrition-food-logs-${today}`, `/api/nutrition/food-logs?date=${today}`, NUTRITION_FOOD_LOGS_TTL, d => { foodLogs = d; }),
          ]);
          if (mealTypes != null && foodLogs != null) {
            const mealTypeList = Array.isArray(mealTypes) ? mealTypes : []
            const foodLogList = Array.isArray(foodLogs) ? foodLogs : []
            await reconcileMealReminders(mealTypeList, foodLogList)
            await scheduleEndOfDayReminder(mealTypeList, foodLogList)
          }
        } catch {
          // Network unavailable — skip, will retry on next open/resume
        }
      }

      if (localStorage.getItem('ta_pref_day_review_reminders') !== 'false') {
        await scheduleEveningReminder();
        await scheduleWeeklyRecapReminder();
      }
    }

    (async () => {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) return;
      reconcile();
      const { App } = await import('@capacitor/app');
      handle = await App.addListener('resume', reconcile);
    })();

    return () => { handle?.remove(); };
  }, [userId, tz]);

  // Reconcile workout reminder notification on app open and on resume
  useEffect(() => {
    if (!userId) return;

    let handle: { remove: () => void } | undefined;

    async function reconcile() {
      try {
        type NextSessionRec = { isRestDay?: boolean; session?: { name?: string }; reminderEnabled?: boolean; reminderTime?: string | null };
        const box: { rec: NextSessionRec | null } = { rec: null };
        await cachedFetchToday<NextSessionRec>('next-session', '/api/next-session', NEXT_SESSION_TTL, d => { box.rec = d; });
        if (!box.rec) return; // no cache and no network — skip, will retry on next open/resume
        await reconcileWorkoutReminder(
          !box.rec.isRestDay,
          box.rec.session?.name,
          box.rec.reminderEnabled ?? false,
          box.rec.reminderTime ?? null,
        );
      } catch {
        // Network unavailable — skip
      }
    }

    (async () => {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) return;
      reconcile();
      const { App } = await import('@capacitor/app');
      handle = await App.addListener('resume', reconcile);
    })();

    return () => { handle?.remove(); };
  }, [userId]);

  // Reconcile supplement reminder notifications on app open and on resume
  useEffect(() => {
    if (!userId) return;

    let handle: { remove: () => void } | undefined;

    async function reconcile() {
      try {
        let supplements: unknown = null;
        await cachedFetchToday('supplements', '/api/supplements', TTL_MEDIUM, d => { supplements = d; });
        await reconcileSupplementReminders(
          Array.isArray(supplements) ? supplements : [],
          new Date(),
        );
      } catch {
        // Network unavailable — skip
      }
    }

    (async () => {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) return;
      reconcile();
      const { App } = await import('@capacitor/app');
      handle = await App.addListener('resume', reconcile);
    })();

    return () => { handle?.remove(); };
  }, [userId]);

  // Fire on-device anomaly notifications (illness / high-stress / low-readiness) on app open + resume.
  // Reads the two today-envelope responses the app already warms and hands them to the pure
  // health-alert reconciler. Native-only + dedup-per-day live inside reconcileHealthAlerts; this effect
  // only gathers inputs. LocalNotifications no-ops in the web sandbox, so this whole path is APK-only.
  useEffect(() => {
    if (!userId) return;

    let handle: { remove: () => void } | undefined;

    async function reconcile() {
      if (localStorage.getItem('ta_pref_health_alerts') === 'false') return;
      try {
        const box: { readiness: ReadinessScoreResponse | null; battery: BodyBatteryResponse | null } = { readiness: null, battery: null };
        await Promise.all([
          cachedFetchToday<ReadinessScoreResponse>('readiness-score', '/api/readiness-score', READINESS_SCORE_TTL, d => { box.readiness = d; }).catch(() => {}),
          cachedFetchToday<BodyBatteryResponse>('body-battery', '/api/body-battery', BODY_BATTERY_TTL, d => { box.battery = d; }).catch(() => {}),
        ]);
        if (!box.readiness && !box.battery) return; // no cache, no network — retry next open/resume
        await reconcileHealthAlerts({
          illnessFlag: box.readiness?.illnessFlag ?? null,
          illnessAdvisory: box.readiness?.illnessAdvisory ?? null,
          readinessLabel: box.readiness?.label ?? null,
          readinessHasData: box.readiness?.hasSufficientData ?? false,
          stressHighMinutes: box.battery?.stress?.highMinutes ?? null,
          stressCurrent: box.battery?.stress?.current ?? null,
        });
      } catch {
        // Network unavailable — skip
      }
    }

    (async () => {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) return;
      reconcile();
      const { App } = await import('@capacitor/app');
      handle = await App.addListener('resume', reconcile);
    })();

    return () => { handle?.remove(); };
  }, [userId]);

  // Step counting radio owner — native-only, mounted once for the app's lifetime.
  // Exactly ONE of the two step paths starts (they share the realtime radio and the
  // orchestrator's stopAccel is a global realtime-off): continuous capture when its
  // toggle is on, else the gate-triggered orchestrator. The debug card handles runtime
  // toggle switches itself. getOuraBle() no-ops on web/old APKs, so this is safe; the
  // Capacitor gate below just avoids the dynamic import on web.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform() || cancelled) return;
      if (isContinuousCaptureEnabled()) await getContinuousCapture().start();
      else await getStepOrchestrator().start();
    })();
    return () => {
      cancelled = true;
      getContinuousCapture().stop();
      getStepOrchestrator().stop();
    };
  }, []);

  // Autonomous BLE drain → cache invalidation (native-only). The ring service auto-drains
  // on connect and hourly, POSTing new frames to /api/oura-ble/samples which rolls them up
  // into body_metrics/sleep_sessions server-side (steps, HR, SpO₂, etc). But only the
  // explicit syncOuraRing() path (pull-to-sync / Refresh) invalidated the client caches —
  // so data from an autonomous drain (e.g. the day's steps) sat in Postgres unseen until a
  // manual sync (or a redeploy that busts the SW cache). Watch the plugin's ingest counter:
  // when it advances, coalesce a burst of batch completions and fire the same invalidation
  // afterDrainSettles() does for manual drains, so screens refetch on their own.
  useEffect(() => {
    let cancelled = false;
    let handle: { remove: () => Promise<void> } | undefined;
    let lastIngestStored: number | null = null;
    let debounce: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      debounce = null;
      void invalidateOuraSync().catch(() => {});
      window.dispatchEvent(new Event('ta:oura-ble-synced'));
    };

    (async () => {
      const ble = await getOuraBle();
      if (!ble || cancelled) return;
      const h = await ble.plugin.addListener('ouraStatus', (status) => {
        const stored = status.ingestStored;
        if (typeof stored !== 'number') return;                 // older APK — no native ingest
        if (lastIngestStored === null) { lastIngestStored = stored; return; } // seed; don't fire on mount
        if (stored <= lastIngestStored) return;
        lastIngestStored = stored;
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(flush, 1500);                     // one invalidation per drain, not per batch
      });
      if (cancelled) { void h.remove(); return; }
      handle = h;
    })();

    return () => { cancelled = true; if (debounce) clearTimeout(debounce); void handle?.remove(); };
  }, []);

  return null;
}
