# Scale integration follow-ups from the first real weigh-in (v1.235.0, v1.236.0, v1.237.0)

Branch: `claude/bluetooth-scale-integration-jcuvs2` (follow-up to the merged PR #848 direct-BLE
Renpho scale integration — PR #848 itself merged in a prior session; this branch was restarted
from fresh `main` per the "already-merged PR" rule rather than stacked on that history).

## What happened

The owner rebuilt the APK, paired the Renpho scale, and did the first real on-device weigh-in.
Background sync (the native Kotlin foreground service) worked exactly as designed end-to-end —
GATT connect/handshake/decode, the reconnect loop, the ongoing "Watching for scale…" notification,
and the POST to `/api/scale-ble/samples` all fired correctly against real hardware. This is the
device verification the original PR's Known Issues row had been waiting on.

But the reading was taken wearing socks, and the resulting body-composition numbers were nonsense:
3% body fat, 70.8% body water, 21.7% protein. The weight (72.55kg) was correct.

## Root cause

Confirmed via the read-only production audit endpoint (`/api/admin/db-query` over `claude_ro`,
bearer-token path) against the owner's actual `scale_raw_samples` row:

```
raw_hex: "100b151c570100000000a4"
decoded: { weightKg: 72.55, impedanceOhmsA: 0, impedanceOhmsB: 0, bodyFatPct: 3, ... }
```

BIA needs bare-skin contact on both foot plates to complete the current path. Socks break that
path, and the scale reports impedance as `0` rather than omitting the packet.
`lib/scale-ble/composition.ts`'s `impedanceIndex = heightCm² / impedanceOhms` divides by that
zero, producing `-Infinity` after the correction term, which the `clamp(..., 3, 60)` floors the
body-fat estimate at — and every other field derives from that same corrupted body-fat number.

No data was clobbered: today's `body_metrics` row was empty before this write (confirmed via the
same audit endpoint), so this was a bad first write, not an overwrite of good data.

## Fix

- `lib/scale-ble/composition.ts`: new `MIN_VALID_IMPEDANCE_OHMS` (200Ω) and `hasValidImpedance()`
  — real bare-foot adult readings run ~300-1200Ω; anything at or near 0 is a no-contact reading,
  not a very-low-body-fat one.
- `app/api/scale-ble/samples/route.ts`: checks `hasValidImpedance()` before calling
  `computeBodyComposition()`. Weight still writes either way (load-cell reading, contact-
  independent). When invalid, composition fields are passed as `undefined` to `upsertBodyMetrics`
  — the existing `COALESCE(EXCLUDED.col, table.col)` merge pattern means they're left alone
  (preserving any real prior value) rather than overwritten with a wrong number, and
  `initialSourceMap`/`mergeSet` never stamp `scale_ble` as owning a field that wasn't actually
  written. Response now includes `compositionSkipped: boolean`.
- `android/.../scale/ScaleBleService.kt`: when the ingest response has `compositionSkipped: true`,
  fires a one-shot `IMPORTANCE_LOW` notification ("stand barefoot on the plates for body
  composition") — visibility into why composition didn't update, distinct from the existing
  HIGH-importance pending-confirmation notification (that one asks for a decision; this one
  doesn't).
- Two new unit tests in `lib/scale-ble/__tests__/composition.test.ts` covering the reject/accept
  boundary at `MIN_VALID_IMPEDANCE_OHMS`.

## Verification

- Full local gate: `tsc` clean, lint 0 errors, 342 test files / 2565 tests passing, `pnpm build`
  clean.
- Live smoke test against the local dev server using the owner's exact captured socks-reading
  bytes: response `{status: "confirmed", weightKg: 72.55, compositionSkipped: true}`; DB shows
  `weight_kg=72.55`, all composition columns `null`, `source_map={"weight_kg":"scale_ble"}`.
- Same test with a real bare-foot impedance reading (505/503Ω): `compositionSkipped: false`,
  composition columns populated correctly, `source_map` covers all fields as before.
- **Not verified on-device** — the native notification (`notifyCompositionSkipped`) is
  compile-reviewed only; no Android SDK/Bluetooth hardware in this sandbox. Low risk: it mirrors
  the already-device-verified `notifyPendingConfirmation` pattern exactly, and the JS ingest path
  it depends on is fully sandbox-verified above.

## Left open (not this PR)

Raised in the same conversation, not yet decided or built. Recorded in
`docs/owner-action-required.md` §5 (owner decisions):

- **Background-sync notification always-on for a rarely-used device.** The foreground service
  polls every 45s and keeps its "Watching for scale…" notification visible the entire time
  background sync is toggled on, for a scale used ~10s/day. A PendingIntent-based passive BLE
  scan (no persistent notification, only wakes when the scale actually advertises) would fit the
  usage pattern better and cost less battery, but is a real rework of `ScaleGattClient`/
  `ScaleBleService`'s connection strategy — flagged for a future session, not sized or planned yet.
  Owner leans toward this option specifically because it enables frictionless multiple daily
  weigh-ins (see below) without an always-on notification; not yet started.
- **Two-phone household scenario** (both partners running background sync against the same
  physical scale) still hasn't been exercised on-device — carried over from the original PR's
  Known Issues.

---

# Feature: multiple weigh-ins per day (v1.236.0)

## What the owner asked for

Prompted by the notification discussion above: the owner wants to step on the scale whenever —
morning and night — without a second same-day reading overwriting the first. Clarified via
follow-up question: **record full weight + composition for every reading, but the day's earliest
reading is what feeds the trend chart/AI insights.**

## Why this isn't a schema change

`scale_raw_samples` already archives every single weigh-in with full composition and a timestamp
— nothing was ever lost. The only place a second same-day reading caused a problem was
`body_metrics`, which is one row per calendar day and is what every trend chart / AI insight
actually reads. The existing `mergeSet` COALESCE-by-source-rank logic (`lib/data/health-source.ts`)
doesn't help here either: two `scale_ble`-sourced writes on the same day tie on rank, and the CASE
expression's `<=` comparison means the tie always resolves to the newest write (`EXCLUDED.col`),
i.e. "latest wins" — the opposite of what's needed.

## What shipped

- `hasConfirmedScaleTrendForDate(userId, date)` (`lib/data/repository.ts` / `adapter.ts`) — checks
  whether `body_metrics.source_map->>'weight_kg' = 'scale_ble'` already holds for that date.
- `app/api/scale-ble/samples/route.ts` and the pending-confirm route
  (`app/api/scale-ble/pending/[id]/confirm/route.ts`, same gap, fixed as a sibling-surface sweep):
  both now check this before calling `upsertBodyMetrics`. If a scale_ble reading already set
  today's trend, the new reading still archives to `scale_raw_samples` (as it always did) but the
  `upsertBodyMetrics` call is skipped entirely — the trend value is untouched. The multi-user
  weight-anomaly gate is unaffected: only *confirmed* readings count toward "already has today's
  trend," so if the day's first reading was the partner's (staged `pending`, never written), the
  owner's later confirmed reading correctly still becomes the trend.
- `GET /api/scale-ble/today` — returns today's confirmed readings (full decoded composition),
  oldest first, with the first one flagged `isTrend: true`.
- `components/settings/scale-pairing.tsx` — new "Today's weigh-ins" list showing time, weight,
  body-fat%, and a "Trend" tag on the day's first reading.
- `lib/data/postgres/__tests__/scale-ble-multi-reading.test.ts` — 5 new DB-backed tests: the
  trend-check against no row / a different source / a scale_ble row, and the readings list
  including the local-timezone day-boundary case (an 11pm-AEST-previous-day reading must not
  count as "today").

## Verification

- Full local gate re-run after this change: `tsc` clean, lint 0 errors, 343 test files / 2570
  tests passing, `pnpm build` clean.
- Live smoke test against the local dev server: a morning reading (72.55kg) sets the trend
  (`isAdditionalReadingToday: false`); a same-day evening reading (73.9kg) returns
  `isAdditionalReadingToday: true` and does NOT change `body_metrics.weight_kg` (still 72.55);
  `GET /api/scale-ble/today` returns both readings with the first flagged `isTrend: true`.
- **Not verified on-device** — this is a pure server/JS change (no native code touched), so the
  usual native-layer caveat doesn't apply here; the UI list (`scale-pairing.tsx`) should still get
  a quick on-device glance next time the owner opens Settings > Scale, same as any UI change.

---

# Rework: passive BLE scan instead of a continuous foreground service (v1.237.0)

## What the owner asked for

Directly from the notification question above: the owner confirmed they want option 2 (a
different background architecture with no persistent notification), specifically because it's
what lets them weigh in whenever without friction — option 3 (background sync off) would have
required opening the app first, which contradicts that. They also pushed back on "no downsides,"
and asked whether the Polar chest strap works the same way.

## Checked the strap first — it doesn't

Read `PolarStrapService.kt` before writing anything: the strap holds one continuous GATT
connection with escalating backoff (2s → 2min), because it needs to stream HR continuously for a
whole workout — there's no "wake up" moment to scan for. That's a different use case from a scale
that's asleep 99.9% of the time. Answered the owner honestly: no data-safety downside, but this
is genuinely new territory in this codebase (no working precedent to lean on), Samsung's BLE
stack has already bitten this project once on `autoConnect`, and a passive scan is a slightly
weaker OS guarantee than a foreground service if the app is ever put under aggressive battery
restriction. All disclosed before starting the build.

## What shipped

- `ScaleBleScanManager.kt` (new) — `BluetoothLeScanner.startScan(filters, settings, PendingIntent)`
  registration/deregistration. Filtered by the FFE0 service UUID
  (`ScanFilter.setServiceUuid`) — deliberately **not** `ScanFilter.setDeviceAddress()`, since that
  API assumes a PUBLIC BLE address type unless told otherwise and this scale's address type was
  never actually confirmed; guessing wrong there would make the scan silently never fire, which is
  worse than the low, self-correcting cost of a stray FFE0 device nearby triggering a harmless
  failed connect attempt. Matches the exact filter `scale-pairing.tsx`'s pairing flow already uses
  and has proven correct on real hardware.
- `ScaleScanReceiver.kt` (new) — manifest-declared, unexported `BroadcastReceiver` that starts
  `ScaleBleService` when the scan's `PendingIntent` fires (i.e. the paired scale just started
  advertising). This is what lets detection survive the app process being killed, with zero
  ongoing notification while the scale is asleep.
- `ScaleBootReceiver.kt` (new) — re-arms the scan after a reboot/app update, since scan
  registrations don't survive that. Unlike `OuraBootReceiver`, this never attempts to start a
  foreground service directly from `BOOT_COMPLETED`, so it isn't subject to Android's
  `ForegroundServiceStartNotAllowedException` risk on that path at all.
- `ScaleBleService.kt` — removed the 45s perpetual retry loop and `START_STICKY`; now a bounded
  `MAX_ATTEMPTS = 2` connect attempt per scan hit (`START_NOT_STICKY`), since a failure here means
  a transient GATT hiccup, not "asleep," given the scan already confirmed the scale is awake.
  Caught a real bug while writing this: the first draft called `stopSelf()` on a fixed 3s timer
  after a weigh-in, which could tear the service's executor down mid-POST on a slow connection and
  silently drop the reading. Fixed by moving `stopSelf()` into a `finally` block at the true end of
  `postWeighIn()` (covers success, HTTP error, and exceptions) — `stopSelf()` is documented safe to
  call from any thread, so no timer race is needed at all.
- `ScaleBlePlugin.kt` — `startService()`/`stopService()` now arm/disarm the scan
  (`ScaleBleScanManager`) instead of directly starting/stopping a continuously-running service.
- `AndroidManifest.xml` — registered both new receivers. No new permissions needed
  (`BLUETOOTH_SCAN`/`BLUETOOTH_CONNECT`/`RECEIVE_BOOT_COMPLETED` were already declared for the
  Oura ring).
- `ScaleGattClient.kt`/`ScaleProtocol.kt` (the actual connect/handshake/decode logic) — untouched.
- `capacitor-native-init.tsx` — updated the stale comment (referenced `START_STICKY`, which no
  longer exists) and simplified the app-open re-arm to always call `startService()` rather than
  gating on a service `state` check that will now almost always read "stopped" between weigh-ins.

## Verification

- Full local gate: `tsc` clean, lint 0 errors, `pnpm build` clean, 343 test files / 2570 tests
  passing (one flaky-under-parallelism failure — `oura-ble-sleep-staging-rollup`, a documented
  pre-existing flake class, not touched by this change — passed clean on a second full run).
- Manifest XML validated well-formed (`xml.etree.ElementTree`).
- **Not verified on-device — cannot be, in this sandbox.** No Android SDK, no Gradle (proxy-
  blocked), no Bluetooth hardware. All four new/changed Kotlin files are compile-reviewed only.
  The real compile check is the CI "Android (Kotlin tests + debug APK)" job (`./gradlew
  :app:assembleDebug`), which this PR relies on as the actual verification signal before merge —
  see the Known Issues row for what still needs a real weigh-in to confirm (prompt detection,
  boot re-arm, filter false-positive rate in practice).
