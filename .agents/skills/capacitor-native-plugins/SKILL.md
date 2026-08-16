---
name: capacitor-native-plugins
description: Use this skill when adding, modifying, or debugging any Capacitor native plugin integration — local notifications, haptics, geolocation/background-geolocation, Health Connect, camera, status bar, or app lifecycle (resume) events. Also trigger when the user reports something works on web/PWA but not in the Android APK, mentions "native", "Capacitor", "Health Connect", "APK build", or asks to add a new native capability.
---

# Capacitor Native Plugin Patterns

TrainingAI is a Next.js PWA shipped as an Android APK via Capacitor. Native code only runs on-device — the web/PWA build must always degrade gracefully.

## Always gate on `Capacitor.isNativePlatform()`

```ts
const { Capacitor } = await import('@capacitor/core');
if (!Capacitor.isNativePlatform()) return; // web no-ops silently
```

Dynamically `import()` each plugin (don't statically import at module top level) — see `components/capacitor-native-init.tsx`. This keeps the plugins out of the web bundle and avoids "failed to resolve module specifier" errors (1.5.1).

## Notification channels

New notification types need a channel created in `components/capacitor-native-init.tsx` alongside `WORKOUT_TIMERS_CHANNEL` / `MEAL_REMINDERS_CHANNEL`:

```ts
await LocalNotifications.createChannel({
  id: MY_CHANNEL,
  name: 'Human-readable name',
  description: '...',
  importance: 3,   // 1-5, see Android NotificationManager
  visibility: 1,
  vibration: false,
});
```
Export the channel id constant from the relevant `lib/*.ts` module (e.g. `lib/meal-reminders.ts` exports `MEAL_REMINDERS_CHANNEL`) so both the init file and the scheduling code share one source of truth. Notification ids should be deterministically hashed into a dedicated numeric range to avoid collisions (e.g. meal reminders use 9200–9999, `REST_COMPLETE_ID = 9001`).

## Reconcile-on-mount + resume

For "state that should reflect reality even if the app was closed" (meal reminders, rest timers), follow the pattern in `components/sync-provider.tsx`:
1. Run a `reconcile*()` function on mount (native only)
2. Re-run it on every `@capacitor/app` `resume` event
3. Fetch fresh data (not via `cachedFetch`) so the reconcile decision uses current state, not stale cache
4. Make the core decision logic a pure function (e.g. `computeMealReminderActions`) that's unit-testable without Capacitor — the Capacitor calls are a thin wrapper

## Patching third-party native plugins

If a plugin has a bug in its native (Kotlin/Java) layer that you can't fix from TS, use a pnpm patch:
- Patch file lives in `patches/@scope__package-name.patch`
- Registered in `package.json` → `pnpm.patchedDependencies`
- Requires a full APK rebuild to take effect — cannot be verified in the sandbox

## Health Connect permission-key gotcha (learn from H6/H7)

The pinned `@devmaxime/capacitor-health-connect` plugin requires permission **read** keys to exactly match its `RECORDS_TYPE_NAME_MAP` (e.g. `HeartRateVariabilityRmssd`, not `Sdnn`). If a permission key string doesn't match:
- `canRead.has(...)` silently returns `false`
- The corresponding `readRecords({ type: ... })` block never runs
- No error is thrown — the field just stays empty forever

**Before adding a new Health Connect data type**: verify the exact key string against the plugin's type map, not just what seems intuitively correct, and confirm it's present in BOTH the `requestPermissions({ read: [...] })` array AND the `canRead.has(...)` check.

## Background location

`@capacitor-community/background-geolocation` relies on Android's foreground-service "while in use" exemption — it does **not** request `ACCESS_BACKGROUND_LOCATION`. Don't add that permission expecting a behavior change; the existing "tracking your activity" foreground notification is the correct/expected UX for locked-screen tracking.

## Verification limits

Native plugin changes (notification firing/cancelling, Health Connect sync, GPS while locked, haptics) **cannot be tested in the sandbox** — no real device, no Play Services. After making such a change: run `pnpm test` / `pnpm exec tsc --noEmit` / `pnpm lint` / `pnpm build` for what *can* be verified, then list the on-device checks as "⚠️ Pending on-device verification" in `projectOverview.md` (see the `session-wrapup` skill).
