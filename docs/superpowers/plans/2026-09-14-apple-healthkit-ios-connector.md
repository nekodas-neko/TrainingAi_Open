# Plan: Apple HealthKit connector (iOS)

_2026-09-14 (PS-46). Written so someone else — a contributor, or a future implementer session — can
build this without re-deriving the architecture. Mirrors `lib/health-connect-sync.ts` deliberately:
same shape, same target endpoint, same canonical data types. Companion reading:
[`docs/data-source-connector-guide.md`](../../data-source-connector-guide.md) (the general contract —
§0's two-layer model, §3's canonical shapes) and
[`docs/sync-health-api-reference.md`](../../sync-health-api-reference.md) (the exact write-side
contract this plan targets, unchanged)._

## 0. What this is, in one paragraph

HealthKit is Apple's computed-tier data source, architecturally identical to Health Connect (§2 of
the connector guide): the OS holds finished values from whatever the user wears, the app requests
per-type read permission, and reduces what it gets into the same canonical shapes every other source
uses. **No backend change is required** — this plan is entirely a new client-side reader plus a new
platform target. `POST /api/sync-health` already accepts exactly the payload shape this needs.

## 1. What does NOT exist yet — read this before estimating effort

Verified directly against the repo, not assumed:

- **No `ios/` directory.** `npx cap add ios` has never been run.
- **No `@capacitor/ios` package** in `package.json`.
- **No HealthKit plugin installed.**
- **No Apple Developer account is referenced anywhere in this repo's config/secrets.** One is
  required — HealthKit is an entitlement, not a permission Apple grants to unsigned/free-provisioned
  builds beyond a 7-day local run.

This is a genuine new-platform project, not a config change — see §6 for what that costs in
practice.

## 2. Platform setup (once, before any data code)

1. **Apple Developer Program enrollment** ($99/year, individual or org account) — required to get
   the HealthKit capability and to distribute to a device that isn't tethered to a dev machine.
2. **`npx cap add ios`** — stands up the Capacitor iOS project (`ios/App/`), analogous to the
   existing `android/` tree.
3. **Enable the HealthKit capability** in the Xcode project (`ios/App/App.xcodeproj`) — adds the
   entitlement file and requires an App ID configured for HealthKit in the Apple Developer portal.
4. **`Info.plist` usage-description strings** — `NSHealthShareUsageDescription` (why the app reads
   HealthKit) and, only if any write-back is ever added, `NSHealthUpdateUsageDescription`. This app
   only reads — never write HealthKit data back, matching the read-only relationship Health Connect
   has today.
5. **A HealthKit-capable Capacitor plugin.** Evaluate what's actively maintained at implementation
   time rather than trusting a name pinned here — plugin availability/quality changes. Whatever is
   chosen, **verify its actual read-type/field names against its real source**, the same rule
   `CLAUDE.md` already enforces for the Oura protocol and the Health Connect patch (a plugin's docs
   can lag its code just like a vendor's own docs can).

## 3. Data mapping — HealthKit type → canonical shape

The right-hand column is what already exists (§3 of the connector guide); this plan produces the
left-hand mapping, mirroring `HC_SYNC_READ_TYPES`/the day-bucket reducer in
`lib/health-connect-sync.ts` almost one-for-one. HealthKit's public identifiers below are Apple's
stable, documented `HKQuantityTypeIdentifier`/`HKCategoryTypeIdentifier` constants — **re-verify the
exact string spelling against the plugin's actual TypeScript types before writing code**; this table
states intent, not a pinned source (§2's own rule applies here, this plan cannot pin what isn't
chosen yet).

| HealthKit type (intent) | Reduction | Target `DailyMetric`/`SleepRecord`/`ExerciseSession` field | Health Connect's equivalent (for parity) |
|---|---|---|---|
| `HKQuantityTypeIdentifierStepCount` | sum per local day | `dailyMetrics[].steps` | `Steps` (aggregate `groupBy: 'day'`) |
| `HKQuantityTypeIdentifierDistanceWalkingRunning` | sum per local day, m→km | `dailyMetrics[].distanceKm` | `Distance` aggregate |
| `HKQuantityTypeIdentifierActiveEnergyBurned` | sum per local day | `dailyMetrics[].caloriesBurned` | `TotalCaloriesBurned` aggregate |
| `HKQuantityTypeIdentifierBodyMass` | latest sample per local day | `dailyMetrics[].weightKg` | `Weight` |
| `HKQuantityTypeIdentifierBodyFatPercentage` | latest sample per local day | `dailyMetrics[].bodyFatPct` | `BodyFat` |
| `HKQuantityTypeIdentifierRestingHeartRate` | latest/daily sample | `dailyMetrics[].restingHeartRate` | `RestingHeartRate` |
| `HKQuantityTypeIdentifierHeartRateVariabilitySDNN` | mean of overnight (00:00–08:00 local) samples | `dailyMetrics[].hrvMs` | `HeartRateVariabilityRmssd` — **⚠ not the same statistic, see §4** |
| `HKQuantityTypeIdentifierOxygenSaturation` | mean of overnight samples | `dailyMetrics[].spo2Pct` | `OxygenSaturation` |
| `HKQuantityTypeIdentifierHeartRate` (series) | per-session avg/max for enrichment; not written as an intraday series into `oura_heartrate` (same gap as Health Connect's `HeartRateSeries` — PS-41 covers wiring this properly for both sources) | `exerciseSessions[].avgHr`/`maxHr` | `HeartRateSeries` |
| `HKObjectType.workoutType()` | one row per workout, mapped through an Apple-side activity-type table (`HKWorkoutActivityType` enum → this app's `activity_types` slugs — build fresh, do not reuse `EXERCISE_TYPE_TO_ACTIVITY_TYPE`, Apple's enum values are entirely different strings/ints) | `exerciseSessions[]` | `ActivitySession` |
| `HKCategoryTypeIdentifierSleepAnalysis` | stage-interval array → `intervalsToPhase5Min()` (same shared function Health Connect uses — **do not write a second reducer**, per `CLAUDE.md`'s One Formula One Place rule) | `sleepRecords[]` | `SleepSession` |
| Dietary energy/macro types (`HKQuantityTypeIdentifierDietaryEnergyConsumed`, `...Protein`, `...Carbohydrates`, `...FatTotal`) | sum per local day | `dailyMetrics[].calories/proteinG/carbsG/fatG` | `Nutrition` |
| `HKQuantityTypeIdentifierBodyTemperature` (if the plugin exposes it) | see §4 | — new field, not currently in `SyncHealthSchema` | no Health Connect equivalent read today either |
| `HKQuantityTypeIdentifierRespiratoryRate` (if exposed) | see §4 | — new field, not currently in `SyncHealthSchema` | no Health Connect equivalent read today either |

## 4. Things worth deciding, not assuming

- **HRV statistic mismatch.** HealthKit's primary HRV metric is **SDNN**, not the rMSSD Health
  Connect's `HeartRateVariabilityRmssd` (and Oura's own `0x5d`) report. These are different
  statistics computed differently — averaging them together, or treating an SDNN value as
  equivalent to an rMSSD one for `hrvMs`, would be silently wrong. **Decide explicitly**: either add
  a `hrvSource`/`hrvStat` marker so downstream formulas know which statistic a given day's value is
  (larger change, more correct), or document plainly that HealthKit's HRV contribution is
  approximate and accept the imprecision (smaller change, faster to ship, matches how the app
  already treats cross-device HRV as "trend only, not comparable" per
  `docs/multi-device-comparison.md`). Do not ship silently averaging the two.
- **Temperature and respiratory rate** aren't in the current `SyncHealthSchema` (§13 of the
  connector guide lists these as the genuinely "Oura-only, no other supplier wired" items). If the
  chosen plugin exposes `HKQuantityTypeIdentifierBodyTemperature`/`RespiratoryRate` (both require
  compatible hardware, e.g. Apple Watch Series 8+ for wrist temperature — most users won't have
  these populated), extending `SyncHealthSchema` to accept them is a small, additive schema change —
  scope it as a follow-up once the core sync works, not part of this plan's first cut.
- **Add `'healthkit'` to `HEALTH_SOURCES`** (`packages/shared/src/health/source-rank.ts`) at the
  same rank tier as `health_connect` (both are computed-tier sources of equal trust) — a one-line,
  low-risk change, but touches the shared provenance ladder so do it deliberately, not as a drive-by
  inside a larger commit.
- **Sync window (cold/hot)**: mirror Health Connect's `SYNC_DAYS_COLD = 30` / `SYNC_DAYS_HOT = 7`
  pattern for a first cut — don't invent a different window without reason. If PS-43 (the Health
  Connect backfill-cap decision) lands first, apply whatever policy it settles on to this connector
  too, so the two computed sources behave consistently rather than diverging by accident.

## 5. What this plan does NOT need to build

- **No decode/normalize step** (§5 of the connector guide) — HealthKit is squarely a computed
  source, same as Health Connect. No modeling work, no raw-signal handling.
- **No new backend route, no schema migration** for the core fields — `POST /api/sync-health`
  already accepts everything in §3's table except the two starred rows.
- **No changes to any scoring formula** — every formula already reads the generic tables this
  writes into (§4 of the connector guide), and doesn't know or care which computed source supplied a
  given day's values.

## 6. Distribution — how your friend actually gets a build on his phone

iOS doesn't support sideloading the way Android's APK does. Two paths, in order of effort:

1. **TestFlight** — requires the Apple Developer account (§2.1) and an app record in App Store
   Connect, but no App Store review for internal/external TestFlight testing (external testing does
   need one light review pass, typically fast). This is the practical path for "give my friend a
   build" without committing to a public App Store listing.
2. **Full App Store release** — only relevant if/when the wider distribution question
   (`device-agnostic-source-architecture.md` §7's open question about the Play Store policy, which
   applies equally to an eventual App Store one) gets a real answer. Not needed to unblock one
   friend.

## 7. Rough shape of the work (not a committed estimate)

1. Platform setup (§2) — mostly one-time account/tooling friction, not code.
2. Plugin integration + permission request flow — small, closely mirrors
   `HealthConnect.requestPermissions()`'s shape in the existing file.
3. The mapping/reduction layer (§3) — the bulk of the work, but it's copying an already-proven
   pattern field-by-field, not inventing one.
4. The two open decisions in §4 (HRV statistic, temperature/respiratory schema extension) — small
   in code, need a decision before writing them.
5. On-device testing — **cannot be done in this sandbox**; needs a real iPhone and the Apple
   Developer account from step 1. HealthKit does not behave usefully in the iOS Simulator for real
   sensor data.
6. TestFlight distribution to the friend (§6).

## 8. Verification

- Every mapped field lands in the same table/column a Health Connect sync would produce it in —
  confirm by comparing a synced HealthKit day against the `SyncHealthRequest` shape in
  `docs/sync-health-api-reference.md` directly (same schema, same route, nothing HealthKit-specific
  on the server side to verify separately).
- Sleep: confirm `sleepPhase5Min` is only populated when real stage boundaries exist (never a
  fabricated flat string) — same rule Health Connect follows.
- HRV: whatever §4's decision was, confirm it's applied consistently (marker field present, or the
  imprecision documented) rather than half-implemented.
- On-device only, per §7.5 — no sandbox substitute exists for this step.
