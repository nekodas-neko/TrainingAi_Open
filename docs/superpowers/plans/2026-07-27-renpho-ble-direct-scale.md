# Renpho ES-20M — Direct-BLE Scale Integration

**Branch:** `claude/bluetooth-scale-integration-jcuvs2` (this doc is the planning PR;
implementation continues on the same branch). **Status:** R&D / planning only — nothing in
this doc has been built. Owner has a Renpho ES-20M (same white-label board family as the
ES-CS20M / Elis 1 / "QN-Scale") today; Health Connect only ever gets `weightKg` + `bodyFatPct`
from it (`lib/health-connect-sync.ts` `HC_SYNC_READ_TYPES` never requested Bone Mass / Lean
Body Mass / Body Water Mass / BMR, and Health Connect has **no record type at all** for
Skeletal Muscle %, Subcutaneous Fat %, Visceral Fat, Protein %, or Metabolic Age — those five
can never cross HC regardless of what we wire up there). Direct BLE is the only way to ever
land the full metric set the Renpho app already shows.

**Goal:** read the scale's weigh-in notification directly over BLE (bypassing the Renpho app
and Health Connect entirely), decode weight + bioimpedance, compute the same category of body-
composition metrics the Renpho app shows, and land them in `body_metrics` with proper
provenance — closing the gap the owner hit in this session's conversation, **while the app is
merely backgrounded (not force-closed)**, per the 2026-07-27 follow-up conversation.

**Architecture — REVISED (was pure-TS, now a native Kotlin foreground service):** the original
draft of this plan used pure TypeScript via `@capacitor-community/bluetooth-le`, foreground-only
(app open, user taps "Weigh in"). The owner instead wants capture to work **as long as the app
is backgrounded**. That rules out the pure-TS design outright: `lib/live-hr/chest-strap-
source.ts`'s own comment confirms "the in-WebView path ... is suspended when backgrounded" — the
WebView's JS simply stops running once Android backgrounds the app, so no JS-only BLE code can
react to anything while backgrounded, no matter how it's written.

The only pattern in this codebase that survives backgrounding is a **native Kotlin foreground
service** — exactly `PolarStrapService`'s shape
(`android/app/src/main/java/com/trainingai/app/polar/PolarStrapService.kt`), which exists for
precisely this reason ("Holds the all-day chest-strap connection so the strap streams HR even
with the screen off / app backgrounded"). This plan now follows that pattern instead of the
Oura/Polar-avoidant approach originally proposed. See Phase 1 below.

**Tech stack:** native Kotlin (`android/app/src/main/java/com/trainingai/app/scale/`) mirroring
the Polar package 1:1, Drizzle/Postgres, the existing `lib/data/health-source.ts` per-field
provenance system. No new Android permissions — `BLUETOOTH_SCAN` (`neverForLocation`),
`BLUETOOTH_CONNECT`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_CONNECTED_DEVICE` are already
declared in `AndroidManifest.xml` (lines 102-108) for the Polar/Oura services and cover this too.

---

## 0. Mental model — two tiers, not three

Unlike the Oura ring (ring / phone-ecore / cloud), a BIA scale has two:

| Tier | Where | What it produces | Reachable by us? |
|---|---|---|---|
| **Scale** | on-device BIA hardware | weight (kg) + raw bioimpedance (Ω) at 50kHz, via a GATT notification after a handshake | ✅ over BLE — this is the whole value proposition |
| **App** | Renpho's phone app | body fat / skeletal muscle / water / bone / visceral fat / protein / BMR / metabolic age — computed from impedance + the user's stored profile (height/age/sex) using **Renpho's own unpublished formula** | ❌ not reachable — we substitute a published BIA formula (Deurenberg-family, same one the `openScale`/`ble-scale-sync` community drivers use) |

**Consequence:** our computed body-fat/muscle/etc. numbers will be close to, but not
numerically identical to, what the Renpho app shows for the same weigh-in — same physiological
category of estimate, different formula. This is a known, accepted tradeoff (see the "is it
fake data" discussion this session) — the numbers are real BIA-derived estimates, useful for
trend tracking, just not a pixel-match to Renpho's app.

---

## 1. Honest inventory

**Reachable:**
- Weight (kg) — exact match to what the scale itself measures.
- Raw impedance (Ω) — the same input Renpho's own formula uses.
- Body fat %, skeletal muscle %, fat-free mass, body water %, muscle mass, bone mass, protein
  %, BMR, visceral fat, metabolic age — all **derivable from weight + impedance + user profile**
  via a public BIA formula. `users.heightCm` / `users.dateOfBirth` / `users.sex` already exist
  (`lib/data/postgres/schema.ts:15,16,22`) — no new profile fields needed.

**Not reachable:**
- Renpho's exact proprietary formula / exact displayed numbers (unpublished).

**RESOLVED by Phase 0 (see results section below):** this unit is GATT-connectable and returns
real impedance, not broadcast-only/BMI-estimated. Confirmed on-device with real weigh-ins.

---

## 2. Protocol references (read these during implementation, not from memory)

Per this repo's own external-API rule ("verify against the pinned source, not memory or
generic docs"), the exact GATT service/characteristic UUIDs, the `AE00`-service handshake
sequence, and the byte offsets of the weight/impedance notification must be read from:

1. **Primary:** [`KristianP26/ble-scale-sync`](https://github.com/KristianP26/ble-scale-sync)
   — TypeScript (same language as this codebase), actively maintained, explicitly documents a
   "QN Scale adapter rewritten as a notification-driven state machine ... requires an AE00
   service handshake before measurement data flows" for the Renpho Elis 1 / ES-CS20M family.
   Read `src/adapters/` for the QN-Scale/Renpho adapter file directly (this session's web
   access 404'd on guessed paths — an implementer session with repo browse access should
   locate the exact filename).
2. **Cross-check:** [`oliexdev/openScale`](https://github.com/oliexdev/openScale) —
   `android_app/app/src/main/java/com/health/openscale/core/bluetooth/BluetoothQNScale.java`.
   Older/Java, but a second independent implementation of the same protocol to validate against.

**Update:** the byte layout and checksum below are no longer unverified — see "Phase 0 RESULTS"
above, captured and cross-checked against 4 real packets from the owner's actual scale. Still
worth reading the upstream sources for anything not covered by the captures (e.g. what the two
impedance fields individually represent), but the core packet format is now a pinned, real test
vector, not a guess.

---

## Phase 0 RESULTS (2026-07-27 — DONE, on the owner's actual ES-20M)

**Verdict: GATT-connectable, real impedance data confirmed. Green light for Phase 1/2.**

Captured live via nRF Connect against the owner's scale (advertises as `QN-SCALE`, MAC
`A4:C1:38:ED:B4:07` — OUI `A4:C1:38` is Espressif, confirming an ESP32-class BLE chip).
Service `0xFFE0` with characteristics `FFE1` (notify, weight/impedance stream), `FFE2`
(indicate, never observed firing — unused by this firmware revision as far as captured),
`FFE3`/`FFE4`/`FFE5` (write). No OS-level Bluetooth pairing/bonding involved (`NOT BONDED`
throughout).

**Working sequence:** subscribe to `FFE1` notifications → write `13 09 15 01 10 00 00 00 42` to
`FFE3` → step on scale and **stay standing ~25-30s** (weight settles in ~1s, but the scale
needs several more seconds after that to complete the actual bioimpedance measurement before
sending the final packet — stepping off early only ever yields the unstable packet, repeated).

**Packet format on `FFE1` (11 bytes), verified against 4 independent real captures:**

| Offset | Field | Notes |
|---|---|---|
| 0 | `0x10` | packet-type marker |
| 1 | `0x0B` | = 11 decimal = total packet length; constant across all captures |
| 2 | `0x15` | echoes byte 2 of the `FFE3` request command (`13 09 **15** 01 ...`) |
| 3-4 | weight | big-endian uint16, **÷ 100 = kg** |
| 5 | stable flag | `0x00` while measuring, `0x01` once the reading (incl. impedance) is final |
| 6-7 | impedance A | big-endian uint16, zero until byte 5 = `0x01`; observed 505 (Ω-range, plausible) |
| 8-9 | impedance B | big-endian uint16, zero until byte 5 = `0x01`; observed 503 — very close to impedance A |
| 10 | checksum | **`sum(bytes 0-9) mod 256`** — verified exactly against all 4 captures (e.g. 757 mod 256 = 0xF5) |

**Example captures (owner's real weigh-ins, ~70-71 kg range across attempts):**
```
10-0B-15-1B-9E-00-00-00-00-00-E9   (unstable, 70.70 kg)
10-0B-15-1B-B2-00-00-00-00-00-FD   (unstable, 70.90 kg)
10-0B-15-1B-B7-00-00-00-00-00-02   (unstable, 70.95 kg)
10-0B-15-1B-B7-01-01-F9-01-F7-F5   (STABLE, 70.95 kg, impedance 505/503)
```

**Open question for Phase 1 (not blocking, just unresolved):** whether impedance A/B are two
separate measurement legs (left/right foot), two frequencies, or a resistance/reactance pair.
Not needed to implement the BIA formula (most published formulas use a single impedance value —
average A/B, or use A alone and treat B as a cross-check) but worth reading against the
`ble-scale-sync`/`openScale` source (§2) once accessible, rather than guessing further.

**Also confirmed:** an initial handshake-looking packet (`12-0F-15-...`, byte 0 = `0x12`, not
`0x10`) fires automatically on subscribe, before any `FFE3` write — contains what look like
fragments of the scale's own MAC address. Not needed for the weight/impedance flow; ignore it
in the decoder (a real data packet always starts `0x10`).

---

## Phase 0 — On-device protocol confirmation spike (cheap, do first, no code)

**Goal:** answer the one unconfirmed fact in §1 before writing a single line of Phase 1 code.

1. Install a generic BLE inspector (e.g. nRF Connect) on the phone that has the Renpho app.
2. Power on the ES-20M, scan, and confirm:
   - It advertises as `QN-Scale` (or similar) per the community reports, and
   - It exposes a **connectable GATT service** (not broadcast-only) — specifically look for a
     custom service in the `AE00`-adjacent UUID range that `ble-scale-sync` describes.
3. Connect via nRF Connect, subscribe to notifications on the relevant characteristic, step on
   the scale for a real weigh-in, and capture the raw notification bytes.
4. Compare the captured weight bytes against the simultaneous Renpho app reading (sanity check
   that we're reading the right characteristic before any Phase 1 investment).

**Decision gate:**
- **GATT-connectable, impedance present in the payload** → proceed to Phase 1.
- **Broadcast-only / weight-only** → **stop.** Document the finding in this file (append a
  "Phase 0 results" section) and remove the RS-1 backlog entry — this scale isn't worth
  building for; it would net out worse than the status quo (Health Connect already gives
  weight + fat%).

This phase needs the owner's phone + scale together — it cannot be done in the sandbox.

---

## Phase 1 — Native Kotlin foreground service (mirrors PolarStrapService)

**Files:**
- Create: `android/app/src/main/java/com/trainingai/app/scale/ScaleProtocol.kt` — pure decode
  functions (packet framing, weight/impedance extraction, the BIA formula translated from
  §2's pinned reference). Kept pure/no-Android-API so it's unit-testable in isolation, same
  role as `OuraProtocol.kt` in the Oura package.
- Create: `android/app/src/main/java/com/trainingai/app/scale/ScaleGattClient.kt` — owns the
  actual `BluetoothGatt` connect/handshake/subscribe cycle against the scale's confirmed `FFE0`
  service (mirrors `PolarGattClient.kt`'s shape): connect, discover services, subscribe to
  `FFE1` notifications, write `13 09 15 01 10 00 00 00 42` to `FFE3` (the pinned request command
  from Phase 0 RESULTS), wait for a frame with byte 5 = `0x01` (bounded ~30s timeout — the
  unstable packets on the way there are expected and ignored), emit the decoded frame via a
  listener interface, disconnect.
- Create: `android/app/src/main/java/com/trainingai/app/scale/ScaleBleService.kt` — the
  foreground service, mirroring `PolarStrapService.kt` almost exactly, with one key behavioural
  difference: **Polar's service holds one continuous connection to a strap that's worn the
  whole time; this service instead runs a periodic low-power BLE scan for the paired scale's
  advertisement, and only connects when it sees the scale wake up** (stepping on triggers the
  scale to start advertising). On seeing the advertisement:
  1. Connect via `ScaleGattClient`.
  2. Run the handshake, wait (bounded timeout — a real weigh-in settles in ~5-10s, allow ~30s)
     for a valid weight+impedance frame.
  3. On success: POST directly to `/api/scale-ble/samples` using **the same native-HTTP +
     shared-cookie pattern `PolarStrapService` already uses** (`CookieManager.getInstance()
     .getCookie(base)` → `Cookie` header, lines ~297-311 of `PolarStrapService.kt`) — this is
     what answers "how does it know whose data": whichever TrainingAI account's session
     cookie is currently live in the WebView's cookie jar is who the reading gets attributed
     to, exactly like `/api/hr-ingest` already does for the chest strap. No new auth scheme.
  4. Disconnect, resume scanning.
  5. On failure/timeout: disconnect, resume scanning, no reading lost silently — log via the
     existing `eventSink` pattern so a foregrounded app can show "last sync attempt failed."
- Create: `android/app/src/main/java/com/trainingai/app/scale/ScaleBlePlugin.kt` — Capacitor
  bridge, mirroring `PolarBlePlugin.kt` method-for-method: `setDevice`/`hasDevice`/
  `clearDevice` (paired scale's MAC), `ensurePermissions`, `startService`/`stopService`
  (background sync **is opt-in** — see below), `getStatus`, `setIngestUrl`.
- Create: `lib/scale-ble/plugin.ts` — JS wrapper, mirrors `lib/polar-ble/plugin.ts` 1:1
  (same `getScaleBle()` guarded-registration shape).
- Create: `components/settings/scale-pairing.tsx` — mirrors
  `components/settings/chest-strap-pairing.tsx`: scan/pick/save-deviceId UI, **plus a
  "Sync scale in background" toggle** that calls `startService`/`stopService` — background
  scanning must be opt-in, not automatic, so a user without this scale (or who doesn't want
  the persistent foreground-service notification) never pays the battery/notification cost.
  The foreground-service notification itself (Android requires one while the service runs)
  should read something low-key like "TrainingAI — watching for scale," matching the existing
  Polar/GPS-tracking notification style already accepted in this app.

**Why not the pure-TS `BleClient` approach from the original draft:** it only works while the
WebView is foregrounded. The owner's requirement ("as long as the app is backgrounded") is
exactly the case that approach cannot satisfy — confirmed by `chest-strap-source.ts`'s own
comment on why the native Polar service exists in the first place.

**Verify (sandbox):** unit tests for `ScaleProtocol.kt`'s byte decoding against a captured test
vector from Phase 0 (JVM-testable, no Android instrumentation needed), and for the BIA formula
against known reference inputs/outputs from the `ble-scale-sync`/`openScale` source. **Verify
(on-device only, requires an owner APK rebuild per Canonical Runtime):** the actual periodic
scan → wake-detect → connect → handshake → notify → POST cycle, backgrounded, against the real
scale — cannot be exercised in this sandbox (no Android SDK, no Bluetooth hardware).

---

## Phase 2 — Server landing + schema

### Migration 145 — new archival table + `body_metrics` columns

Claim **145** against the on-disk max (144, confirmed this session). One migration file, both
pieces (small enough not to need splitting).

**Update at merge time:** by the time this branch merged, another PR had already landed on `main`
using migration number 145 (`145_running_plan_session_length.sql`) — the classic parallel-PR
migration-number collision this repo's own CLAUDE.md warns about. The file actually shipped as
**`157_scale_ble.sql`** (the next free number against `main`'s state at merge time — this shifted repeatedly, 145 → 153 → 155 → 157, as parallel PRs kept landing).
Everything below still says "145" as written during planning — read it as "the scale-ble
migration," not a literal number.

```sql
-- 145_scale_ble.sql
CREATE TABLE scale_raw_samples (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  measured_at TIMESTAMPTZ NOT NULL,
  raw_hex     TEXT NOT NULL,
  decoded     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_scale_raw_samples_user_time ON scale_raw_samples (user_id, measured_at DESC);

ALTER TABLE body_metrics ADD COLUMN skeletal_muscle_pct    DOUBLE PRECISION;
ALTER TABLE body_metrics ADD COLUMN fat_free_mass_kg        DOUBLE PRECISION;
ALTER TABLE body_metrics ADD COLUMN subcutaneous_fat_pct    DOUBLE PRECISION;
ALTER TABLE body_metrics ADD COLUMN visceral_fat_index      DOUBLE PRECISION;
ALTER TABLE body_metrics ADD COLUMN body_water_pct          DOUBLE PRECISION;
ALTER TABLE body_metrics ADD COLUMN muscle_mass_kg          DOUBLE PRECISION;
ALTER TABLE body_metrics ADD COLUMN bone_mass_kg            DOUBLE PRECISION;
ALTER TABLE body_metrics ADD COLUMN protein_pct             DOUBLE PRECISION;
ALTER TABLE body_metrics ADD COLUMN bmr_kcal                INTEGER;
ALTER TABLE body_metrics ADD COLUMN metabolic_age           INTEGER;
```

This mirrors `oura_raw_samples` (`lib/data/postgres/schema.ts:875-884`) — archival `raw_hex`
kept forever so a later formula fix can redecode history, `decoded` jsonb is the disposable
best-effort snapshot. No ring-clock-anchor complexity needed (unlike Oura) — a weigh-in is a
synchronous, one-shot read, so `measured_at` is just wall-clock time at capture.

**`lib/data/postgres/schema.ts`:**
- Add `scaleRawSamples` table definition (mirror `ouraRawSamples` at line 875, drop the
  `tag`/`eventName`/`ringTimestampDs` fields — not needed for a single-notification-type
  device).
- Add the 10 new `bodyMetrics` columns after `neckCm` (`lib/data/postgres/schema.ts:226`).

**`lib/data/health-source.ts`:**
- Add `'scale_ble'` to `HEALTH_SOURCES` (line 16), ranked **between `oura_ble` and `manual`**
  (a direct scale reading is a real device measurement, more authoritative than any BLE/cloud
  wearable-derived estimate for weight/body-comp fields, but a user's own manual entry should
  still be able to override it): `health_connect: 1, oura_cloud: 2, oura_ble: 3, scale_ble: 4,
  manual: 5`.
- Update `storedRankSql`'s CASE expression (line 41-42) to include `WHEN 'scale_ble' THEN 4`
  and bump `'manual'` to 5.

**`lib/data/postgres/adapter.ts`:**
- Add the 10 new fields to `BODY_METRICS_SOURCE_COLS` (line 76-87).
- Add the 10 new fields to `upsertBodyMetrics`'s value-building object (line 1737-1748) and to
  `listBodyMetrics`'s row mapping (line 1765 onward).

**New route:** `app/api/scale-ble/samples/route.ts` (mirror `app/api/oura-ble/samples/route.ts`
— both its `auth()` session-cookie gate, lines 47-49, and its shape) — accepts `{ weightKg,
impedanceOhms, rawHex, measuredAt }` from the Phase 1 native service (posted with the shared
session cookie, per Phase 1 above — this is what attributes the reading to the right user with
no new auth scheme), inserts a `scale_raw_samples` row, calls `computeBodyComposition` from
`lib/scale-ble/composition.ts` (pure formula module — kept in TS even though the native decode
is in Kotlin, since this repo's "One Formula, One Place" rule wants exactly one implementation;
the Kotlin side sends raw weight+impedance, this route does the composition math) using the
session user's `heightCm`/`dateOfBirth`/`sex`, and calls `repo.upsertBodyMetrics(userId, [...],
'scale_ble')` with all 12 fields (weight, body fat, plus the 10 new columns). **This is the
"normal" path — see the "Multi-user safety net" section below for the anomaly-check branch that
gates whether this upsert happens immediately or waits for confirmation.**

### Local SQLite + offline-sync mirroring (same PR, per the Offline Sync strict rule)

- `lib/sqlite/migrations.ts`: add the 10 new columns to both `CREATE_BODY_METRICS` blocks
  (lines 443 and ~750) and register each as an additive `RECONCILE_COLUMNS` entry (mirror the
  `waist_cm`/`chest_cm`/etc. block at lines 290-295) — same commit, per the strict Local SQLite
  Migrations rule (a column missing from `RECONCILE_COLUMNS` is invisible after a partial
  upgrade).
- Grep `getSyncDelta`/`pullDelta`/`applyDelta` for the existing `bodyFatPct` handling and add
  the 10 new fields alongside it in each — `body_metrics` is already a synced local-first
  domain (weight/bodyFat/macros/etc. all round-trip today), this is purely adding columns to an
  existing pipeline, not a new domain.

**Verify (sandbox):** migration applies cleanly against local Postgres (`pnpm db:local`);
`pnpm test` for the health-source rank/merge tests (`lib/data/postgres/__tests__/health-source-
merge.test.ts`, `body-metrics-push-source.test.ts` — extend both for `scale_ble`); local SQLite
reconcile test. **Verify (on-device):** an actual scale reading lands in `body_metrics` with
`source_map` correctly stamped `scale_ble` per field, visible after an app restart (local-first
read).

---

## Multi-user safety net — weight-anomaly confirmation (owner requirement, added 2026-07-27)

Owner's partner also uses this physical scale. Attribution in this plan is "whichever account's
session cookie is live on this phone" (Phase 1) — there's no per-person recognition on the wire,
so a background-captured reading could belong to either person if both weigh in on the same
scale. Renpho's own app solves this with weight-based auto-recognition against multiple stored
profiles; we don't need that whole system — just a **safety net** so a partner's weigh-in never
silently overwrites the owner's own weight history. This is the "how Renpho does it now"
behaviour the owner asked for, scoped down to what's actually needed.

**Rule:** compare the incoming weight against the user's most recent **confirmed**
`body_metrics.weight_kg`. If `abs(new - last) / last > 0.15` (15%, a named constant
`SCALE_WEIGHT_ANOMALY_PCT` in `lib/scale-ble/composition.ts` — easy to retune later, not exposed
as a user-facing setting for now per YAGNI), stage the reading as **pending** instead of
auto-saving, and prompt for confirmation. No prior confirmed weight (brand new user), or delta
within threshold → auto-confirm exactly as the Phase 2 route description above already says.

**Schema addition (same migration 145 file):**
```sql
ALTER TABLE scale_raw_samples ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed';
-- values: 'confirmed' | 'pending' | 'dismissed'
```
Reuses the archival table already planned rather than adding a new one. `body_metrics` is only
written once a row's status becomes `'confirmed'`.

**`app/api/scale-ble/samples/route.ts` — full branch logic:**
1. Look up the user's most recent `body_metrics` row where `weight_kg IS NOT NULL`.
2. No prior row, or `abs(new - last)/last <= 0.15` → insert `scale_raw_samples` with
   `status='confirmed'`, run `computeBodyComposition` + `upsertBodyMetrics(..., 'scale_ble')`.
   Return `{ status: 'confirmed', weightKg }`.
3. Otherwise → insert `scale_raw_samples` with `status='pending'`, do **not** touch
   `body_metrics` yet. Return `{ status: 'pending', weightKg, lastWeightKg, deltaPct }`.

**New routes:**
- `GET /api/scale-ble/pending` — session-authenticated, lists the current user's
  `status='pending'` rows, newest first.
- `POST /api/scale-ble/pending/[id]/confirm` — ownership-checked (row's `user_id` must match the
  session, per this repo's write-path ownership rule), flips `status='confirmed'`, runs the same
  `computeBodyComposition` + `upsertBodyMetrics` the normal path would have run immediately.
- `POST /api/scale-ble/pending/[id]/dismiss` — ownership-checked, flips `status='dismissed'`.
  The row stays in `scale_raw_samples` forever (archival, matches the never-delete
  `oura_raw_samples` convention) but never reaches `body_metrics`.

**Notification — fires from native Kotlin, not JS** (same reason as everything else
backgrounded in this plan: JS is suspended). When `ScaleBleService.kt`'s POST to
`/api/scale-ble/samples` gets back `{ status: 'pending', ... }`, it fires a local Android
notification directly via `NotificationManager` — new channel (e.g. `scale-ble-pending`),
registered alongside `WORKOUT_TIMERS_CHANNEL`/`MEAL_REMINDERS_CHANNEL` in
`components/capacitor-native-init.tsx` per the capacitor-native-plugins skill's channel pattern —
reading something like **"Unusual weigh-in: 55.2 kg (usual ~71 kg) — tap to confirm it's you."**
Tapping it opens the app to the pending-confirmation UI below.

**UI:** `components/settings/scale-pairing.tsx` (already being created in Phase 1) gets a
**"Pending weigh-ins"** section — fetches `GET /api/scale-ble/pending`, shows each entry with
its weight + delta-from-usual, and Confirm/Dismiss buttons wired to the routes above. This is
also where the notification tap should deep-link (mirror whatever mechanism this app's other
local notifications already use to route to a specific screen on tap).

**Deliberately not built:** actual per-person weight-profile recognition (Renpho's own
multi-user matching against several stored profiles) — this is a simpler one-account anomaly
gate, sufficient to stop a partner's weigh-in from silently landing in the owner's history,
without the complexity of matching against multiple profiles. If the owner's partner later wants
their *own* TrainingAI account tracking their *own* scale history, they'd pair the same scale
from their own phone/account — same flow, independent history, no extra design needed (see the
Risks section below for the connection-contention implication of two phones sharing one scale).

---

## Phase 3 — UI surfacing

Check `components/health/` (or wherever body-metrics/body-composition is currently displayed —
likely alongside the existing weight/body-fat trend) for the existing card(s) and extend them
to show the 10 new metrics, following this repo's existing conventions:
- `scoreBand()`-style labels are NOT applicable here (these aren't 0-100 scores) — display as
  plain value + unit, matching how `waistCm`/`chestCm`/etc. circumference fields are already
  shown.
- No colour-only state (existing rule) — if any of these get a "high/low/average" badge later,
  pair it with the label the way `scoreBand()` results are always paired.
- Respect the semantic-palette/theme-token rules for any new chart/sparkline.

This phase is deliberately left less detailed than Phases 1-2 — the exact component to extend
depends on what Phase 1/2 land looks like and should be scoped by whoever picks this up, after
confirming the current body-composition display location.

---

## Risks / open questions

- **Protocol drift:** community-reverse-engineered, can shift on a scale firmware update —
  same category of risk as Oura BLE, smaller blast radius (one weigh-in fails to parse, not a
  whole night's data).
- **Single BLE central + background race (new, from the backgrounded-sync requirement):** only
  one app can hold the scale's GATT connection at a time. If the background service's scan
  happens to be mid-connect at the same moment someone opens the Renpho app to weigh in, one of
  the two loses the race — acceptable (rare, and the whole point is to stop depending on the
  Renpho app), but worth knowing about rather than being surprised by an occasional missed
  reading. **This gets more likely, not just theoretical, once the owner's partner also has this
  service running on their own phone against the same physical scale** — whichever phone's scan
  happens to grab the connection first captures that weigh-in; the other phone just times out
  with no reading that time. Not a data-integrity problem (each phone only ever checks its own
  account's anomaly threshold — see "Multi-user safety net" above), just an occasional missed
  capture for whichever person didn't win the race. No fix needed; both people simply weigh in
  and whichever phone connects, connects.
- **Battery cost of periodic background scanning:** non-zero, though far cheaper than a held
  connection — this is exactly why the background-sync toggle in `scale-pairing.tsx` must
  default **off**, so only users who actually opt in pay for the persistent foreground-service
  notification + scan cycles. Tune the scan interval/duty cycle empirically on-device; start
  conservative (e.g. scan a few seconds every 30-60s) rather than continuous.
- **Android Doze / battery optimization:** a foreground service is Doze-exempt while running,
  but aggressive OEM battery managers (Samsung's included) can still kill background services;
  same accepted caveat as the existing Polar ambient service — no new exposure, just worth the
  same on-device longevity check.
- **Formula mismatch is permanent, not a bug** — see §0. Don't spend effort chasing an exact
  match to Renpho's displayed numbers; the goal is a consistent, trend-usable estimate.
- **Metabolic age is the lowest-value field** (previously discussed this session — it's just
  BMR re-expressed as an age number, no new trend signal). Capture it since it's free once BMR
  is computed, but don't prioritize UI work around it.

## What this plan does NOT cover

- The Health Connect pipeline gap (Bone Mass / Lean Body Mass / Body Water / BMR record types
  Health Connect *does* support but `HC_SYNC_READ_TYPES` never requested) — raised earlier this
  session as a smaller, BLE-independent fix. Not needed once this plan lands (BLE supersedes it
  for this scale), but could still be worth doing independently for other Health-Connect-only
  devices. Not in scope here.
