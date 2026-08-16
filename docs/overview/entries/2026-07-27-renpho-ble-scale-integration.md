# 2026-07-27 — Direct-BLE Renpho ES-20M scale integration

**Branch:** `claude/bluetooth-scale-integration-jcuvs2` · **Version:** v1.213.0

Owner-directed session, started from a question about whether a random Kmart scale would be
useful, which turned into pairing the owner's actual Renpho ES-20M directly over Bluetooth.
Health Connect only ever forwarded `weightKg`/`bodyFatPct` from it, and structurally can never
carry Skeletal Muscle %, Subcutaneous Fat %, Visceral Fat, Protein %, or Metabolic Age — Health
Connect has no record type for any of those five. Plan:
`docs/superpowers/plans/2026-07-27-renpho-ble-direct-scale.md` (revised twice mid-session: once
when the owner asked for capture to survive backgrounding, ruling out the original pure-TS
design; once to add a multi-user safety net once the owner mentioned their partner shares the
scale).

## Phase 0 — real protocol capture, not memory or generic docs

Before writing any code, the owner ran a live capture via nRF Connect against the actual scale.
That's the one part of this session done by hand, not by the agent — and it's what makes the
rest trustworthy: the scale advertises as `QN-SCALE`, exposes a custom GATT service `0xFFE0`
(characteristics `FFE1` notify / `FFE2` indicate, unused / `FFE3`-`FFE5` write), and a specific
9-byte command (`13 09 15 01 10 00 00 00 42`) written to `FFE3` triggers real weigh-in
notifications on `FFE1`. Four independent real packets were captured and hand-decoded during the
conversation, landing on a fully verified 11-byte format — weight (bytes 3-4 ÷ 100), a
stable/unstable flag (byte 5), two impedance fields (bytes 6-9), and a checksum
(`sum(bytes 0-9) mod 256`) confirmed exactly against all four captures. This is now written into
the plan's "Phase 0 RESULTS" section as the pinned reference, and reused verbatim in
`ScaleProtocol.kt`'s decoder and its unit tests.

## What shipped

**Server (fully sandbox-verified):**
- Migration 157 (145, then 153, then 155, were already taken by other PRs on `main`): `scale_raw_samples` (archival, never-deleted raw_hex + best-effort decode +
  a `status` column for the safety net below) and 10 new `body_metrics` columns.
- `lib/scale-ble/composition.ts` — the BIA formula turning weight+impedance+profile into the
  10 fields. Explicitly documented as a generic estimator (Deurenberg-family body-fat% +
  standard published physiological ratios), **not** Renpho's own unpublished algorithm — the
  numbers will be close to, not identical to, what the Renpho app shows for the same weigh-in.
- `scale_ble` added to the `lib/data/health-source.ts` provenance system, ranked above
  `oura_ble`/`health_connect` (a direct device reading) but below `manual` (the user's own entry
  should still win).
- `POST /api/scale-ble/samples`, `GET /api/scale-ble/pending`,
  `POST /api/scale-ble/pending/[id]/confirm`, `POST /api/scale-ble/pending/[id]/dismiss`.
- Local SQLite + sync-delta/pull mirroring for the 10 new `body_metrics` columns (three call
  sites in `sqlite-backend.ts`, `sync-engine.ts`'s pull mapping, and four client call sites that
  construct a `LocalBodyMetric` literal).

**Multi-user safety net (added mid-session once the owner mentioned their partner uses the same
scale):** a reading more than 15% off the account's last confirmed weight is staged `status:
'pending'` instead of auto-saved. The native service gets `{status:'pending', ...}` back from
the POST and fires a local Android notification (native `NotificationManager`, not the JS
`LocalNotifications` plugin, since it must fire while fully backgrounded); tapping opens the app,
and Settings > Profile shows a Confirm/Dismiss list. Dismissed readings stay archived in
`scale_raw_samples` but never reach `body_metrics`.

**Native Kotlin (compile-reviewed only, NOT device-tested — see below):**
`android/.../scale/ScaleProtocol.kt` (pure decoder + the pinned command bytes),
`ScaleGattClient.kt` (connect → subscribe → write request → wait for a stable packet, mirrors
`PolarGattClient`'s queue/state-machine shape), `ScaleBleService.kt` (foreground service —
periodic *connect attempts* on a fixed interval rather than Polar's escalating backoff, since the
scale being asleep is the normal case here, not a failure to back off from), `ScaleBlePlugin.kt`
(Capacitor bridge, mirrors `PolarBlePlugin` method-for-method). Registered in `MainActivity.java`
and `AndroidManifest.xml` (reuses the already-declared `BLUETOOTH_SCAN`/`BLUETOOTH_CONNECT`/
`FOREGROUND_SERVICE*` permissions — no new manifest permissions needed).

**UI:** `components/settings/scale-pairing.tsx` (pair/forget, a "Sync in background" toggle
defaulting off, and the pending-confirmation list), wired into Profile settings next to the
existing chest-strap pairing card. `components/capacitor-native-init.tsx` restarts the background
service on app open if the owner left the toggle on (mirrors the existing Oura auto-start block).

## Why native Kotlin instead of the simpler pure-TS design

The first draft of the plan used `@capacitor-community/bluetooth-le` directly from TypeScript,
foreground-only (open app, tap "Weigh in"). The owner asked for capture to keep working "as long
as the app is backgrounded" — which the pure-TS design cannot do at all:
`lib/live-hr/chest-strap-source.ts`'s own comment already documents that the in-WebView BLE path
is suspended the moment Android backgrounds the app. That is exactly why `PolarStrapService`
exists as native Kotlin, so this plan was revised to follow the same pattern instead.

## Verified in-sandbox

- `tsc` clean, `pnpm lint` 0 errors (all pre-existing warnings, none in new files), **2075 tests
  passing**, `pnpm build` clean — all four new routes appear in the route table.
- Migration 157 applied cleanly to the local dev DB; new table + columns confirmed present.
- Migration 158 regenerates the `claude_ro` readonly views to cover the new `scale_raw_samples`
  table, fixing the `claude-ro-readonly-role.test.ts` completeness check (it hardcodes the latest
  views-regen migration filename and reapplies it in `beforeAll`).
- 7 new unit tests for `computeBodyComposition` (physiological ranges, weight reconstruction,
  age/impedance/sex sensitivity, a hand-checked Mifflin-St Jeor BMR value).
- **Full dev-server round trip against the real captured data**, via `curl` with a logged-in
  session: a first-ever weigh-in (70.95 kg, impedance 505/503 — the owner's actual Phase 0
  capture) auto-confirms and lands correctly in `body_metrics` with `source_map` stamped
  `scale_ble` on every field (body fat 17.8%, skeletal muscle 43.6%, BMR 1665 kcal, etc. — all
  physiologically sane for the profile used). A simulated 55 kg reading (22.5% off) correctly
  stages as `pending` without touching `body_metrics`; `dismiss` archives it without writing;
  a second pending reading (60 kg, 15.4% off) correctly writes through on `confirm`. Auth
  (401 unauthenticated), payload validation (400 on garbage), and ownership (404 on someone
  else's/nonexistent pending id) all behave as expected.

## NOT verified — device-gated

The entire native Kotlin layer is inert in the sandbox (no Android SDK, Gradle download is
proxy-blocked, no Bluetooth hardware) — `ScaleProtocol.kt`'s decoder was hand-verified against
the real captured bytes and mirrors `PolarProtocol.kt`'s proven shape, but that is not a
substitute for running it. Specifically unproven until an APK rebuild + on-device run:

1. Whether `ScaleGattClient`'s actual `BluetoothGatt` connect/discover/subscribe/write sequence
   works against the real scale the way the JVM-only decoder tests assume.
2. Whether `ScaleBleService`'s periodic-reconnect loop reliably catches the scale waking up, and
   at what battery cost, with the 45s retry interval chosen (a guess, not yet tuned on-device).
3. Whether the native-fired pending-confirmation notification actually appears and routes back
   into the app correctly while fully backgrounded.
4. The two-phone scenario (owner + partner both running background sync against one physical
   scale) — expected to occasionally miss a reading on whichever phone loses the BLE connection
   race, not a data-integrity issue, but unverified.
5. Safe-area/Samsung-WebView rendering of the new Settings card.

## Follow-up found, not fixed

The Health Connect pipeline gap discussed earlier in the session (`HC_SYNC_READ_TYPES` never
requesting Bone Mass/Lean Body Mass/Body Water/BMR, which Health Connect *does* support) is
superseded by this plan for this scale, but was never itself fixed — noted here rather than
silently dropped, in case a future non-BLE Health-Connect-only device needs it.
