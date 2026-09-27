# Two notification channels the app posted to and never created

Implementation Lane B, 2026-09-26. `DV-21`, from Device Verification sweep 4b station A.

## What shipped

`components/capacitor-native-init.tsx` creates two more channels:

- **`health-alerts`**, importance 4 (heads-up), vibrating.
- **`workout-reminders`**, importance 3, silent — matching the other reminders.

and `components/__tests__/dv21-notification-channels-exist.test.ts` fails if any `channelId:` in
`app/`, `components/`, `lib/` or `packages/` names a channel no `createChannel` call creates.

## Why it could not be seen from inside

On Android 8+ a notification posted to a channel that does not exist is **dropped by the system,
silently**. Above the channel everything looked healthy: `computeHealthAlertActions` is unit-tested
and passes, `reconcileHealthAlerts` runs from `sync-provider.tsx` on every sync, the dedup key is
written. The only surface that shows the fault is the device's own channel list, which is where
sweep 4b found it — the S25 had exactly one app channel, `oura-ble-v2`.

So illness, high-stress and low-readiness alerts (ids 9300/9301/9302) have never been able to fire.

## The guard found a second one, which is the reason it exists

The scan was written for the fix it came with, and it immediately failed on **`workout-reminders`**.
`reconcileWorkoutReminder` runs from the same `sync-provider.tsx` and has been scheduling to a
channel nothing creates for as long as health alerts have. Nobody had reported it and no sweep had
reached it. That is the sibling-surface sweep CLAUDE.md asks for, done by a scan rather than by
waiting for a second sighting — and it is the argument for the scan over a one-line fix.

## The importance was chosen deliberately, because it cannot be changed later

**An Android channel's importance is immutable once created** — the Kotlin services carry `-v2` ids
for exactly this reason (`OuraRingService.kt:48`, `ScaleBleService.kt:57`). Raising it afterwards
needs a new channel id and a delete of the old one on every installed device.

Health alerts take **4**: they are things to know before the day starts, they fire at most once per
type per day, and a silent tray entry missed for a day is worth nothing. Workout reminders take
**3** like the meal, supplement and day-review reminders — it is a time the owner asked for, not an
anomaly.

## Not established, and unchanged by this

Whether any health alert has ever been *attempted*. A dropped post leaves nothing behind, so the
absence of alerts is equally consistent with the conditions never triggering. The device check owed
on `DV-21` forces one rather than waiting for a real anomaly.

## Failure surfaces not exercised

Everything that matters here is the device's: the channel list, the post, and the tap routing to
`/health/readiness`. Nothing in the sandbox runs `LocalNotifications` — the Capacitor branch is
inert on web, so `pnpm dev` and the Playwright shell pass prove only that the module still imports
and the five tabs still paint. **No APK is needed**: this is TypeScript in the WebView, so a
Railway deploy reaches it.

## Verification run here

`pnpm lint` 0 errors / 828 warnings (identical to the base) · `pnpm check:rules` Ran 80 of 80 ·
`pnpm test` 1089 files, 10184 passed · `pnpm build` clean · `tsc --noEmit` clean ·
`check-test-typecheck` none above baseline · `e2e/tabs-instant-paint.spec.ts` 7 passed, which is
the dev-server pass. Control run: deleting the `health-alerts` channel again fails the guard.
