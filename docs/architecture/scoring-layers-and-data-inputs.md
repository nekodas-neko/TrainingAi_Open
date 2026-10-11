# Scoring layers and data inputs

_Written 2026-10-11 for jsboiss, who is leading the move to a native app. It describes `main` as of
`0e2df9995d`: how a score is built, where every piece of data comes from, what each source cannot
do, what a native app has to keep, and how work moves through the repo. Each section links to the
deeper doc._

## In one minute

- **Every number sits on one of five layers**, fixed in this order by the owner on 2026-10-11:
  `source → metric → unit → score → root`. These are working names, not final ones. Devices plug in
  only at the bottom, and nothing above the metric layer is meant to know which device a value came
  from.
- **A few units can act on readiness directly.** Duration, overnight HRV, resting HR, training load,
  temperature and breathing rate can move readiness outside their score pillar's average: through
  the illness check today, and through proposed caps in the new model.
- **The only supported runtime is the APK on the owner's Samsung S25 Ultra**: a Capacitor WebView
  that loads the Next.js app from Railway, plus about 6,200 lines of Kotlin for Bluetooth and
  background services.
- **Device data is server-first and typed data is device-first.** Ring frames go up to the server,
  the server turns them into nightly and daily rows, and the phone pulls those back. Anything a user
  types is written to on-phone SQLite first and synced up through an outbox.
- **One user has the full data set.** The direct Oura ring pipeline is owner-only. The multi-user
  routes are Health Connect, which is built but has never run against real data, and the Oura API,
  which is planned (#2808) but not built.
- **The layers aren't enforced yet.** The readiness score users see reads about 20 Oura-specific
  fields directly. The newer "shadow" model, which will replace it, is mostly but not fully
  device-blind.
- **Changes are paused** while the native work is under way: agents do read-only analysis and docs
  only, and nothing is released until the owner lifts the pause.

![Every layer expanded, from readiness down to the sources](scoring-flow.svg)

_Every score pillar expands into its units, every unit into the metrics it reads, and every metric
into the sources that can send it. A filled source pill sends the metric today; a dashed one is
planned or possible. Red marks the units that can act on readiness directly. Health and Nutrition are
possible score pillars that don't exist yet: today their units sit inside Body._

## 1. The five layers

Each layer is called a **pillar**; "pillar" and "layer" mean the same thing. The owner fixed the
number and order of the layers on 2026-10-11, not the words. Every name below is a working name.

| # | Layer (working name) | Example | What it is | Scored? | Code id, if adopted | Today's code calls it |
|---|---|---|---|---|---|---|
| 1 | **Root pillar** | Readiness | The day's one number | 0–100 | `root.readiness` | Readiness |
| 2 | **Score pillar** | Sleep, Heart, Activity, Body | A scored zone | 0–100 | `score.sleep` | Pillar |
| 3 | **Unit pillar** | Sleep latency | One scored part of a score pillar | 0–100 | `unit.sleep.latency` | Unit |
| 4 | **Metric pillar** | Heart rate every minute | Raw data organised into a usable measurement, with a measurement unit and a cadence | never | `metric.hr_per_min` | Input |
| 5 | **Source pillar** | Oura ring, Health Connect | Where a metric came from: a device, an API or a log | never | `source.oura_api` | route / source |

In running text the second word can drop once the layer is clear: "the latency unit", "the
`hr_per_min` metric", "the Oura API source". Score pillars go by their names.

**Rules that come with the names:**

1. A metric's id says its cadence: `hr_per_min`, `hrv_per_night`, `steps_per_day`.
2. A unit's id starts with its score pillar: `unit.heart.overnight_hrv`.
3. Metrics carry measurement units (bpm, ms, °C, minutes). Units, score pillars and the root are
   always 0–100.
4. **A source never appears above the metric layer.** This is the line every device, vendor API and
   future integration plugs into.

The code still says Pillar and Input. Nothing is renamed until the owner chooses final names (#2809).

## 2. How a score is built

This section describes the **shadow model** (`packages/shared/src/health/shadow-readiness/`,
version 3). It is scored every day alongside the live readiness, shown nowhere yet, and is the model
the app is moving to. The design is in [`readiness-tree.md`](readiness-tree.md).

### 2.1 A unit scores 0–100 in one of three shapes

| Shape | 100 when | Falls when | Used by |
|---|---|---|---|
| **Sweet spot** | inside a band (e.g. 7–9 h) | below or above it | duration, 7-night balance, latency, steps, training load, zone minutes, SpO₂, fuel |
| **Steady** | at your normal | it drifts either way | timing, deep + REM share, temperature, breathing, weight vs plan |
| **Directional** | well past your normal in the good direction | it moves the bad way | efficiency, HRV, resting HR, settling, HR recovery, daytime stress |

A unit's score is `clamp(Level + Day, 0, 100)`:

- **Level** is the person's *normal*, graded against the research. For example, an HRV normal of
  45 ms grades 74. Where there's no research yardstick, Level is 70.
- **Day** is today against that normal: 20 points per spread step, from +30 down to −70.

### 2.2 How a person's normal is learned

- **Normal:** the median of the last 30 valid days **from the same source**, with at least 7 needed.
- **Spread step:** the interquartile range ÷ 1.349, floored at the unit's smallest meaningful change
  (3 ms of HRV, 2 bpm of resting HR, 0.15 °C).
- **Maturity:** days 0–13 are learning (Level only, or the unit drops out), 14–29 provisional, and 30
  on settled. A new unit counts at half weight until it settles.
- **A lasting change** (7 days in a row at least 1.5 steps off) rebuilds the normal.
- **A new source restarts that unit's normal**, so two devices' definitions never mix.
- **Missing data drops out** and the rest reweight. Nothing is filled in with a neutral 50.

### 2.3 Weights

| Score pillar | Weight in readiness | Units (weight inside the score pillar) |
|---|---|---|
| Sleep | 30% | duration 30 · efficiency 20 · 7-night balance 15 · timing 15 · deep + REM share 10 · latency 10 |
| Heart | 30% | overnight HRV 35 · overnight resting HR 30 · settling 15 · daytime resting HR 10 (not built) · HR recovery 10 |
| Activity | 20% | yesterday's steps 35 · training load 30 · zone minutes 20 · block trend 15 (not built) |
| Body | 20% | temperature 25 · breathing rate 20 · fuel (nutrition) 20 · SpO₂ 15 · daytime stress 10 · weight vs plan 10 |

A unit costs its score pillar the points it lost × its weight. Poor latency at 20/100 costs Sleep
6.5 points; so-so deep + REM at 60/100 costs 2.5. Both weigh 10%, but one fell 65 points and the
other 25.

### 2.4 Readiness, and the live model it replaces

**Readiness = the weighted average of the score pillars that scored.** A missing score pillar drops
out and the rest reweight. The owner is weighing **red-flag caps** on top (fever caps readiness at
40, an HRV crash at 60, and so on), because an average dilutes one alarming night. The caps are a
proposal, not built.

**Some units act on readiness directly**, outside their score pillar's average, because one
alarming night shouldn't be diluted into a few points:

| Unit | Red flag | Live readiness today | Shadow model (proposed cap) |
|---|---|---|---|
| Temperature | Fever, illness | Illness check: −25 for fever, −10 when "elevated" | Fever caps readiness at 40; illness signs at 60 |
| Breathing rate | Illness | Part of the illness check | Illness signs: 60 |
| Resting HR | Illness | Part of the illness check | Illness signs: 60 |
| Overnight HRV | HRV crash, illness | Part of the illness check | HRV unit at 20 or below: 60 |
| Duration | Very short sleep | — | 5½ h or less: 60 |
| Training load | Overload | — | Load ratio 1.6 or more: 65 |

The illness check weighs how far temperature (40%), breathing (25%), resting HR (20%) and HRV (15%)
sit from normal, the bad way. In 72 days it fired "watch" twice and never reached "elevated" or
"fever".

The **live readiness** users see today (`lib/health/readiness-payload.ts`) is older. It has 8
contributors copied from Oura's layout, counts HRV and heart rate twice, and applies a flat illness
penalty of −10 or −25. It reads about 20 fields straight from the Oura tables (`oura_daily`,
`oura_daily_summary`, `oura_daily_derived`).

**The shadow model isn't fully device-blind either.** Only overnight HRV, overnight resting HR and
HR recovery go through the input cascade (section 4). Settling, temperature and breathing read
`oura_daily_summary`, and daytime stress reads `oura_daily_derived`
(`shadow-readiness/assemble.ts`). Those reads are what a connector has to replace before a second
ring brand can score.

## 3. Where data comes from today

| Source pillar | What it sends | How it gets in | Where it lands first | How often | Who can use it |
|---|---|---|---|---|---|
| **Oura ring, direct** | Raw frames: beat-to-beat HR, HRV every 5 min, skin temperature about once a minute, motion, SpO₂ ratio | Native foreground service `OuraRingService.kt` drains the ring over BLE and POSTs to `/api/oura-ble/samples` | Phone: `oura_raw.db`. Server: `oura_raw_samples` (7-day hot window), packed into `oura_raw_packed` | On connect, then hourly (median gap 62 min) | **Owner only**: admin-only route, the owner's ring key |
| **Polar H10 strap** | HR about once a second, plus RR intervals | Native `PolarStrapService.kt` → `/api/hr-ingest` | Server only: `oura_heartrate` (source `chest_strap`), `rr_intervals` | 1 Hz in workouts; one sample per 30 s all day | Anyone with a strap |
| **Renpho scale** | Weight and impedance; body composition is our own estimate | Native `ScaleBleService.kt` → `/api/scale-ble/samples` | Server: `scale_raw_samples`, then accepted readings go to `body_metrics` | Each weigh-in | Anyone with the scale |
| **Health Connect** | Whatever Samsung, Garmin, Fitbit and others write: sleep, HR, HRV, SpO₂, steps, weight, nutrition | JS plugin (`lib/health-connect-sync.ts`) when the app opens → `/api/sync-health` | Server: `body_metrics`, `sleep_sessions`, `activity_logs`, `oura_heartrate` | On app open: 30 days back the first time, 7 days after that | Any user in principle; never run on real data |
| **Colmi ring** | HR, SpO₂, temperature, sleep | WebView BLE (`lib/colmi-ble/`) → `/api/colmi/samples` | Server: isolated `colmi_*` tables | Every 30 min | Comparison only, never scored |
| **Phone GPS** | Routes for walks and runs you start | Background-geolocation plugin | Phone: `activity_logs`, then the outbox | 5 m distance filter | Anyone |
| **Your logs** | Sets and workouts, food, water, weight, check-ins, sleep entered by hand | App screens | Phone SQLite, then the outbox → `/api/sync/push` | As typed | Anyone |
| **Oura API** (#2808) | Oura's own nightly and daily values, HR every 5 min | Not built | — | After the Oura phone app syncs | Up to 10 users until Oura approves the app |

**Where the data is true.** The rule is in
[`offline-first-and-storage.md`](../rules/offline-first-and-storage.md):

- **Typed data is device-first.** Everything in `SYNCED_MUTATION_DOMAINS`
  (`packages/shared/src/sync/mutation-schema.ts`) is written to the on-phone store and the outbox
  together, read back locally, and deleted with a `deleted_at` tombstone. A server hard delete never
  reaches a phone that hasn't synced.
- **Device data is server-first.** The ring rollup (`lib/oura-ble/rollup/run.ts`) runs only on the
  server. It writes `oura_heartrate`, `sleep_sessions`, `body_metrics` and the `oura_daily*` tables,
  and the phone pulls those through `/api/sync/pull`: a 90-day window, 500 rows a page, at most every
  5 minutes.
- **When two sources write the same field**, `mergeSet` keeps the higher rank:
  manual > scale > ring (BLE) > ring (old Cloud rows) > Health Connect
  (`packages/shared/src/health/source-rank.ts`).

## 4. Metric pillars and the input cascade

The input cascade (`packages/shared/src/inputs/cascade.ts`) is the start of the metric layer. It
names six metrics today: `steps/min`, `MET/min`, `HR/min`, `HRR60`, `HRV/night` and `RHR/night`.
For each one it:

- tries routes in rank order: **provided** by a device, then **derived** from other data, then
  **estimated**;
- returns `null` when nothing qualifies, never 0;
- tags every value with its provenance: route, rung, source, and low-wear or capped flags;
- drops implausible values instead of clamping them, and keeps baselines per source.

**Where it's wired:** training stress reads `steps/min` and `MET/min`; the shadow model reads
`HRV/night`, `RHR/night` and `HRR60`. **Where it isn't:** the live readiness, Sleep and Activity
scores. `HR/min` is defined but nothing resolves it in production; heart-rate merging happens at
read time in `mergeHrSources`.

**The catalogue still needs** sleep stages, sleep window, nightly temperature deviation, nightly
breathing rate, nightly SpO₂, wear time, and daily steps for sources with no per-minute count.

**The connector itself is design only.** [`data-source-connector-guide.md`](../data-source-connector-guide.md)
§10 describes a `DataSourceConnector` record (what a source supplies, how it ingests, backfills and
is ranked), and [`ingest-and-scoring.md`](ingest-and-scoring.md) describes a connector → normaliser
→ store pipeline. Neither is built. Today each source is a hand-written integration.

## 5. Limits with data inputs

### Who has data

- **The full data set exists for one person.** The direct ring pipeline uses the owner's ring key,
  firmware frozen at a known version, an admin-only ingest route and an owner-only service. It can't
  be offered to other users as it stands.
- **Health Connect is the only built multi-user route, and it is untested.** The owner doesn't use
  it, so it has never run against a real provider. Google must also review the app's declared use
  before anyone else can use it ([`public-launch-checklist.md`](../public-launch-checklist.md) §2).
- **The pinned Health Connect plugin can't parse three record types:** `HeartRateVariabilityRmssd`,
  `OxygenSaturation` and `HeartRateSeries` come back as string blobs. It also doesn't read skin
  temperature or respiratory rate yet. See
  [`2026-09-16-health-connect-record-converter-gap`](../reviews/2026-09-16-health-connect-record-converter-gap.md).

### How fresh it is

- **The ring uploads about hourly**, and its radio sleeps while you're still. Data can be up to an
  hour old when the app opens.
- **Health Connect syncs only when the app opens.**
- **The Oura API only gets sleep and readiness after the Oura phone app is opened.** Webhooks
  arrive about 30 seconds after that sync.

### How accurate it is

- **Only the chest strap is ground truth** for heart rate: it is electrical, and the rings are
  optical. Both rings report every 5 minutes at best. HRV can only be compared across devices as a
  trend ([`multi-device-comparison.md`](../multi-device-comparison.md)).
- **Our own sleep stager under-reads REM**, at about half of Oura's figure on nights with sparse
  beats ([`sleep-system.md`](../sleep-system.md)).
- **Our SpO₂ is uncalibrated**; Oura's API value is calibrated.
- **Training load counts only logged strength volume.** Runs and cardio don't count yet.

### What is stored, and for how long

- **The server's raw archive (`oura_raw_packed`, about 25 MB) is the only copy that can be
  re-decoded.** It is never pruned or rewritten. A protocol fix ships as a decoder change plus a
  redecode, never a re-drain.
- **The phone's `oura_raw.db` has no size limit** (31 MB at last count) and is too large for Android
  Auto Backup's 25 MB limit. A 14-day prune is decided but switched off.
- **Heart rate in `oura_heartrate` is pruned at 180 days** and `rr_intervals` at 90.
- **A strap in all-day mode keeps one sample per 30 s**, and a strap that has stopped connecting
  looks the same as one not being worn.

## 6. Oura direct vs the Oura API (#2808)

The owner wants to move to the Oura API, because that is what most users will have. It is scoped
but not started, and the owner's ring stays on the direct connection until the scope is done.

| | Direct (today) | Oura API (planned) |
|---|---|---|
| Users | Owner only | Any Oura member; 10 until Oura approves the app |
| Freshness | About hourly; live HR seconds old | Sleep only after the Oura app opens; HR, activity and stress in the background |
| Beat-to-beat data | Yes | **Lost** |
| HRV | Every 5 min, day and night | Sleep only, plus a nightly average |
| Steps | Per minute | Daily total |
| SpO₂ | Our uncalibrated estimate | Oura's calibrated value |
| Sleep stages | Our stager (REM under-read) | Oura's stages |
| Raw archive | Kept forever | None |
| Daytime stress and Body Battery | Our models | Oura's daily stress only |

**The plan is to rehearse the switch on the owner's own history first:** build an "API-grade" copy of
the last 97 nights from the direct archive, score both copies, and measure how far each unit moves
before the ring changes.

**Going ahead means reversing a written rule.** CLAUDE.md, [`oura-ble.md`](../rules/oura-ble.md) and
the guard test `lib/oura/__tests__/no-cloud-calls.test.ts` all say the Oura Cloud integration is gone
for good. The old `oura_tokens` table is still in the schema.

## 7. What a native app has to keep

These are the rules that would lose data if broken. The background is in
[`canonical-runtime-android.md`](../canonical-runtime-android.md),
[`oura-ble-operations.md`](../oura-ble-operations.md) and
[`mobile-and-runtime.md`](../rules/mobile-and-runtime.md).

1. **Same package id and signing certificate**, or a deliberate key migration. The app is
   `com.trainingai.app`, signed with a fixed debug keystore (restored in CI from
   `ANDROID_DEBUG_KEYSTORE_B64` and checked against `EXPECTED_CERT_SHA256`).
   - Uninstalling, or installing over with a different signature, destroys the ring's BLE key and
     any unsynced outbox writes.
   - The key is 32 hex characters in plain SharedPreferences (`oura_ble` → `key_hex`), kept out of
     cloud backup. The owner's offline `key.hex` is the only other copy.
2. **Never point the real app at a local server.** The dev flavour `com.trainingai.app.dev` loads
   `localhost` and has the BLE and Health Connect plugins removed at build time.
3. **The ring's history cursor never skips a gap.** Since 2026-07-27 the saved cursor advances only
   when a batch is durably committed to the phone's `oura_raw.db`, with the rows and the cursor in one
   transaction. The upload to the server is a best-effort backup. CLAUDE.md and
   [`oura-ble.md`](../rules/oura-ble.md) still describe the older rule, where the cursor moved on the
   server's 2xx; [`oura-ble-operations.md`](../oura-ble-operations.md) is current.
4. **Ring protocol rules:**
   - Decoders never throw: an unknown body returns `null` and the raw row is still stored.
   - Byte layouts come from the `open_oura` source, never from memory.
   - Scan by name and manufacturer id `0x02b2`, never by MAC address, and never use
     `autoConnect=true` on Samsung.
   - Never re-onboard the ring in the official Oura app, which can push firmware that breaks the
     protocol.
5. **The on-phone store is the source of truth for typed data.**
   - Every write goes to the store and the outbox together, and deletes are tombstones.
   - There is one write function per domain, shared by its API route and `pushMutations`.
   - Push schemas stay permissive, because old outbox payloads must keep parsing.
6. **Native services authenticate with the WebView's cookie today.** `OuraRingService`,
   `PolarStrapService` and `ScaleBleService` read it through `CookieManager`.
   - Without a WebView they need a token. Bearer auth exists: `auth()` accepts
     `Authorization: Bearer`, and the mobile token exchange returns a 7-day access token. Some of
     this came from your earlier PR #1607.
   - Refresh tokens are a table only (#2076); nothing issues them yet.
7. **The API is unversioned.** There are 249 `route.ts` files, all `private, no-store`, most
   rate-limited, and validated with Zod (strict, except push and native-client routes). The
   installed app depends on today's shapes, so changing a response shape breaks it.
8. **Shared code is mostly portable.** `packages/shared/src` is about 52,000 lines with no Next.js or
   Capacitor imports.
   - 29 files import app modules through `@/`: the local store, the SQLite cache, the on-device ONNX
     models and AI instrumentation.
   - No lint rule enforces the boundary yet.

## 8. How we work

The full rules are in [`CLAUDE.md`](../../CLAUDE.md), [`docs/agents/README.md`](../agents/README.md)
and [`owner-manual.md`](../owner-manual.md).

- **Work is GitHub Issues.** Labels carry the type, the area (the eleven domains in
  [`docs/domains/`](../domains/README.md)), the lane, the agent, and why an issue isn't ready yet.
- **Issues ship in batches.** One milestone (`Batch: …`) holds 1–10 related issues and becomes one PR
  to `main`. A migration is always its own batch.
- **Five checks must pass:** Lint, Tests, Build, Migration Check and Custom Rules. Squash is the only
  merge method.
- **A merge deploys nothing.** Releases are weekly on Tuesday: a `v*` tag, deployed by
  `release.yml` after the owner replies "approve". Because the WebView loads from Railway, a release
  changes the phone's app at once. A new APK is needed only when `android/**`,
  `capacitor.config.ts` or native dependencies change.
- **Three agents do most of the work:**
  - 🪐 **Orchestrator** (cloud): triage, batching, merges, releases.
  - 🪲 **BugFix** (cloud): turns reports into issues, small fixes.
  - 🚧 **Implementer** (the owner's machine): builds batches and runs the device checks.
- **Agents never merge a PR they didn't author.** Your PRs are reviewed by agents and merged by the
  owner.
- **The pause:** since 2026-10-11 the owner has paused changes while the native work is under way.
  Agents are doing read-only analysis and docs, and no release goes out until the owner lifts it.
- **The native direction:** on 2026-10-09 the owner decided v2 is native screens rather than a bundled
  shell. The toolkit is being decided with you in #2765.

## 9. Open decisions that touch this

- **Layer names:** the five layers and their order are fixed; the words are working names until the
  owner chooses final ones.
- **Readiness recipe:** weighted score pillars plus red-flag caps, and the cap numbers.
- **Score pillar weights:** keep Sleep 30 · Heart 30 · Activity 20 · Body 20?
- **Health and Nutrition:** split them out of Body as their own score pillars, or keep them inside?
- **Training load:** count cardio and runs, not only strength volume?
- **The Oura API switch** (#2808): when the owner's ring moves, after the rehearsal.
- **Native toolkit** (#2765) and **refresh tokens** (#2076).

## 10. Read next

- [`readiness-tree.md`](readiness-tree.md) — the agreed scoring design, unit by unit.
- [`threshold-inventory.md`](threshold-inventory.md) — every number the scores use, and where it comes from.
- [`data-source-connector-guide.md`](../data-source-connector-guide.md) — how a new source is meant to plug in.
- [`device-agnostic-source-architecture.md`](../device-agnostic-source-architecture.md) — raw-capable and computed sources, and the three tiers.
- [`oura-ble-operations.md`](../oura-ble-operations.md) — the ring pipeline and its recovery procedures.
- [`offline-first-target-architecture.md`](../offline-first-target-architecture.md) — what moves to the phone next.
- [`canonical-runtime-android.md`](../canonical-runtime-android.md) — how the APK is built, signed and installed.
