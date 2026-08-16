# Nutrition Food-Log Live-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fix U1 — logging a saved meal shows the kcal/macro total for ~1s then reverts to 0 until you navigate away and back — so the total updates instantly and stays correct.

**Architecture:** The direct scan/manual/library path (`lib/nutrition/log-food.ts`) is already optimistic-safe: it returns the written `FoodLogWithItem[]`, mirrors `food_items` into the local store, and the sheet forwards each log to `onLogged(log)` which appends to `logs` (no refetch). The **saved-meal** path (`lib/nutrition/log-meal.ts`) is the buggy sibling: it returns `void`, never mirrors `food_items` (so `getFoodLogsWithItems`' INNER JOIN drops the new rows on the offline read), and its three call sites fire `onLogged()` with **no argument**, which forces a `fetchData` → `loadFoodLogs` refetch that overwrites the optimistic `logs` with a stale/empty read (`pushMutations` is fire-and-forget, so the server still returns the pre-write list). This plan makes `logMealItems` mirror the reference path — mirror `food_items`, return optimistic logs — wires all three call sites to forward the logs, and adds a defensive guard so `loadFoodLogs` never blanks a populated list with an empty read.

**Tech Stack:** Next.js 15 / React 19 / TypeScript, offline-first local SQLite store (`lib/local-store/`) + mutation outbox, vitest (`pnpm test` → `vitest run`), Playwright/dev-server verification.

**Verified against current `main` (post-PR #213):** `invalidateNutritionWrite()` lives at `lib/cache-groups.ts:182-193` and is unchanged by #213 — reuse it, never a hand-rolled key list. All file:line references below were re-read against current `main`, not copied from the review doc.

**Scope note — the EOD path is already correct.** The review lists "end-of-day" as broken, but the end-of-day meal backfill (`components/nutrition/end-of-day/meal-backfill-section.tsx:47-48`) already calls `logFoodEntries` (the safe path) and forwards `onLogged(log)`. Do **not** touch it. The only broken paths are the three **saved-meal** (`logMealItems`) call sites.

**Coordination — overlaps queue item 1 (offline-sync integrity).** The `food_items`-mirror half (Task 1b) is offline-sync-integrity territory (`docs/superpowers/plans/2026-07-04-offline-sync-integrity.md`, backlog item 1). This plan's mirror is a **local-store-only** render fix (no server write-semantics change — saved-meal items reference food items that already exist server-side, so `pushMutations`/`adapter.ts` need no change). If item 1 lands first and adds a shared food-item hydration helper, reuse it instead of the inline `upsertFoodItem` loop below; otherwise this stands alone.

---

### Task 1: `logMealItems` returns optimistic logs and mirrors `food_items`

**Files:**
- Modify: `lib/nutrition/log-meal.ts:7-62` (whole file — change return type, add `food_items` mirror + optimistic-log build)
- Test: `lib/nutrition/__tests__/log-meal.test.ts` (new)
- Reference (do not modify): `lib/nutrition/log-food.ts:112-206` (`toWithItem` + optimistic local branch)

- [ ] **Step 1: Write the failing test** for the new pure helper `savedMealItemToWithItem`.

```ts
// lib/nutrition/__tests__/log-meal.test.ts
import { describe, it, expect } from 'vitest'
import { savedMealItemToWithItem } from '../log-meal'
import type { SavedMealItem } from '@/lib/types/nutrition'

const baseItem = (overrides: Partial<SavedMealItem> = {}): SavedMealItem => ({
  id: 'smi1', savedMealId: 'sm1', foodItemId: 'fi1', quantityMultiplier: 2,
  foodItem: {
    id: 'fi1', userId: 'u1', name: 'Rice Thins', brand: 'Brand',
    servingSizeG: 100, calories: 120, proteinG: 3, carbsG: 25, fatG: 1,
    fiberG: 2, sugarG: 1, sodiumMg: 50, satFatG: 0.2,
    source: 'manual', region: '', createdAt: new Date(),
  },
  ...overrides,
})

describe('savedMealItemToWithItem', () => {
  it('scales macros by the item quantity and embeds the food item for offline render', () => {
    const log = { id: 'log1', date: '2026-07-04', mealTypeId: 'mt1', loggedAt: '2026-07-04T08:00:00.000Z' }
    const wi = savedMealItemToWithItem(baseItem(), log)
    expect(wi).toMatchObject({
      id: 'log1', date: '2026-07-04', mealTypeId: 'mt1', foodItemId: 'fi1',
      quantityMultiplier: 2, calories: 240, proteinG: 6, carbsG: 50, fatG: 2,
    })
    expect(wi.foodItem.name).toBe('Rice Thins')
    expect(wi.loggedAt).toBeInstanceOf(Date)
  })

  it('rounds protein/carbs/fat to one decimal', () => {
    const item = baseItem({
      quantityMultiplier: 1.5,
      foodItem: { ...baseItem().foodItem, proteinG: 3.33, carbsG: 0, fatG: 0 },
    })
    const wi = savedMealItemToWithItem(item, { id: 'l', date: '2026-07-04', mealTypeId: 'm', loggedAt: '2026-07-04T08:00:00.000Z' })
    expect(wi.proteinG).toBe(5) // 3.33 * 1.5 = 4.995 -> r1 -> 5
  })
})
```

- [ ] **Step 2: Run it, verify FAIL** — Run: `pnpm test log-meal`
  Expected: fails with `savedMealItemToWithItem is not a function` / no matching export.

- [ ] **Step 3: Implement** — replace the entire contents of `lib/nutrition/log-meal.ts` with:

```ts
import type { FoodLogWithItem, SavedMeal, SavedMealItem } from '@/lib/types/nutrition'
import { cancelMealReminder } from '@/lib/meal-reminders'
import { getLocalStore } from '@/lib/local-store'
import { pushMutations } from '@/lib/local-store/sync-engine'
import { invalidateNutritionWrite } from '@/lib/cache-groups'

function r1(n: number) { return Math.round(n * 10) / 10 }

/**
 * Build an optimistic FoodLogWithItem for one saved-meal component so the UI can
 * append it immediately (mirrors log-food.ts's toWithItem). The item's macros are
 * scaled by its per-item quantity multiplier.
 */
export function savedMealItemToWithItem(
  item: SavedMealItem,
  log: { id: string; date: string; mealTypeId: string; loggedAt: string },
): FoodLogWithItem {
  const q = item.quantityMultiplier
  const fi = item.foodItem
  return {
    id: log.id,
    userId: fi.userId,
    date: log.date,
    mealTypeId: log.mealTypeId,
    foodItemId: item.foodItemId,
    quantityMultiplier: q,
    loggedAt: new Date(log.loggedAt),
    foodItem: fi,
    calories: Math.round(fi.calories * q),
    proteinG: r1(fi.proteinG * q),
    carbsG: r1(fi.carbsG * q),
    fatG: r1(fi.fatG * q),
  }
}

/**
 * Log every component of a saved meal as its own food log. Uses the offline-first
 * local store when available and falls back to the API otherwise. Returns the
 * optimistic log entries for immediate UI updates (mirrors logFoodEntries) so the
 * caller can append them without a refetch that would blank the optimistic state.
 */
export async function logMealItems(
  meal: SavedMeal,
  date: string,
  mealTypeId: string,
  userId?: string,
): Promise<FoodLogWithItem[]> {
  const store = userId ? getLocalStore(userId) : null
  const now = new Date().toISOString()
  const optimistic: FoodLogWithItem[] = []

  if (store) {
    try {
      for (const item of meal.items) {
        const fi = item.foodItem
        // Mirror the item locally so getFoodLogsWithItems' INNER JOIN keeps this
        // row on the offline render path (log-food.ts does the same on create).
        // The item already exists server-side (saved meals reference real food
        // items), so this is a local-render mirror only — no outbox mutation.
        await store.upsertFoodItem({
          id: item.foodItemId, name: fi.name, brand: fi.brand ?? null,
          servingSizeG: fi.servingSizeG, calories: fi.calories,
          proteinG: fi.proteinG, carbsG: fi.carbsG, fatG: fi.fatG,
          fiberG: fi.fiberG ?? null, sugarG: fi.sugarG ?? null,
          sodiumMg: fi.sodiumMg ?? null, satFatG: fi.satFatG ?? null,
          source: fi.source, updatedAt: now,
        })
        const logId = crypto.randomUUID()
        await store.upsertFoodLog({
          id: logId, date, mealTypeId, foodItemId: item.foodItemId,
          quantityMultiplier: item.quantityMultiplier,
          loggedAt: now, updatedAt: now, deletedAt: null, syncStatus: 'pending',
        })
        await store.queueMutation({
          userId: userId!,
          domain: 'food_logs',
          date,
          payload: { id: logId, mealTypeId, foodItemId: item.foodItemId, quantityMultiplier: item.quantityMultiplier, loggedAt: now },
        })
        optimistic.push(savedMealItemToWithItem(item, { id: logId, date, mealTypeId, loggedAt: now }))
      }
      await cancelMealReminder(mealTypeId)
      await invalidateNutritionWrite()
      pushMutations(userId!).catch(() => {})
      return optimistic
    } catch (sqliteErr) {
      console.error('Food log SQLite write failed, falling back to API:', sqliteErr)
    }
  }

  // Web fallback: serial fetches with rollback on failure
  const createdIds: string[] = []
  try {
    for (const item of meal.items) {
      const res = await fetch('/api/nutrition/food-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, mealTypeId, foodItemId: item.foodItemId, quantityMultiplier: item.quantityMultiplier }),
      })
      if (!res.ok) throw new Error('Failed to log item')
      const log = await res.json()
      createdIds.push(log.id)
      optimistic.push(savedMealItemToWithItem(item, {
        id: log.id, date, mealTypeId, loggedAt: log.loggedAt ?? now,
      }))
    }
    await cancelMealReminder(mealTypeId)
    await invalidateNutritionWrite()
    return optimistic
  } catch (err) {
    await Promise.all(createdIds.map(id =>
      fetch(`/api/nutrition/food-logs/${id}`, { method: 'DELETE' }).catch(() => {})
    ))
    throw err
  }
}
```

- [ ] **Step 4: Run test, verify PASS** — Run: `pnpm test log-meal` Expected: both cases pass.

- [ ] **Step 5: Commit** — `git add lib/nutrition/log-meal.ts lib/nutrition/__tests__/log-meal.test.ts && git commit -m "logMealItems returns optimistic logs and mirrors food_items locally"`

---

### Task 2: Forward the optimistic logs from all three saved-meal call sites

The three no-arg `onLogged()` sites (all saved-meal): `components/nutrition/food-logger-sheet.tsx:155` (`quickLogSavedMeal`, the Saved-Meals tab), `components/nutrition/food-logger-sheet.tsx:362` (nested `SavedMealsSheet`), and `app/nutrition/nutrition-content.tsx:494` (top-level `SavedMealsSheet`). `SavedMealsSheet.quickLog` also fires no-arg `onLogged()`.

This change is UI wiring only (no unit-testable surface) — verified via the dev server.

**Files:**
- Modify: `components/nutrition/food-logger-sheet.tsx:144-162` (`quickLogSavedMeal`) and `:359-363` (nested `SavedMealsSheet`)
- Modify: `components/nutrition/saved-meals-sheet.tsx:9`, `:21-26` (props), `:176-192` (`quickLog`)
- Modify: `app/nutrition/nutrition-content.tsx:491-496` (top-level `SavedMealsSheet` `onLogged`)

- [ ] **Step 1: `food-logger-sheet.tsx` — forward logs from `quickLogSavedMeal`.** Replace the body of the `try` at `:150-155`:

```ts
    try {
      const logs = await logMealItems(meal, today, mealTypeId, userId)
      toast.success(`${meal.name} logged`)
      reset()
      onClose()
      for (const log of logs) onLogged(log)
    } catch (err) {
```

- [ ] **Step 2: `food-logger-sheet.tsx` — forward the log through the nested `SavedMealsSheet`.** Replace `:359-363`:

```tsx
      <SavedMealsSheet
        open={showSavedMeals}
        onOpenChange={v => { if (!v) setShowSavedMeals(false) }}
        onLogged={(log) => { reset(); onClose(); onLogged(log) }}
      />
```

- [ ] **Step 3: `saved-meals-sheet.tsx` — widen the `onLogged` contract and forward logs.**
  Add the type import at `:9`:

```ts
import type { FoodItem, SavedMeal, MealType, FoodLogWithItem } from '@/lib/types/nutrition'
```

  Change the prop signature at `:24` (inside `interface Props`):

```ts
  onLogged: (log?: FoodLogWithItem) => void
```

  Replace the `try` body in `quickLog` at `:182-185`:

```ts
    try {
      const logs = await logMealItems(meal, today, mealTypeId, userId)
      toast.success(`${meal.name} logged`)
      for (const log of logs) onLogged(log)
    } catch (err) {
```

- [ ] **Step 4: `nutrition-content.tsx` — pass the log-appending handler to the top-level `SavedMealsSheet`.** Replace `:491-496`:

```tsx
      <SavedMealsSheet
        open={savedMealsOpen}
        onOpenChange={setSavedMealsOpen}
        onLogged={handleFoodLogged}
        userId={userId}
      />
```

  (`handleFoodLogged` at `:232-238` already appends when a log is passed and only refetches on the no-arg legacy path.)

- [ ] **Step 5: Verify types + lint** — Run: `pnpm tsc --noEmit && pnpm lint`
  Expected: clean. (The widened `onLogged` signature is satisfied by every call site above.)

- [ ] **Step 6: Dev-server verification** — Run: `pnpm dev`, drive the flow with Playwright at a **412x915** viewport against the local dev DB.
  1. Sign in (`test@local.dev` / `testpass123`) and open `/nutrition`.
  2. If no saved meal exists: open **Saved Meals** → **New Meal**, add one ingredient (or "+ Add as new food"), name it, **Save Meal**.
  3. Note the current calorie total on the `MacroRing`.
  4. Tap **Log** on the saved meal.
  5. **Expected (pass):** the ring total increases immediately and **stays** increased (watch for ≥3s — it must not revert to 0 or to the pre-log value). Broken outcome: total flashes then reverts.
  6. Repeat via the EOD review ("End of Day review" → backfill a meal) to confirm no regression on the already-safe path.
  ⚠️ On web, `getLocalStore` returns null so the **web-fallback** branch runs (this verifies the optimistic-append + guard halves). The local-store `food_items`-mirror half (Task 1b `upsertFoodItem`) is **APK-only** and cannot be exercised in the sandbox.

- [ ] **Step 7: Commit** — `git add components/nutrition/food-logger-sheet.tsx components/nutrition/saved-meals-sheet.tsx app/nutrition/nutrition-content.tsx && git commit -m "Forward optimistic saved-meal logs to onLogged instead of triggering a refetch"`

---

### Task 3: `loadFoodLogs` never blanks a populated list with an empty read (defensive)

Belt-and-suspenders for CLAUDE.md's "after an optimistic local write, never apply or cache a server response that would replace it with null/absent data". The authoritative reads in `loadFoodLogs` (`app/nutrition/nutrition-content.tsx:128-182`) call `setLogs` unconditionally; if a read comes back empty (fire-and-forget push not yet landed, or the INNER JOIN dropped un-mirrored rows) it wipes an optimistic list. Guard each `setLogs` so an **empty** read is discarded when the current list is non-empty. (Guard on empty, not on "fewer" — a length-based guard would re-add a not-yet-synced deleted row; deletes shrink `logs` optimistically first at `:284`, so they still settle correctly.)

This change is UI-only — verified via the dev server (the guard's correctness is observed in Task 2's flow; this task hardens the refetch-settling window).

**Files:**
- Modify: `app/nutrition/nutrition-content.tsx:128-182` (`loadFoodLogs` — the three `setLogs` read sites at `:133`, `:176`, `:180`)

- [ ] **Step 1: Guard the web-only read** (`:131-134`):

```ts
    if (!store) {
      await cachedFetch<FoodLogWithItem[]>(
        `nutrition-food-logs-${today}`, `/api/nutrition/food-logs?date=${today}`, 60,
        d => setLogs(prev => {
          const next = Array.isArray(d) ? d : [];
          return next.length === 0 && prev.length > 0 ? prev : next;
        }),
      );
      return;
    }
```

- [ ] **Step 2: Guard the post-hydration local read** (`:176`):

```ts
      const merged = await store.getFoodLogsWithItems(today);
      setLogs(prev => merged.length === 0 && prev.length > 0 ? prev : merged);
```

- [ ] **Step 3: Guard the server-copy fallback** (`:180`):

```ts
      setLogs(prev => server.length === 0 && prev.length > 0 ? prev : server);
```

  (`server` is narrowed to `FoodLogWithItem[]` here by the earlier `if (!server) return;` at `:156`.) Leave the instant-local render at `:139` as-is — its `if (local.length) setLogs(local)` is already an empty-guard.

- [ ] **Step 4: Verify types + lint** — Run: `pnpm tsc --noEmit && pnpm lint` Expected: clean.

- [ ] **Step 5: Dev-server verification** — Run: `pnpm dev`, Playwright at **412x915**.
  1. Repeat Task 2 Step 6 (log a saved meal) and additionally navigate the date chevrons back one day and forward to Today, confirming the just-logged total is still present on Today (the guard must not have blanked it during the settle).
  2. Delete a logged item (trash icon → confirm) and confirm the total decreases and does **not** re-appear after the refetch settles (guard must not resurrect a deleted row).

- [ ] **Step 6: Commit** — `git add app/nutrition/nutrition-content.tsx && git commit -m "Guard loadFoodLogs so an empty read never blanks the optimistic food list"`

---

### Task 4: Manual / device verification (acceptance criteria)

⚠️ **APK-only surfaces cannot be verified in the sandbox** — native SQLite (`getLocalStore`) returns null on web, so the local-store `food_items` mirror (Task 1b) and the local-first offline read/append only run on-device. Run `docs/device-smoke-checklist.md` on the Samsung S25 Ultra.

- [ ] **AC1 (backlog item 8 / review U1):** Log a saved meal — totals update **instantly** and **stay** correct through the refetch settling, on **web** (dev server, web-fallback path) **and APK** (native local-store path). Confirm the ~1s-then-revert-to-0 symptom is gone.
- [ ] **AC2:** EOD-review meal logging behaves the same (already-safe path — confirm no regression).
- [ ] **AC3 (APK):** Log a saved meal **offline** (airplane mode) → the total appears and survives navigating away/back and an app relaunch; it syncs when back online (outbox push). This exercises the `food_items` local mirror — the row must render offline (INNER JOIN keeps it), not vanish.
- [ ] **AC4 (APK):** Delete a synced saved-meal log → it does not resurrect after the pull-delta settles.
- [ ] **State which surfaces were NOT exercised** when presenting: native SQLite/local-store append + `food_items` mirror, offline outbox round-trip, and Samsung WebView — all APK-only. The dev server only covers the web-fallback optimistic-append + the empty-read guard.
