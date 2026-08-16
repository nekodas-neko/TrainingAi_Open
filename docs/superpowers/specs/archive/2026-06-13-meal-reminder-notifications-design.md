# Meal Reminder Notifications — Design Spec

**Date:** 2026-06-13
**Status:** Approved, ready for implementation plan

## Overview

Each meal type (`meal_types`) has a configured time window (`timeStartHour`–`timeEndHour`, e.g. Breakfast 6–10). This feature reminds the user, via a local push notification on the Android app, to log food for a meal once that meal's time window has ended and nothing has been logged for it yet today.

This is native-only (Capacitor/APK). On the web PWA, all reminder logic is a no-op, matching the existing pattern in `lib/notifications.ts`.

## Goals

- When a meal type's time window ends and no food has been logged for it today, notify the user (e.g. "Don't forget to log 🍳 Breakfast!").
- Don't notify for meals already logged.
- Cancel a pending reminder the moment the user logs that meal (in the same session).
- Allow the user to opt individual meal types out of reminders.
- Allow a global on/off toggle for the whole feature.

## Non-Goals

- Server-side push notifications / FCM.
- Background tasks that run while the app is fully closed (would require a new native plugin, e.g. `@capacitor-community/background-runner`, and on-device-only testing — out of scope).
- Retroactive reminders for days the app was never opened at all.

## Chosen Approach: Reconcile-on-open/resume

On every app launch and every resume-from-background, the app fetches the user's meal types and today's food logs, then for each meal type with reminders enabled:

- If a food log already exists for that meal type today → cancel any pending/scheduled reminder for it.
- Else, compute the window's end time for today (device local clock; `timeEndHour === 24` clamps to 23:59):
  - If "now" is already past that end time → schedule an **immediate** catch-up notification (fires within seconds).
  - Else → schedule a **one-shot** notification for that end time today.

Scheduled one-shots fire via the OS (AlarmManager) even if the app is subsequently closed — this matches the existing `scheduleRestCompleteNotification` behaviour. Reminders only get (re)scheduled on days the app is opened at least once; a day with zero app-opens produces zero reminders for that day (accepted edge case — see "Other approaches considered").

### Other approaches considered

- **Recurring daily notification** (`schedule.on`, set once): guarantees a reminder fires every day regardless of app usage, but cannot suppress an individual day's occurrence if the meal was already logged — would produce false "already logged" pings. Rejected.
- **Background task plugin**: most "correct" (works without opening the app, no false positives), but requires a new native dependency, Android battery-optimization permission prompts, and can only be verified on-device (not in this sandbox). Rejected as too large for this feature.

## Architecture

### New module: `lib/meal-reminders.ts`

Mirrors the existing `lib/notifications.ts` pattern (dynamic import of `@capacitor/local-notifications`, `Capacitor.isNativePlatform()` guard, try/catch around all native calls).

Exports:

- `MEAL_REMINDERS_CHANNEL = 'meal-reminders'`
- `reconcileMealReminders(mealTypes: MealType[], foodLogs: FoodLog[], now: Date = new Date()): Promise<void>`
  - Pure decision logic (which meal types need a scheduled/immediate/cancelled notification) is implemented as a small exported pure function, e.g. `computeMealReminderActions(mealTypes, foodLogs, now)`, so it can be unit tested with Vitest without touching Capacitor. `reconcileMealReminders` calls this and then performs the actual `LocalNotifications.schedule`/`.cancel` calls.
- `cancelMealReminder(mealTypeId: string): Promise<void>` — cancels a single meal type's reminder; called immediately after a successful food log.
- `mealReminderNotificationId(mealTypeId: string): number` — deterministic hash of the meal type UUID into the range 9200–9999 (avoids collision with `REST_COMPLETE_ID = 9001`). Same meal type always maps to the same ID, so repeated `schedule`/`cancel` calls are idempotent.

### Notification channel

`capacitor-native-init.tsx` creates a new `meal-reminders` channel alongside the existing `workout-timers` channel: normal importance (3), not the high-importance/vibrating workout-timer channel.

### Trigger points

In `components/sync-provider.tsx`:

1. On mount (existing `useEffect`), after current cache-warming tasks: if native and the global toggle (`ta_pref_meal_reminders`, localStorage, default `'true'`) is on, fetch `/api/nutrition/meal-types` and `/api/nutrition/food-logs?date=<today>` directly (not via `cachedFetch` — freshness matters here), then call `reconcileMealReminders(mealTypes, foodLogs)`.
2. Add a `@capacitor/app` `App.addListener('resume', ...)` listener that re-runs the same reconcile when the app returns to the foreground. This covers the case where the app was left open across midnight or a meal window boundary.

### Cancel-on-log

After a successful food log creation in each of the following components, call `cancelMealReminder(mealTypeId)` (fire-and-forget, native no-op on web):

- `components/nutrition/food-logger-sheet.tsx`
- `components/nutrition/quick-edit-log-sheet.tsx`
- `components/nutrition/assign-step.tsx`
- `components/nutrition/saved-meals-sheet.tsx`

## Data Model Changes

### Migration: `meal_types.reminders_enabled`

New migration file in `lib/data/postgres/migrations/`:

```sql
ALTER TABLE meal_types ADD COLUMN reminders_enabled BOOLEAN NOT NULL DEFAULT true;
```

### Type updates

- `lib/types/nutrition.ts`: `MealType` gains `remindersEnabled: boolean`.
- `lib/data/postgres/schema.ts`: add `remindersEnabled: boolean('reminders_enabled').notNull().default(true)` to the `mealTypes` table definition.

### Adapter / API updates

- `rowToMealType` in `lib/data/postgres/adapter.ts` maps the new column.
- `createMealType` / `updateMealType` accept and persist `remindersEnabled`.
- `app/api/nutrition/meal-types/route.ts` (POST) and `app/api/nutrition/meal-types/[id]/route.ts` (PUT) accept `remindersEnabled` in the request body and pass it through.

## UI Changes

### Per-meal-type "Remind me" toggle (`components/nutrition/meal-type-manager.tsx`)

- `editForm` and `newForm` state gain `remindersEnabled: boolean` (new meal types default to `true`).
- Edit form shows a `Switch` labeled "Remind me" alongside the existing name/emoji/time-window fields.
- `SortableMealTypeRow` shows a small bell icon (filled when enabled, muted/slashed when disabled) next to the time-window display.

### Global toggle (`app/nutrition/nutrition-content.tsx`)

- New "Meal Reminders" section in the Nutrition Settings sheet, using the same `Switch` + localStorage pattern as `ta_pref_calendar_sync` in `components/config-screen.tsx`.
- localStorage key: `ta_pref_meal_reminders`, default `'true'`.
- Turning **off** cancels all currently-pending meal reminder notifications (iterate all meal types' deterministic IDs and call `LocalNotifications.cancel`).
- Turning **on** triggers an immediate reconcile so today's reminders are scheduled right away.

## Notification Content

- Title: `Meal reminder`
- Body: `Don't forget to log ${emoji} ${name}!` (e.g. "Don't forget to log 🍳 Breakfast!")
- Channel: `meal-reminders`

## Edge Cases

- `timeEndHour === 24` (e.g. "Evening Snack" 21–24): clamp to 23:59 same day when computing the scheduled time.
- Meal type with `remindersEnabled === false`: skipped entirely during reconcile, and any existing scheduled/pending notification for it is cancelled.
- Global toggle off: skip reconcile entirely; cancel all pending meal reminders.
- Web (`!Capacitor.isNativePlatform()`): all `lib/meal-reminders.ts` functions are no-ops.

## Testing Plan

- **Web**: verify no errors and no native calls occur (`Capacitor.isNativePlatform() === false` branch).
- **Local dev (Vitest)**: unit test `computeMealReminderActions(mealTypes, foodLogs, now)` against representative scenarios — meal logged (cancel), window passed & not logged (immediate), window ahead & not logged (scheduled for end time), `timeEndHour === 24` clamping, `remindersEnabled === false` (skip).
- **On-device (APK)**: manual verification — log a meal mid-window and confirm its reminder is cancelled; let a window pass unlogged and confirm the catch-up notification fires on next app open; toggle global/per-meal settings and confirm reminders are (re)scheduled/cancelled accordingly.
