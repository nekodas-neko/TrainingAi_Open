# Deep-Dive Audit #2 — Capacitor Native & Health Connect (2026-06-13)

Scope: every `@capacitor/*` / `@capacitor-community/*` / `@devmaxime/*` usage, Health Connect
permission keys, notification channels/ids, reconcile-on-resume. Skill:
`.agents/skills/capacitor-native-plugins/SKILL.md`.

⚠️ Native runtime behaviour (haptics firing, scanning, Health Connect sync, notifications) **cannot be
sandbox-tested** — only `pnpm build`/`tsc`/`lint`/`test` and bundle analysis can. Tag on-device items as
"⚠️ Pending on-device verification" in `projectOverview.md` per the `session-wrapup` skill.

---

## Task 1 — `lib/haptics.ts` static-imports `@capacitor/haptics` into the web bundle · **High**

- **Where:** `lib/haptics.ts:1` — `import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'`, no `Capacitor.isNativePlatform()` gate. Imported by `components/ui/weight-dial.tsx`, `components/workout-screen.tsx`, `app/workout-select/workout-select-content.tsx` (all web-facing) → plugin pulled into the PWA bundle. The `try/catch` swallows runtime errors but doesn't stop the static import being bundled (the 1.5.1 "failed to resolve module specifier" hazard).
- **Fix:** Convert each exported fn to gate + dynamic import:
  ```ts
  export async function hapticTick() {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return;
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    try { await Haptics.impact({ style: ImpactStyle.Light }); } catch {}
  }
  ```
- **Verify:** `pnpm build` — confirm `@capacitor/haptics` no longer in the initial chunk (sandbox-OK). Haptic firing ⚠️ on-device.

## Task 2 — `barcode-scanner.tsx` static-imports the community plugin · **High**

- **Where:** `components/nutrition/barcode-scanner.tsx:8` — `import { BarcodeScanner as CapScanner } from '@capacitor-community/barcode-scanner'`. Calls are gated on `isNativePlatform()`, but the static binding bundles the plugin into web (same hazard as Task 1). `@capacitor/core` static import at `:7` is fine (web-safe).
- **Fix:** Dynamically `import('@capacitor-community/barcode-scanner')` inside `startNative()`/`stopNative()` — mirror the already-dynamic `@zxing/browser` web path at `:94`.
- **Verify:** `pnpm build` bundle check (sandbox-OK). Scan behaviour ⚠️ on-device.

## Task 3 — H7 confirmed unfixed: HRV read key mismatch is dead code · **Med (known issue H7)**

- **Where:** `lib/health-connect-sync.ts:312,315`.
- **Problem:** HRV block gates on `canRead.has('HeartRateVariabilitySdnn')` and reads `type:'HeartRateVariabilitySdnn'`, but the `requestPermissions({read:[...]})` array at `:206` contains **neither** `Sdnn` nor the correct `Rmssd` key → `canRead` never has it, block never runs, `hrvMs` never populated. Per the plugin's `RECORDS_TYPE_NAME_MAP` the correct key is `HeartRateVariabilityRmssd`.
- **Fix:** Add `'HeartRateVariabilityRmssd'` to the `requestPermissions` read array AND change the `canRead.has(...)` + `readRecords({type})` to `'HeartRateVariabilityRmssd'` (all three must match). Note: even after this, per H6 the native `RecordConverter.kt` may still not structure the record — confirm against the pinned `connect-client:1.1.0-alpha11` map.
- **Verify:** ⚠️ On-device (real Health Connect HRV data) — cannot be sandbox-tested.

## Task 4 — `TotalCaloriesBurned` aggregate runs ungated; permission never requested · **Med (new)**

- **Where:** `lib/health-connect-sync.ts:120,258` (also `Distance` at `:113/:248`).
- **Problem:** Both `aggregateRecords({type:'TotalCaloriesBurned'})` calls run with **no** `canRead.has(...)` gate, and `'TotalCaloriesBurned'` is **not** in the read-permissions array → on-device it throws a permission error every time, swallowed by the empty `catch`, so `caloriesBurned` never populates. `Distance` is gated on the unrelated `canRead.has('Steps')` proxy and also isn't in the read array (lower confidence — Steps grant may co-grant).
- **Fix:** Add `'TotalCaloriesBurned'` (and ideally `'Distance'`) to the read-permissions array and gate each aggregate behind its own `canRead.has(...)` check.
- **Verify:** ⚠️ On-device against real Health Connect permissions.

## Task 5 — Rest-timer notification not reconciled on `@capacitor/app` resume · **Med (new)**

- **Where:** `components/workout-screen.tsx:260-271` (schedule/cancel in a `useEffect`) + `lib/notifications.ts`.
- **Problem:** The skill lists rest timers as "state that should reflect reality even if the app was closed", requiring re-reconcile on every resume (as meal reminders do at `sync-provider.tsx:124`). There's no `App.addListener('resume', …)` for the rest timer; if the alarm is evicted or the rest phase changed while suspended, it isn't reconciled. Lower impact than meal reminders (one-shot AlarmManager alarm usually survives) but diverges from the documented pattern.
- **Fix:** Either add a resume listener that re-derives `remainingMs` from `store.restStartMs` and reschedules/cancels, or explicitly document the one-shot alarm as intentionally fire-and-forget.
- **Verify:** ⚠️ On-device (background/resume + alarm firing).

## Task 6 — Extract rest-timer reconcile decision as a pure, tested function · **Low**

- **Where:** `components/workout-screen.tsx:260-271`, `lib/notifications.ts`.
- **Problem:** Decision logic (`remainingMs > 1000 ? schedule : cancel`) is inlined in a component effect with no unit test — unlike `computeMealReminderActions` (11 Vitest tests). Edge logic unverifiable in the sandbox.
- **Fix:** Extract `computeRestNotificationAction(phase, restStartMs, restSec, now)` returning `{type:'schedule',delayMs,setNumber} | {type:'cancel'}` into `lib/notifications.ts` and unit-test it (sandbox-OK).

## Task 7 — Guard the Health Connect permission-key/read-array mismatch with a test · **Low**

- **Where:** `lib/__tests__/health-connect-sync.test.ts` (currently only covers `mapExerciseTypeToActivityType`).
- **Problem:** Nothing asserts that every `readRecords`/`aggregateRecords` `type` and every `canRead.has(...)` key is present in the `requestPermissions` read array — exactly the recurring H6/H7/Task-4 failure mode, which ships repeatedly because it's silent at runtime.
- **Fix:** Refactor the read array, the per-type `canRead` gate keys, and the `readRecords` type strings to share one exported constant map (e.g. `HC_READ_TYPES`); add a Vitest test asserting the three sets are identical. Future mismatches become a failing test, not a silent dead branch. Sandbox-OK.

---

## Already correct (no action)
Both notification channels registered in `capacitor-native-init.tsx`; rest-timer id `9001` vs meal-reminder
`9200–9999` don't collide. Meal reminders correctly reconcile on mount + resume with fresh (non-cached) data.
Background geolocation correctly does not request `ACCESS_BACKGROUND_LOCATION`. All other plugin usages
(`lib/notifications.ts`, `meal-reminders.ts`, `location.ts`, `activity/gps-tracking.ts`, `sqlite-service.ts`,
`sync-provider.tsx`, `google-sign-in.tsx`, `mobile-auth-handler.tsx`, `nutrition/capture-step.tsx`) gate on
`isNativePlatform()` and dynamic-import their plugin.

## Verification & commit
- Sandbox: `pnpm build` (Tasks 1,2 bundle), `pnpm test` (Tasks 6,7), `tsc`/`lint`.
- Record Tasks 3,4,5 under "⚠️ Pending on-device verification" in `projectOverview.md`.
- Native fixes are largely user-invisible until on-device → patch bump when shipped; changelog only for the user-facing HRV/calories sync once verified.
