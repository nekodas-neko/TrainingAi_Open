import { useCallback, type Dispatch, type SetStateAction, type MutableRefObject } from 'react'
import type { FoodLogWithItem } from '@trainingai/shared/types/nutrition'
import { cachedFetch } from '@/lib/sqlite/cache'
import { NUTRITION_FOOD_LOGS_TTL } from '@trainingai/shared/cache-ttl'
import { getLocalStore } from '@/lib/local-store'
import { decideLogsApplication } from './food-log-application'

/**
 * Load one day's food logs, local-first, and hydrate the local store from the server copy.
 *
 * Moved out of `nutrition-content.tsx` unchanged (Q-406), which sat at **exactly the 800-line
 * ceiling** and so could not take a single line of the Q-395 rework. Sixty-nine lines of it were
 * this one function, and it is the file's most self-contained piece: four inputs, no JSX, no other
 * state.
 *
 * **Every comment below is load-bearing and was moved with the code.** This is the path behind the
 * "logged food vanished on reload" reports — the ordering of local render, server fetch and
 * hydrate, and the rule that a local-store failure must never blank the list, are the fixes for
 * those. Do not reorder them to make the function read more neatly.
 */
export function useFoodLogsLoader({ userId, logsDateRef, selectedDateRef, setLogs }: {
  userId: string | undefined
  /** Which date `logs` currently holds, so a late response for another day can be dropped. */
  logsDateRef: MutableRefObject<string | null>
  selectedDateRef: MutableRefObject<string>
  setLogs: Dispatch<SetStateAction<FoodLogWithItem[]>>
}) {
  return useCallback(async (today: string) => {
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
  }, [userId, logsDateRef, selectedDateRef, setLogs]);
}
