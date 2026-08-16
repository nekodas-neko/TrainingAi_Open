> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Meal Reminder Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a meal type's time window ends with nothing logged for it today, fire a local notification reminding the user — with per-meal-type and global opt-out, native (APK) only.

**Architecture:** A new `lib/meal-reminders.ts` module mirrors the existing `lib/notifications.ts` pattern (no-op on web, `@capacitor/local-notifications` on native). A pure `computeMealReminderActions()` function decides cancel/immediate/scheduled per meal type given meal types + today's food logs + current time; `reconcileMealReminders()` wraps it with the actual Capacitor calls. Reconcile runs from `SyncProvider` on app mount and on `resume`. Logging a meal calls `cancelMealReminder()` immediately. A new `meal_types.reminders_enabled` column drives per-meal-type opt-out; a `ta_pref_meal_reminders` localStorage flag drives the global toggle.

**Tech Stack:** `@capacitor/local-notifications` (already installed), `@capacitor/app` (already installed), Drizzle ORM migration, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-13-meal-reminder-notifications-design.md`

---

### Task 1: Database migration, schema, and types for `remindersEnabled`

**Files:**
- Create: `lib/data/postgres/migrations/063_meal_type_reminders_enabled.sql`
- Modify: `lib/data/postgres/schema.ts:269-278`
- Modify: `lib/types/nutrition.ts:1-10`
- Modify: `lib/data/postgres/adapter.ts:1981-1987`
- Modify: `app/api/nutrition/meal-types/route.ts:29-44`

- [ ] **Step 1: Create the migration file**

```sql
-- lib/data/postgres/migrations/063_meal_type_reminders_enabled.sql
ALTER TABLE meal_types ADD COLUMN IF NOT EXISTS reminders_enabled BOOLEAN NOT NULL DEFAULT true;
```

- [ ] **Step 2: Add the column to the Drizzle schema**

In `lib/data/postgres/schema.ts`, the `mealTypes` table is:

```ts
export const mealTypes = pgTable('meal_types', {
  id:            uuid('id').primaryKey().defaultRandom(),
  userId:        uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:          text('name').notNull(),
  emoji:         text('emoji').notNull().default('🍽️'),
  sortOrder:     integer('sort_order').notNull().default(0),
  timeStartHour: integer('time_start_hour').notNull().default(0),
  timeEndHour:   integer('time_end_hour').notNull().default(24),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
```

Add `remindersEnabled` after `timeEndHour`:

```ts
export const mealTypes = pgTable('meal_types', {
  id:            uuid('id').primaryKey().defaultRandom(),
  userId:        uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:          text('name').notNull(),
  emoji:         text('emoji').notNull().default('🍽️'),
  sortOrder:     integer('sort_order').notNull().default(0),
  timeStartHour: integer('time_start_hour').notNull().default(0),
  timeEndHour:   integer('time_end_hour').notNull().default(24),
  remindersEnabled: boolean('reminders_enabled').notNull().default(true),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
```

(`boolean` is already imported in this file — it's used by `isActive`, `isAdmin`, etc.)

- [ ] **Step 3: Add `remindersEnabled` to the `MealType` type**

In `lib/types/nutrition.ts`, the `MealType` interface is:

```ts
export interface MealType {
  id: string
  userId: string
  name: string
  emoji: string
  sortOrder: number
  timeStartHour: number
  timeEndHour: number
  createdAt: Date
}
```

Add the new field:

```ts
export interface MealType {
  id: string
  userId: string
  name: string
  emoji: string
  sortOrder: number
  timeStartHour: number
  timeEndHour: number
  remindersEnabled: boolean
  createdAt: Date
}
```

- [ ] **Step 4: Map the new column in `rowToMealType`**

In `lib/data/postgres/adapter.ts`, `rowToMealType` is:

```ts
  private rowToMealType(r: typeof s.mealTypes.$inferSelect): MealType {
    return {
      id: r.id, userId: r.userId, name: r.name, emoji: r.emoji,
      sortOrder: r.sortOrder, timeStartHour: r.timeStartHour,
      timeEndHour: r.timeEndHour, createdAt: r.createdAt,
    }
  }
```

Add `remindersEnabled`:

```ts
  private rowToMealType(r: typeof s.mealTypes.$inferSelect): MealType {
    return {
      id: r.id, userId: r.userId, name: r.name, emoji: r.emoji,
      sortOrder: r.sortOrder, timeStartHour: r.timeStartHour,
      timeEndHour: r.timeEndHour, remindersEnabled: r.remindersEnabled,
      createdAt: r.createdAt,
    }
  }
```

`createMealType`/`updateMealType` already take `Omit<MealType, 'id'|'userId'|'createdAt'>` / `Partial<...>` and pass straight through to Drizzle, so they pick up the new field automatically — no change needed there.

- [ ] **Step 5: Accept `remindersEnabled` in the meal-type creation API**

In `app/api/nutrition/meal-types/route.ts`, the `POST` handler is:

```ts
export async function POST(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()
  const { name, emoji, sortOrder, timeStartHour, timeEndHour } = body
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })
  const repo = await getRepository()
  const mealType = await repo.createMealType(userId, {
    name, emoji: emoji ?? '🍽️',
    sortOrder: sortOrder ?? 0,
    timeStartHour: timeStartHour ?? 0,
    timeEndHour: timeEndHour ?? 24,
  })
  return NextResponse.json(mealType, { status: 201 })
}
```

Update to:

```ts
export async function POST(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()
  const { name, emoji, sortOrder, timeStartHour, timeEndHour, remindersEnabled } = body
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })
  const repo = await getRepository()
  const mealType = await repo.createMealType(userId, {
    name, emoji: emoji ?? '🍽️',
    sortOrder: sortOrder ?? 0,
    timeStartHour: timeStartHour ?? 0,
    timeEndHour: timeEndHour ?? 24,
    remindersEnabled: remindersEnabled ?? true,
  })
  return NextResponse.json(mealType, { status: 201 })
}
```

(`PUT /api/nutrition/meal-types/[id]` already forwards the raw request body to `updateMealType`, so it accepts `remindersEnabled` with no code change.)

- [ ] **Step 6: Apply the migration locally and verify**

```bash
pnpm db:local
```

Expected: `[local-db] Applying migrations...` then `[local-db] Ready.` with no errors (it's idempotent — only the new `063_...sql` migration applies).

Verify the column exists:

```bash
PGPASSWORD=postgres psql -h /tmp -p 5433 -U postgres -d trainingai_dev -c "SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name='meal_types' AND column_name='reminders_enabled';"
```

Expected: one row showing `reminders_enabled | boolean | true`.

- [ ] **Step 7: Run typecheck and existing tests**

```bash
pnpm exec tsc --noEmit
pnpm test
```

Expected: both pass with no new errors.

- [ ] **Step 8: Commit**

```bash
git add lib/data/postgres/migrations/063_meal_type_reminders_enabled.sql lib/data/postgres/schema.ts lib/types/nutrition.ts lib/data/postgres/adapter.ts app/api/nutrition/meal-types/route.ts
git commit -m "Add reminders_enabled column to meal_types"
```

---

### Task 2: Core `lib/meal-reminders.ts` module + unit tests

**Files:**
- Create: `lib/__tests__/meal-reminders.test.ts`
- Create: `lib/meal-reminders.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/__tests__/meal-reminders.test.ts
import { describe, it, expect } from 'vitest'
import { computeMealReminderActions, mealReminderNotificationId } from '../meal-reminders'
import type { MealType, FoodLog } from '../types/nutrition'

function makeMealType(overrides: Partial<MealType> = {}): MealType {
  return {
    id: 'mt-1',
    userId: 'user-1',
    name: 'Breakfast',
    emoji: '🍳',
    sortOrder: 0,
    timeStartHour: 6,
    timeEndHour: 10,
    remindersEnabled: true,
    createdAt: new Date(),
    ...overrides,
  }
}

function makeFoodLog(mealTypeId: string): Pick<FoodLog, 'mealTypeId'> {
  return { mealTypeId }
}

describe('computeMealReminderActions', () => {
  it('cancels the reminder when the meal has already been logged today', () => {
    const mt = makeMealType({ id: 'mt-1', timeEndHour: 10 })
    const now = new Date(2026, 5, 13, 14, 0)
    const actions = computeMealReminderActions([mt], [makeFoodLog('mt-1')], now)
    expect(actions).toEqual([{ mealTypeId: 'mt-1', type: 'cancel' }])
  })

  it('cancels the reminder for a meal type with reminders disabled, even if not logged', () => {
    const mt = makeMealType({ id: 'mt-1', remindersEnabled: false })
    const now = new Date(2026, 5, 13, 14, 0)
    const actions = computeMealReminderActions([mt], [], now)
    expect(actions).toEqual([{ mealTypeId: 'mt-1', type: 'cancel' }])
  })

  it('fires an immediate catch-up notification when the window has already passed and nothing was logged', () => {
    const mt = makeMealType({ id: 'mt-1', timeEndHour: 10, emoji: '🍳', name: 'Breakfast' })
    const now = new Date(2026, 5, 13, 14, 0) // window ended at 10am
    const actions = computeMealReminderActions([mt], [], now)
    expect(actions).toEqual([{ mealTypeId: 'mt-1', type: 'immediate', emoji: '🍳', name: 'Breakfast' }])
  })

  it('schedules a one-shot for the window end time when the window is still ahead', () => {
    const mt = makeMealType({ id: 'mt-1', timeEndHour: 15, emoji: '🥗', name: 'Lunch' })
    const now = new Date(2026, 5, 13, 9, 0) // lunch window ends at 3pm
    const actions = computeMealReminderActions([mt], [], now)
    const expectedAt = new Date(2026, 5, 13, 15, 0, 0, 0)
    expect(actions).toEqual([{ mealTypeId: 'mt-1', type: 'scheduled', at: expectedAt, emoji: '🥗', name: 'Lunch' }])
  })

  it('clamps timeEndHour 24 to 23:59 same day', () => {
    const mt = makeMealType({ id: 'mt-1', timeEndHour: 24, emoji: '🌙', name: 'Evening Snack' })
    const now = new Date(2026, 5, 13, 9, 0)
    const actions = computeMealReminderActions([mt], [], now)
    const expectedAt = new Date(2026, 5, 13, 23, 59, 0, 0)
    expect(actions).toEqual([{ mealTypeId: 'mt-1', type: 'scheduled', at: expectedAt, emoji: '🌙', name: 'Evening Snack' }])
  })

  it('handles multiple meal types independently', () => {
    const breakfast = makeMealType({ id: 'mt-1', name: 'Breakfast', emoji: '🍳', timeEndHour: 10 })
    const lunch = makeMealType({ id: 'mt-2', name: 'Lunch', emoji: '🥗', timeStartHour: 12, timeEndHour: 15 })
    const now = new Date(2026, 5, 13, 14, 0) // breakfast window passed, lunch window ahead
    const actions = computeMealReminderActions([breakfast, lunch], [], now)
    expect(actions).toEqual([
      { mealTypeId: 'mt-1', type: 'immediate', emoji: '🍳', name: 'Breakfast' },
      { mealTypeId: 'mt-2', type: 'scheduled', at: new Date(2026, 5, 13, 15, 0, 0, 0), emoji: '🥗', name: 'Lunch' },
    ])
  })
})

describe('mealReminderNotificationId', () => {
  it('is deterministic for the same meal type id', () => {
    const id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    expect(mealReminderNotificationId(id)).toBe(mealReminderNotificationId(id))
  })

  it('returns an id within the reserved 9200-9999 range', () => {
    const id = mealReminderNotificationId('a1b2c3d4-e5f6-7890-abcd-ef1234567890')
    expect(id).toBeGreaterThanOrEqual(9200)
    expect(id).toBeLessThan(10000)
  })

  it('differs for different meal type ids', () => {
    const a = mealReminderNotificationId('11111111-1111-1111-1111-111111111111')
    const b = mealReminderNotificationId('22222222-2222-2222-2222-222222222222')
    expect(a).not.toBe(b)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm test lib/__tests__/meal-reminders.test.ts
```

Expected: FAIL — `Cannot find module '../meal-reminders'`.

- [ ] **Step 3: Implement `lib/meal-reminders.ts`**

```ts
// lib/meal-reminders.ts
import { Capacitor } from '@capacitor/core'
import type { MealType, FoodLog } from '@/lib/types/nutrition'

export const MEAL_REMINDERS_CHANNEL = 'meal-reminders'

const ID_BASE = 9200
const ID_RANGE = 800

// Deterministic int32 id derived from the meal type's uuid, so repeated
// schedule/cancel calls for the same meal type are idempotent.
export function mealReminderNotificationId(mealTypeId: string): number {
  let hash = 0
  for (let i = 0; i < mealTypeId.length; i++) {
    hash = (hash * 31 + mealTypeId.charCodeAt(i)) | 0
  }
  return ID_BASE + (Math.abs(hash) % ID_RANGE)
}

export type MealReminderAction =
  | { mealTypeId: string; type: 'cancel' }
  | { mealTypeId: string; type: 'immediate'; emoji: string; name: string }
  | { mealTypeId: string; type: 'scheduled'; at: Date; emoji: string; name: string }

// Pure decision logic: given today's meal types and food logs, decide which
// meal types need a reminder cancelled, fired immediately (catch-up for a
// window that already passed), or scheduled for their window's end time.
export function computeMealReminderActions(
  mealTypes: MealType[],
  foodLogs: Pick<FoodLog, 'mealTypeId'>[],
  now: Date = new Date(),
): MealReminderAction[] {
  const loggedIds = new Set(foodLogs.map(l => l.mealTypeId))

  return mealTypes.map((mt): MealReminderAction => {
    if (!mt.remindersEnabled || loggedIds.has(mt.id)) {
      return { mealTypeId: mt.id, type: 'cancel' }
    }

    const endHour = mt.timeEndHour >= 24 ? 23 : mt.timeEndHour
    const endMinute = mt.timeEndHour >= 24 ? 59 : 0
    const endTime = new Date(now)
    endTime.setHours(endHour, endMinute, 0, 0)

    if (now >= endTime) {
      return { mealTypeId: mt.id, type: 'immediate', emoji: mt.emoji, name: mt.name }
    }
    return { mealTypeId: mt.id, type: 'scheduled', at: endTime, emoji: mt.emoji, name: mt.name }
  })
}

function reminderBody(emoji: string, name: string): string {
  return `Don't forget to log ${emoji} ${name}!`
}

// Reconciles all meal reminders: cancels reminders for logged/disabled meal
// types, fires an immediate catch-up for missed windows, and schedules a
// one-shot for windows still ahead today. No-op on web.
export async function reconcileMealReminders(
  mealTypes: MealType[],
  foodLogs: Pick<FoodLog, 'mealTypeId'>[],
  now: Date = new Date(),
): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const actions = computeMealReminderActions(mealTypes, foodLogs, now)

    for (const action of actions) {
      const id = mealReminderNotificationId(action.mealTypeId)
      if (action.type === 'cancel') {
        await LocalNotifications.cancel({ notifications: [{ id }] })
        continue
      }
      const at = action.type === 'immediate' ? new Date(Date.now() + 2000) : action.at
      await LocalNotifications.schedule({
        notifications: [{
          id,
          title: 'Meal reminder',
          body: reminderBody(action.emoji, action.name),
          schedule: { at },
          channelId: MEAL_REMINDERS_CHANNEL,
        }],
      })
    }
  } catch {}
}

// Cancels a single meal type's pending reminder — called right after a
// successful food log so the user isn't reminded about something they just logged.
export async function cancelMealReminder(mealTypeId: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await LocalNotifications.cancel({ notifications: [{ id: mealReminderNotificationId(mealTypeId) }] })
  } catch {}
}

// Cancels all meal reminders — called when the global toggle is turned off.
export async function cancelAllMealReminders(mealTypeIds: string[]): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await LocalNotifications.cancel({
      notifications: mealTypeIds.map(id => ({ id: mealReminderNotificationId(id) })),
    })
  } catch {}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm test lib/__tests__/meal-reminders.test.ts
```

Expected: PASS — all 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/meal-reminders.ts lib/__tests__/meal-reminders.test.ts
git commit -m "Add meal reminder scheduling logic with unit tests"
```

---

### Task 3: Capacitor channel + sync-provider reconcile-on-open/resume

**Files:**
- Modify: `components/capacitor-native-init.tsx`
- Modify: `components/sync-provider.tsx`

- [ ] **Step 1: Register the `meal-reminders` notification channel**

In `components/capacitor-native-init.tsx`, the current file is:

```tsx
'use client';

import { useEffect } from 'react';
import { WORKOUT_TIMERS_CHANNEL } from '@/lib/notifications';

export function CapacitorNativeInit() {
  useEffect(() => {
    (async () => {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) return;

      try {
        const { StatusBar, Style } = await import('@capacitor/status-bar');
        await StatusBar.setStyle({ style: Style.Dark });
      } catch {
        // Edge-to-edge enforced on Android 15+ — style may be a no-op, safe to ignore
      }

      try {
        const { LocalNotifications } = await import('@capacitor/local-notifications');
        await LocalNotifications.createChannel({
          id: WORKOUT_TIMERS_CHANNEL,
          name: 'Workout timers',
          description: 'Rest timer alerts during a workout',
          importance: 4,
          visibility: 1,
          vibration: true,
        });
        await LocalNotifications.requestPermissions();
      } catch {}
    })();
  }, []);

  return null;
}
```

Replace it with:

```tsx
'use client';

import { useEffect } from 'react';
import { WORKOUT_TIMERS_CHANNEL } from '@/lib/notifications';
import { MEAL_REMINDERS_CHANNEL } from '@/lib/meal-reminders';

export function CapacitorNativeInit() {
  useEffect(() => {
    (async () => {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) return;

      try {
        const { StatusBar, Style } = await import('@capacitor/status-bar');
        await StatusBar.setStyle({ style: Style.Dark });
      } catch {
        // Edge-to-edge enforced on Android 15+ — style may be a no-op, safe to ignore
      }

      try {
        const { LocalNotifications } = await import('@capacitor/local-notifications');
        await LocalNotifications.createChannel({
          id: WORKOUT_TIMERS_CHANNEL,
          name: 'Workout timers',
          description: 'Rest timer alerts during a workout',
          importance: 4,
          visibility: 1,
          vibration: true,
        });
        await LocalNotifications.createChannel({
          id: MEAL_REMINDERS_CHANNEL,
          name: 'Meal reminders',
          description: "Reminders to log a meal after its time window ends",
          importance: 3,
          visibility: 1,
          vibration: false,
        });
        await LocalNotifications.requestPermissions();
      } catch {}
    })();
  }, []);

  return null;
}
```

- [ ] **Step 2: Add reconcile-on-mount and reconcile-on-resume to `SyncProvider`**

In `components/sync-provider.tsx`, add imports at the top (after the existing imports):

```ts
import { reconcileMealReminders } from '@/lib/meal-reminders';
import { todayInTz } from '@/lib/date-utils';
```

Then add a new `useEffect` inside `SyncProvider`, alongside the existing two effects (after the network-listener effect, before `return null`):

```tsx
  // Reconcile meal reminders on app open and whenever the app returns to the
  // foreground (covers the app being left open across a meal window or midnight).
  useEffect(() => {
    let handle: { remove: () => void } | undefined;

    async function reconcile() {
      if (localStorage.getItem('ta_pref_meal_reminders') === 'false') return;
      try {
        const [mealTypes, foodLogs] = await Promise.all([
          fetch('/api/nutrition/meal-types').then(r => r.json()),
          fetch(`/api/nutrition/food-logs?date=${todayInTz()}`).then(r => r.json()),
        ]);
        await reconcileMealReminders(
          Array.isArray(mealTypes) ? mealTypes : [],
          Array.isArray(foodLogs) ? foodLogs : [],
        );
      } catch {
        // Network unavailable — skip, will retry on next open/resume
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
  }, []);
```

- [ ] **Step 3: Run typecheck**

```bash
pnpm exec tsc --noEmit
```

Expected: PASS, no errors.

- [ ] **Step 4: Commit**

```bash
git add components/capacitor-native-init.tsx components/sync-provider.tsx
git commit -m "Reconcile meal reminders on app open and resume"
```

---

### Task 4: Cancel reminder immediately when a meal is logged

**Files:**
- Modify: `lib/nutrition/log-meal.ts`
- Modify: `components/nutrition/food-logger-sheet.tsx`
- Modify: `components/nutrition/saved-meals-sheet.tsx`

- [ ] **Step 1: Cancel the reminder in `logMealItems`**

`lib/nutrition/log-meal.ts` is currently:

```ts
import type { SavedMeal } from '@/lib/types/nutrition'

// Logs each item of a saved meal as a food log entry. If any request fails,
// deletes the entries already created so a network error mid-meal doesn't
// leave a partial log behind.
export async function logMealItems(meal: SavedMeal, date: string, mealTypeId: string): Promise<void> {
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
    }
  } catch (err) {
    await Promise.all(createdIds.map(id =>
      fetch(`/api/nutrition/food-logs/${id}`, { method: 'DELETE' }).catch(() => {})
    ))
    throw err
  }
}
```

Update to:

```ts
import type { SavedMeal } from '@/lib/types/nutrition'
import { cancelMealReminder } from '@/lib/meal-reminders'

// Logs each item of a saved meal as a food log entry. If any request fails,
// deletes the entries already created so a network error mid-meal doesn't
// leave a partial log behind.
export async function logMealItems(meal: SavedMeal, date: string, mealTypeId: string): Promise<void> {
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
    }
    await cancelMealReminder(mealTypeId)
  } catch (err) {
    await Promise.all(createdIds.map(id =>
      fetch(`/api/nutrition/food-logs/${id}`, { method: 'DELETE' }).catch(() => {})
    ))
    throw err
  }
}
```

- [ ] **Step 2: Cancel the reminder in `food-logger-sheet.tsx`'s manual log path**

In `components/nutrition/food-logger-sheet.tsx`, add to the imports (alongside the other `@/lib/...` imports near the top of the file):

```ts
import { cancelMealReminder } from '@/lib/meal-reminders'
```

In `handleConfirm`, the log request is:

```ts
      const today = todayInTz()
      const logRes = await fetch('/api/nutrition/food-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: today, mealTypeId, foodItemId, quantityMultiplier: quantity }),
      })

      if (!logRes.ok) throw new Error()
      toast.success(`${form.name} logged`)
```

Update to:

```ts
      const today = todayInTz()
      const logRes = await fetch('/api/nutrition/food-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: today, mealTypeId, foodItemId, quantityMultiplier: quantity }),
      })

      if (!logRes.ok) throw new Error()
      await cancelMealReminder(mealTypeId)
      toast.success(`${form.name} logged`)
```

- [ ] **Step 3: Cancel the reminder in `saved-meals-sheet.tsx`'s quick-log path**

In `components/nutrition/saved-meals-sheet.tsx`, add to the imports (alongside the other `@/lib/...` imports near the top of the file):

```ts
import { cancelMealReminder } from '@/lib/meal-reminders'
```

In `quickLog`, the loop is:

```ts
      for (const item of meal.items) {
        await fetch('/api/nutrition/food-logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: today, mealTypeId, foodItemId: item.foodItemId, quantityMultiplier: item.quantityMultiplier }),
        })
      }
      await invalidateCache('nutrition-food-logs-')
      await invalidateCache('nutrition-weekly-summary')
      toast.success(`${meal.name} logged`)
```

Update to:

```ts
      for (const item of meal.items) {
        await fetch('/api/nutrition/food-logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: today, mealTypeId, foodItemId: item.foodItemId, quantityMultiplier: item.quantityMultiplier }),
        })
      }
      await cancelMealReminder(mealTypeId)
      await invalidateCache('nutrition-food-logs-')
      await invalidateCache('nutrition-weekly-summary')
      toast.success(`${meal.name} logged`)
```

- [ ] **Step 4: Run typecheck and tests**

```bash
pnpm exec tsc --noEmit
pnpm test
```

Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add lib/nutrition/log-meal.ts components/nutrition/food-logger-sheet.tsx components/nutrition/saved-meals-sheet.tsx
git commit -m "Cancel meal reminders immediately when a meal is logged"
```

---

### Task 5: Per-meal-type "Remind me" toggle UI

**Files:**
- Modify: `components/nutrition/meal-type-manager.tsx`

- [ ] **Step 1: Import `Switch` and bell icons**

At the top of `components/nutrition/meal-type-manager.tsx`, the imports are:

```tsx
import { useEffect, useState, useCallback } from 'react'
import { Loader2, Trash2, Pencil, GripVertical, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { DragDropProvider, PointerSensor } from '@dnd-kit/react'
import { useSortable } from '@dnd-kit/react/sortable'
import type { MealType } from '@/lib/types/nutrition'
```

Update to:

```tsx
import { useEffect, useState, useCallback } from 'react'
import { Loader2, Trash2, Pencil, GripVertical, Plus, Bell, BellOff } from 'lucide-react'
import { toast } from 'sonner'
import { DragDropProvider, PointerSensor } from '@dnd-kit/react'
import { useSortable } from '@dnd-kit/react/sortable'
import { Switch } from '@/components/ui/switch'
import type { MealType } from '@/lib/types/nutrition'
```

- [ ] **Step 2: Show a bell icon on each row reflecting `remindersEnabled`**

In `SortableMealTypeRow`, the row currently is:

```tsx
      <div className="flex items-center gap-2 px-3 py-2.5">
        <GripVertical className="w-4 h-4 text-muted-foreground/40 shrink-0 cursor-grab active:cursor-grabbing" />
        <span className="text-lg shrink-0">{mt.emoji}</span>
        <span className="text-sm font-medium flex-1">{mt.name}</span>
        <span className="text-[10px] text-muted-foreground">{mt.timeStartHour}–{mt.timeEndHour}h</span>
        <button onClick={() => onEdit(mt)} className="p-1.5 text-muted-foreground hover:text-foreground">
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => onDelete(mt.id)} className="p-1.5 text-muted-foreground hover:text-destructive">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
```

Update to add a bell icon before the time range:

```tsx
      <div className="flex items-center gap-2 px-3 py-2.5">
        <GripVertical className="w-4 h-4 text-muted-foreground/40 shrink-0 cursor-grab active:cursor-grabbing" />
        <span className="text-lg shrink-0">{mt.emoji}</span>
        <span className="text-sm font-medium flex-1">{mt.name}</span>
        {mt.remindersEnabled ? (
          <Bell className="w-3.5 h-3.5 text-muted-foreground/60" />
        ) : (
          <BellOff className="w-3.5 h-3.5 text-muted-foreground/30" />
        )}
        <span className="text-[10px] text-muted-foreground">{mt.timeStartHour}–{mt.timeEndHour}h</span>
        <button onClick={() => onEdit(mt)} className="p-1.5 text-muted-foreground hover:text-foreground">
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => onDelete(mt.id)} className="p-1.5 text-muted-foreground hover:text-destructive">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
```

- [ ] **Step 3: Add `remindersEnabled` to `editForm` and `newForm` state**

The current state declarations are:

```tsx
  const [editForm, setEditForm] = useState({ name: '', emoji: '', timeStartHour: 0, timeEndHour: 24 })
  const [addingNew, setAddingNew] = useState(false)
  const [newForm, setNewForm] = useState({ name: '', emoji: '🍽️', timeStartHour: 0, timeEndHour: 24 })
```

Update to:

```tsx
  const [editForm, setEditForm] = useState({ name: '', emoji: '', timeStartHour: 0, timeEndHour: 24, remindersEnabled: true })
  const [addingNew, setAddingNew] = useState(false)
  const [newForm, setNewForm] = useState({ name: '', emoji: '🍽️', timeStartHour: 0, timeEndHour: 24, remindersEnabled: true })
```

- [ ] **Step 4: Populate `remindersEnabled` when starting an edit**

`startEdit` is currently:

```tsx
  function startEdit(mt: MealType) {
    setEditingId(mt.id)
    setEditForm({ name: mt.name, emoji: mt.emoji, timeStartHour: mt.timeStartHour, timeEndHour: mt.timeEndHour })
  }
```

Update to:

```tsx
  function startEdit(mt: MealType) {
    setEditingId(mt.id)
    setEditForm({ name: mt.name, emoji: mt.emoji, timeStartHour: mt.timeStartHour, timeEndHour: mt.timeEndHour, remindersEnabled: mt.remindersEnabled })
  }
```

- [ ] **Step 5: Reset `remindersEnabled` to `true` after adding a new meal type**

`addNew`'s success branch currently resets the form:

```tsx
      toast.success('Meal type added')
      setAddingNew(false)
      setNewForm({ name: '', emoji: '🍽️', timeStartHour: 0, timeEndHour: 24 })
      load()
```

Update to:

```tsx
      toast.success('Meal type added')
      setAddingNew(false)
      setNewForm({ name: '', emoji: '🍽️', timeStartHour: 0, timeEndHour: 24, remindersEnabled: true })
      load()
```

- [ ] **Step 6: Add a "Remind me" switch to the edit form**

In the edit form, the hours row and the Cancel/Save buttons are:

```tsx
                <div className="flex gap-2 items-center text-xs text-muted-foreground">
                  <span>Hours</span>
                  <input
                    type="number" min={0} max={23}
                    value={editForm.timeStartHour}
                    onChange={e => setEditForm(f => ({ ...f, timeStartHour: parseInt(e.target.value) || 0 }))}
                    className="w-16 rounded-lg border bg-background px-2 py-1.5 text-center text-sm"
                  />
                  <span>to</span>
                  <input
                    type="number" min={1} max={24}
                    value={editForm.timeEndHour}
                    onChange={e => setEditForm(f => ({ ...f, timeEndHour: parseInt(e.target.value) || 24 }))}
                    className="w-16 rounded-lg border bg-background px-2 py-1.5 text-center text-sm"
                  />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setEditingId(null)} className="flex-1 rounded-lg border py-2 text-sm">Cancel</button>
```

Add a switch row between the hours row and the Cancel/Save row:

```tsx
                <div className="flex gap-2 items-center text-xs text-muted-foreground">
                  <span>Hours</span>
                  <input
                    type="number" min={0} max={23}
                    value={editForm.timeStartHour}
                    onChange={e => setEditForm(f => ({ ...f, timeStartHour: parseInt(e.target.value) || 0 }))}
                    className="w-16 rounded-lg border bg-background px-2 py-1.5 text-center text-sm"
                  />
                  <span>to</span>
                  <input
                    type="number" min={1} max={24}
                    value={editForm.timeEndHour}
                    onChange={e => setEditForm(f => ({ ...f, timeEndHour: parseInt(e.target.value) || 24 }))}
                    className="w-16 rounded-lg border bg-background px-2 py-1.5 text-center text-sm"
                  />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Remind me if not logged</span>
                  <Switch
                    checked={editForm.remindersEnabled}
                    onCheckedChange={val => setEditForm(f => ({ ...f, remindersEnabled: val }))}
                  />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setEditingId(null)} className="flex-1 rounded-lg border py-2 text-sm">Cancel</button>
```

- [ ] **Step 7: Run lint**

```bash
pnpm lint
```

Expected: PASS, no errors in `components/nutrition/meal-type-manager.tsx`.

- [ ] **Step 8: Commit**

```bash
git add components/nutrition/meal-type-manager.tsx
git commit -m "Add per-meal-type reminder toggle to meal type manager"
```

---

### Task 6: Global "Meal Reminders" toggle in Nutrition Settings

**Files:**
- Modify: `app/nutrition/nutrition-content.tsx`

- [ ] **Step 1: Import `Switch` and the reminder functions**

The current imports include:

```tsx
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { MealType, FoodLogWithItem, NutritionTargets } from "@/lib/types/nutrition";
import { cachedFetch, invalidateCache } from "@/lib/sqlite/cache";
import { TTL_MEDIUM, TTL_LONG } from "@/components/sync-provider";
import { todayInTz } from "@/lib/date-utils";
```

Add:

```tsx
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { MealType, FoodLogWithItem, NutritionTargets } from "@/lib/types/nutrition";
import { cachedFetch, invalidateCache } from "@/lib/sqlite/cache";
import { TTL_MEDIUM, TTL_LONG } from "@/components/sync-provider";
import { todayInTz } from "@/lib/date-utils";
import { reconcileMealReminders, cancelAllMealReminders } from "@/lib/meal-reminders";
```

- [ ] **Step 2: Add the toggle state**

The component's state declarations start with:

```tsx
export default function NutritionContent() {
  const [mealTypes, setMealTypes] = useState<MealType[]>([]);
  const [logs, setLogs] = useState<FoodLogWithItem[]>([]);
```

After the existing `useState` declarations (the block ending with `const [confirmDeleteLogId, setConfirmDeleteLogId] = useState<string | null>(null);`), add:

```tsx
  const [confirmDeleteLogId, setConfirmDeleteLogId] = useState<string | null>(null);
  const [mealRemindersEnabled, setMealRemindersEnabled] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("ta_pref_meal_reminders");
    if (stored !== null) setMealRemindersEnabled(stored !== "false");
  }, []);

  const toggleMealReminders = (val: boolean) => {
    setMealRemindersEnabled(val);
    localStorage.setItem("ta_pref_meal_reminders", String(val));
    if (val) {
      reconcileMealReminders(mealTypes, logs);
    } else {
      cancelAllMealReminders(mealTypes.map(mt => mt.id));
    }
  };
```

- [ ] **Step 3: Add the "Meal Reminders" section to the Settings sheet**

The Settings sheet body currently is:

```tsx
          <div className="flex-1 overflow-y-auto p-4 pb-[env(safe-area-inset-bottom)] space-y-6">
            <div>
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Macro Targets</h3>
              <NutritionTargetsForm />
            </div>
            <div>
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Meal Types</h3>
              <MealTypeManager />
            </div>
          </div>
```

Add a "Meal Reminders" section between the two:

```tsx
          <div className="flex-1 overflow-y-auto p-4 pb-[env(safe-area-inset-bottom)] space-y-6">
            <div>
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Macro Targets</h3>
              <NutritionTargetsForm />
            </div>
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
```

- [ ] **Step 4: Run lint and typecheck**

```bash
pnpm lint
pnpm exec tsc --noEmit
```

Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add app/nutrition/nutrition-content.tsx
git commit -m "Add global meal reminders toggle to Nutrition Settings"
```

---

### Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

```bash
pnpm test
```

Expected: all tests pass, including the new `lib/__tests__/meal-reminders.test.ts`.

- [ ] **Step 2: Run lint across the whole project**

```bash
pnpm lint
```

Expected: no errors.

- [ ] **Step 3: Run the production build**

```bash
pnpm build
```

Expected: build succeeds with no type errors.

- [ ] **Step 4: Manual web verification with Playwright**

Start the dev server (`pnpm dev`), then write a short script at `/tmp/test_meal_reminders.js` using the same cookie-based login pattern as `/tmp/test_dnd5.js` (reuse the `authjs.session-token` cookie for `test@local.dev`):

1. Navigate to `/nutrition`, open the settings sheet (gear icon).
2. Confirm the new "Meal Reminders" section renders with a toggle, default ON.
3. Toggle it off, reload the page, reopen settings — confirm it stays off (localStorage persists).
4. Toggle it back on.
5. Edit a meal type (pencil icon in "Meal Types") — confirm the "Remind me if not logged" switch appears, defaults to ON, can be toggled off, and persists after save + reopen.
6. Confirm no console errors are thrown (web build is `!Capacitor.isNativePlatform()`, so `reconcileMealReminders`/`cancelMealReminder`/`cancelAllMealReminders` should all silently no-op).

Take a screenshot of the settings sheet showing both new controls and report the result.

- [ ] **Step 5: Report results**

Summarize: test/lint/build status, and what the Playwright run showed (screenshot path).

---

### Task 8: Version bump, changelog, project docs, and merge

**Files:**
- Modify: `package.json`
- Modify: `lib/changelog.ts`
- Modify: `projectOverview.md`

- [ ] **Step 1: Bump the version**

In `package.json`, change:

```json
  "version": "1.32.1",
```

to:

```json
  "version": "1.33.0",
```

(minor bump — this is a new feature, not a bug fix)

- [ ] **Step 2: Add a changelog entry**

In `lib/changelog.ts`, the array starts with:

```ts
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.32.1",
    date: "2026-06-13",
```

Add a new entry above it:

```ts
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.33.0",
    date: "2026-06-13",
    changes: [
      "Added meal reminder notifications — if a meal's time window ends with nothing logged, you'll get a 'Don't forget to log...' notification (Android app only); toggle globally in Nutrition Settings or per meal type in Meal Types",
    ],
  },
  {
    version: "1.32.1",
    date: "2026-06-13",
```

- [ ] **Step 3: Update `projectOverview.md`**

Read `projectOverview.md`, find the most recent session entry / "Other Planned / Future Work" section, and:
- Add a new session entry summarizing this feature (meal reminder notifications: per-meal-type + global toggle, reconcile-on-open/resume, cancel-on-log, native-only).
- If "meal logging reminders" or similar appears in "Other Planned / Future Work", check it off as ✅ shipped, with a ⚠️ note that on-device APK verification is still pending (notification firing/timing can't be tested in this sandbox).

- [ ] **Step 4: Commit**

```bash
git add package.json lib/changelog.ts projectOverview.md
git commit -m "Bump version to 1.33.0 for meal reminder notifications"
```

- [ ] **Step 5: Push the feature branch and merge to main**

```bash
git push -u origin <branch-name>
```

Then ask the user to confirm before merging to `main`, per CLAUDE.md's merge-confirmation rule — unless the user has already given blanket approval for this task to merge once testing is complete.
