# Data Source Connector Guide

_Reference doc, 2026-09-14 (PS-40). Answers a concrete engineering question that
[`device-agnostic-source-architecture.md`](device-agnostic-source-architecture.md) deliberately left
open: **given the goal of not being locked to one ring, what does a new data source actually plug
into — what shape does it send, which table does it land in, and which pillar reads it?** That doc
states the tiers and the invariants; this one is the contract a new integration is checked against.
No code in this repo implements a formal `DataSourceConnector` interface yet — §7 proposes one and
files the implementation as a backlog entry rather than building it inline, per `CLAUDE.md`'s
backlog-driven-implementation rule. Everything else here (the tables, the ingestion pattern, the
provenance mechanism) already exists and is described from the current code, not aspirationally.

---

## 1. The three things every source answers

Before wiring a new ring, strap, or platform aggregator (Health Connect, Apple HealthKit, a Garmin
export, whatever comes next), answer three questions. Get these wrong and the source either can't be
added without a schema change, or it silently corrupts scoring for every other source sharing the
same table.

1. **What tier is it?** Raw-capable (emits per-beat/per-sample signal, we derive the metric) or
   computed (the vendor already derived sleep stages / steps / HRV). See §2 of
   `device-agnostic-source-architecture.md` — this decides whether you're writing a new decoder or a
   new mapping layer.
2. **Does it share scoring tables, or is it isolated?** If its values should ever influence
   readiness/sleep/activity scores, it writes into the same generic tables every other source uses,
   ranked by trust (§4). If it's unvalidated (a new ring you don't yet trust, a device in "learning
   mode"), it gets **its own table family**, kept structurally out of the ranked set — see §5.
3. **What shape is each data type in?** A scalar-per-day is not a time series is not an event list.
   §3 is the canonical shape for every data type the app currently consumes. Get the shape wrong and
   either the data doesn't fit the column, or it fits but silently loses information (e.g. storing a
   mean bpm where the pillar needed the full series).

---

## 2. Transport categories (how data physically arrives)

| Category | What it is | Today | Auth |
|---|---|---|---|
| **Direct BLE (raw)** | App/native code talks GATT straight to the device; we own the decoder | Oura Ring 5 (`lib/oura-ble/`), Renpho scale (`lib/scale-ble/`), Polar H10 (`lib/polar-ble/`) | Session (or admin, for the raw Oura ingest route) |
| **Direct BLE (learning mode)** | Same transport, but writes are isolated until trusted | Colmi R09 (`lib/colmi*` — see `docs/superpowers/plans/2026-08-26-alternative-ring-colmi-testing.md`) | Session |
| **Platform aggregator (computed)** | OS-level health store that already merged whatever the user wears | Android Health Connect (`lib/health-connect-sync.ts`) | Session, via `/api/sync-health` |
| **Platform aggregator, secret-gated** | Same idea, driven by an external automation (Tasker) rather than the in-app client | Health Connect via `/api/health-connect/ingest` | Shared secret, no session — **not currently multi-tenant** (single hardcoded `WEBHOOK_USER_ID`) |
| **Manual entry** | User types a number | Body metadata form | Session |
| **Cloud API (retired)** | Vendor's OAuth'd REST API, webhook-pushed or polled | Oura Cloud — **removed 2026-08-13, never re-add** (§ "Oura Ring — the Cloud integration is GONE" in `CLAUDE.md`) | — |

**Apple HealthKit is not implemented and there is no iOS build.** The canonical runtime is the S25
Ultra APK (`CLAUDE.md` "Canonical Runtime"). If iOS ever becomes a target, HealthKit is a **computed
source** in exactly the shape Health Connect is — same generic tables, same `source: 'health_connect'`-
style tag (it would need its own `HealthSource` value, e.g. `'healthkit'`, ranked the same as Health
Connect), same mapping-layer job: read HealthKit's record types, reduce them to the shapes in §3, POST
to `/api/sync-health`. No native Kotlin work carries over; it would need its own native bridge and a
completely separate record-type mapping (HealthKit's `HKQuantityTypeIdentifier` set, not Health
Connect's `Record` classes) written fresh, following the pattern in §6, not reusing
`lib/health-connect-sync.ts` beyond the shape it targets.

---

## 3. Data type catalog — the canonical shape of each metric

This is the part the user asked for directly: **for each kind of data a source might supply, what
shape does the app actually expect, and where does it land?** "Shape" here means: scalar-per-day,
time-series list, interval/session object, or event list. Getting the shape right on the first
integration avoids a rewrite later — the app already learned this lesson twice (Health Connect's
sleep-stage array almost got flattened to four totals before someone read `RecordConverter.kt`, and
`saveSleepSession`'s optional `source` param shipped a real provenance bug before it was made
required — both in `device-agnostic-source-architecture.md` §2/§4c).

### 3a. Heart rate — **time-series list**, never a scalar

```ts
{ timestamp: string /* ISO */, bpm: number, source: 'ble' | 'chest_strap' }[]
```

- **Table:** `oura_heartrate` — one row per `(userId, timestamp)`, shared by every HR source (ring
  rollup writes `source: 'ble'`, Polar strap writes `source: 'chest_strap'` via `POST /api/hr-ingest`).
- **Not per-field ranked merge** — HR/RR have no `source_map`. Read-time bucket precedence instead:
  `getHrForWindow` prefers `chest_strap` over `ble` per bucket, because the strap is electrical
  ground truth and the ring is optical (see `docs/multi-device-comparison.md`).
  A new HR source decides at write time which of the two existing `source` values it's closest to
  in trust, or gets a new value added to the precedence list — never invents a third silently-ignored
  tag.
- **Derived from HR, not stored separately:** `daily_zone_minutes` (per-day time-in-zone) is a
  server-computed cache over `oura_heartrate`, not something a source writes directly.
- **RR intervals (beat-to-beat), if the device exposes them:** separate list, separate table.
  ```ts
  { at: string /* ISO */, rrMs: number, source?: string /* defaults 'chest_strap' */ }[]
  ```
  → `rr_intervals`, pruned at 90 days (a workout's HRV scalar is snapshotted into
  `workout_hr_stats` first, so pruning the raw series is safe).

### 3b. Sleep — **one session object with a stage-interval array**, reduced two ways

The single richest shape in the catalog, because two independent pipelines (Oura BLE rollup and
Health Connect) both produce it and converge on the same on-disk encoding:

```ts
{
  sleepStart: string,      // ISO, session start
  sleepEnd: string,        // ISO, session end
  // Stage totals (hours) — always required, always computable from the interval array:
  deepSleepHours: number,
  remSleepHours: number,
  lightSleepHours: number,
  awakeHours: number,
  timeInBedHours: number,
  // The hypnogram, if you have one — a 5-minute-bucket stage string:
  sleepPhase5Min?: string, // regex ^[1-4]+$, max 288 chars (24h at 5-min resolution)
                           // 1=deep 2=light 3=REM 4=awake
  // Optional physiological extras, all daily-session scalars:
  efficiency?: number, onsetLatencySec?: number, averageHrvMs?: number,
  avgHeartRate?: number, lowestHeartRate?: number, respiratoryRate?: number,
  sleepScore?: number,
}
```

- **Table:** `sleep_sessions`, unique on `(userId, sleepStart)`.
- **Write path:** `repo.saveSleepSession(userId, session, source: HealthSource)` — **`source` is a
  required parameter, not optional.** This was a real bug once (§4c of
  `device-agnostic-source-architecture.md`): an optional `source` defaults to rank 0 and a lower-rank
  write can permanently out-write a better source under first-write-wins semantics. Any new sleep
  source goes through this one function; never a bespoke upsert.
- **The interval → 5-min-bucket reduction is the reusable primitive**, not a per-source
  reimplementation: Health Connect's raw stage-interval array
  (`{startTime, endTime, stage}[]`, confirmed at `RecordConverter.kt:81-90` — a real hypnogram, not
  just durations) is reduced with `intervalsToPhase5Min()`
  (`lib/health-connect-sync.ts`), the **same function** the Oura BLE rollup's own stage output goes
  through. A new source that has stage-interval data (start/end/stage triples, whatever granularity)
  should reduce through this same function rather than writing a new bucketing algorithm.
- **If your source only has stage *durations*, no interval boundaries** (e.g. "2.1h deep, 4.3h
  light"), omit `sleepPhase5Min` entirely rather than fabricating a flat/guessed hypnogram — a
  missing hypnogram degrades gracefully (the UI has a no-hypnogram state); a fake one looks like real
  data and cannot be told apart later.

### 3c. Daily body/activity scalars — **one row per user per day, sparse columns**

```ts
// One of these per metric the source can supply; omit fields it can't.
{
  date: string, // YYYY-MM-DD, user-local (never UTC slice — see CLAUDE.md timezone rules)
  weightKg?, bodyFatPct?, steps?, distanceKm?, restingHeartRate?, hrvMs?,
  spo2Pct?, activeCalories?, waterMl?,
  // Renpho-style bioimpedance panel, if the source is a smart scale:
  skeletalMusclePct?, fatFreeMassKg?, subcutaneousFatPct?, visceralFatIndex?,
  bodyWaterPct?, muscleMassKg?, boneMassKg?, proteinPct?, bmrKcal?, metabolicAge?,
}
```

- **Table:** `body_metrics`, unique on `(userId, date)`, **`sourceMap: jsonb` column stamps
  per-field provenance** — this is the one table where two different sources can each win different
  *columns* of the same row (ring wins `steps`, scale wins `weightKg`, manual entry wins
  `bodyFatPct` if the user typed a correction). See §4 — this is the per-field ranked merge in
  its purest form.
- **Write path:** `repo.upsertBodyMetrics(userId, metrics[], source: HealthSource)`.
- **Cumulative-field gotcha (`CLAUDE.md` AI & Security Defaults):** a source reporting "today's"
  steps/calories mid-day is reporting a **partial day**, not a completed one — never treat a
  same-day cumulative read as comparable to a completed day's total, and never assume the metric
  will monotonically reach a "full day" value by end of day if the source stops reporting.

### 3d. Activity sessions (walks/runs/workouts the source detected) — **event list**

```ts
{
  title?: string, activityType: string, // free text; server falls back to 'other' if unmapped
  start: string, end: string, durationMin?: number,
  distanceKm?: number, calories?: number, avgHr?: number, maxHr?: number,
}[]
```

- Maps through a source-specific `exerciseType → activityType` table (see
  `EXERCISE_TYPE_TO_ACTIVITY_TYPE` in `lib/health-connect-sync.ts` for the Health Connect example) —
  **every new source needs its own mapping table**, because vendors don't share an activity-type
  vocabulary. Unmapped types fall through to `'other'` server-side rather than being rejected.
- **Table:** `activity_logs`, via `saveActivityLog`.
- Distinct from **workout sessions** (`workout_sessions`/`exercise_logs`/`set_logs`) — those are
  structured strength-training data the app's own UI writes, never something a wearable "detects".
  A source cannot populate a workout; at most it enriches one after the fact (HR/distance/calories
  backfilled onto an existing activity log — see `PATCH /api/activity-logs/[id]/metrics`).

### 3e. Raw signal (only for a raw-capable/BLE source with its own decoder)

```ts
{ frames: [{ hex: string /* ≤2048 chars */ }], /* ...max 2000 per batch */ }
```

- **Table:** an archival raw table specific to that device family — never the generic tables
  directly. `oura_raw_samples` (`bodyHex` archival, `decoded` jsonb, deduped on
  `(userId, ringTimestampDs, tag, bodyHex)`) is the reference shape: **archival hex is never mutated
  or pruned; a decoder bugfix redecodes from the stored hex rather than needing a re-drain.** A new
  raw-capable source's archival table should follow this shape, not invent a mutable "latest decode"
  column as the source of truth.
- A background rollup turns the raw archive into the generic shapes in §3a–3d — this is the only
  place a new device's protocol-specific decoding logic lives; nothing downstream of the rollup ever
  sees device-specific bytes.

---

## 4. Provenance — the ranked per-field merge

Every write into a shared scoring table (`body_metrics`, `sleep_sessions`, `oura_heartrate`) carries
a `source: HealthSource`. Sources are ranked (`packages/shared/src/health/source-rank.ts`):

```
manual (5) > scale_ble (4) > oura_ble (3) > oura_cloud (2) > health_connect (1) > unknown (0)
```

`mergeSet(table, cols, source)` (`lib/data/health-source.ts`) applies this **per field, per date** —
not per row, not per source globally. A higher-or-equal rank overwrites a field; a lower rank may
only fill a `NULL`. This is why `body_metrics.source_map` exists: on a single day, the scale can win
`weightKg` while the ring wins `steps`, independently.

**Adding a new source's rank is a one-line change** in `source-rank.ts` (it's shared/driver-free
specifically so a device port can reuse it — see the module-map row on the Oura rollup port).
Two decisions to make before you do:

1. **Where does it sit relative to existing sources?** A computed/aggregator source (Health
   Connect-tier) generally ranks below a raw-capable device we decode ourselves, and always below
   manual entry. A second raw-capable ring of unknown accuracy does **not** automatically rank above
   the trusted one — rank reflects trust, not recency.
2. **Does it even belong in the ranked set?** If not — see §5.

---

## 5. Isolation — when a new source should NOT share scoring tables

A low rank is not isolation. **The per-field merge governs writes; every scoring read is
source-blind** — nothing that reads `oura_heartrate`/`body_metrics`/`sleep_sessions` filters by
source, so a row that lands in those tables is scored, however it's ranked (this was the concrete
finding that shaped the Colmi integration — see
`docs/superpowers/plans/2026-08-26-alternative-ring-colmi-testing.md`).

If a source is unvalidated — a device you don't yet trust to influence readiness/sleep/activity
scores — give it its own table family instead, kept **structurally** out of the ranked set:

- Its own tables (`colmi_readings`, `colmi_raw_frames`, `colmi_sleep_segments` are the reference
  shape — mirror §3's shapes but in isolated tables).
- Its `HealthSource`-like tag deliberately **excluded from the `HealthSource` union type**, so a
  writer that tries to pass it into a scoring-table write (`upsertBodyMetrics`, `saveSleepSession`,
  etc.) is a **compile error**, not a runtime check that can be forgotten.
- No sync/outbox/local-store domain — it doesn't participate in offline-first until it graduates.
- A CI check pinning the isolation (see `scripts/check-learning-mode-isolation.js`) so a future PR
  can't accidentally wire a shared write in.

Promote it to a ranked source only after a real comparison against a trusted reference (the strap is
the only ground-truth HR source in this app — see `docs/multi-device-comparison.md` for the method).

---

## 6. The ingestion route pattern

Every current ingest route (`/api/oura-ble/samples`, `/api/scale-ble/samples`, `/api/hr-ingest`,
`/api/colmi/samples`, `/api/sync-health`, `/api/health-connect/ingest`) follows the same shape. A
new source's route should too:

1. **Auth** — session cookie (device is the user's own phone), or a shared secret with no session
   (external automation posting on the user's behalf) — never a `userId` taken from the request
   body. Admin-gate anything that touches raw archival storage directly (the raw Oura route is
   `requireAdmin`; the derived-data routes are not).
2. **Rate limit** — every route is rate-limited per user/IP; match a sibling route's limit rather
   than picking a new number.
3. **Byte cap** — `readJsonLimited`, not an unbounded body read.
4. **Zod schema, batch-shaped, per-item validated** — the schema describes the batch envelope
   (`{samples: [...]}`, `{frames: [...]}`), but out-of-range values are dropped **per item**, never
   failing the whole batch (the "poison-pill rule" — one bad sample must not lose 1,999 good ones).
5. **Write through the repository's typed method**, never raw SQL from the route — `upsertBodyMetrics`,
   `saveSleepSession`, `upsertOuraHeartrate`, `insertRrIntervals`, etc. This is what makes §4's
   provenance merge unconditional rather than something each route has to remember to call.
6. **Cache invalidation is client-side today**, not server-side in the route — none of the routes
   read here call an `invalidate*` group themselves; the client fires invalidation after a
   successful sync (`lib/cache-groups.ts` — `invalidateBiometrics()` for body/sleep,
   `invalidateActivityWrites()` for sessions). A new source's client-side sync code needs to call
   the matching group; a server-side ingest route by shared secret (no client in the loop, like the
   Health Connect Tasker path) currently relies on the next `cachedFetch` TTL expiry rather than
   push invalidation — acceptable for that specific low-frequency automation path, but not a pattern
   to copy for anything the user expects to see update immediately.

---

## 7. Proposed: a formal `DataSourceConnector` shape (design only — not implemented)

Everything above already exists as a *convention* independently re-derived per source. Nobody has
had to violate it yet because there have only been six sources total, each added by someone who read
the previous one's code. That stops scaling the moment a third-party or community-contributed
connector is wanted. The following is a proposed shape to make the convention explicit and
machine-checkable — **filed as PS-40 in the implementation backlog, not built in this doc-only
session** (per `CLAUDE.md`'s backlog-driven-implementation rule — planning and implementation are
separate PRs).

```ts
interface DataSourceConnector {
  id: string;                          // e.g. 'oura_ble', 'health_connect', 'garmin_hc'
  tier: 'raw' | 'computed' | 'manual';
  isolation: 'scored' | 'learning_mode';
  healthSource?: HealthSource;         // required if isolation === 'scored'
  supplies: DataType[];                // subset of the §3 catalog this source can provide
  ingestRoute: string;                 // the app/api route it POSTs to
}

type DataType =
  | 'heart_rate_series' | 'rr_intervals'
  | 'sleep_session' | 'daily_body_metrics'
  | 'activity_session' | 'raw_signal';
```

The value of formalizing this: `next-item.js`-style tooling could validate that a new source's PR
declares every table/rank/isolation decision explicitly (so a reviewer isn't reconstructing intent
from route code), and a future "connector marketplace" (community-contributed device support) has a
real contract to implement against instead of "read six existing routes and infer the pattern."
Scope for that implementation PR: the interface itself, a registry, and migrating the existing six
sources to declare it — explicitly **not** a runtime plugin/sandboxing system, which is a much larger
and currently unneeded scope.

---

## 8. Worked example — adding a new generic ring or strap

1. **Classify it** (§1): does it expose raw BLE signal, or does it only appear inside Health Connect
   / a vendor app? If the latter, you likely need **no new code at all** — it already reaches the app
   through the existing Health Connect pipeline (§6, §3), because that pipeline is vendor-agnostic by
   construction (Health Connect merges whatever's installed).
2. **If it's raw BLE:** decide scored vs. learning-mode (§5) before writing a single decoder byte.
   Start in learning mode — isolated tables, its own tag kept out of `HealthSource` — until you've
   run the comparison-against-ground-truth method in `docs/multi-device-comparison.md`.
3. **Verify the protocol against the device's real behavior, not marketing docs** — `CLAUDE.md`'s
   "External API & Plugin Field Names" rule exists because this has gone wrong three times already
   for existing sources. Capture real BLE traffic, don't guess field names or byte offsets.
4. **Pick the §3 shapes it can supply.** Most rings supply a subset — HR series and daily
   steps/sleep totals are common; RR intervals, SpO2, and a real stage-interval hypnogram are not
   universal. Only build what the device actually emits; don't synthesize a shape it can't back.
5. **Write the ingest route** following §6's checklist, reusing an existing sibling route as the
   template (the Colmi route, `/api/colmi/samples`, is the closest analog for a new learning-mode BLE
   device; `/api/hr-ingest` for a new HR-only strap).
6. **Add the client-side wiring**: BLE scan/connect (name/manufacturer-id, never MAC — device
   addresses rotate), batch-and-post, cache invalidation on success, and — if it's meant to survive
   offline — the local-store write + outbox mutation per the "Offline-First" rule in `CLAUDE.md`.
7. **Document which pillar(s) consume it** — update the relevant `docs/domains/<pillar>/README.md`
   and, if it's genuinely new shared infrastructure, add a row to `docs/module-map.md`.
8. **On-device verification is mandatory for anything BLE** — the sandbox has no Bluetooth stack;
   `CLAUDE.md`'s Canonical Runtime rule applies in full.

---

## 9. What this buys the existing pillars

Every pillar already reads through the generic tables (§3), not through a device-specific table —
that's the invariant `device-agnostic-source-architecture.md` §6 states and this doc is the
mechanism for keeping true. Concretely, per pillar:

| Pillar | Reads (generic) | A new source helps by supplying |
|---|---|---|
| `heart-rate` | `oura_heartrate`, `rr_intervals`, `daily_zone_minutes` | HR series, RR intervals |
| `sleep` | `sleep_sessions` (+ `oura_daily_derived` for Oura-specific model output) | sleep session + stage array |
| `readiness` | `body_metrics` (HRV/RHR/temp), `sleep_sessions`, `oura_daily_derived` | any subset — readiness degrades gracefully per §4a of the architecture doc, never blanks |
| `activity` | `body_metrics.steps/distanceKm/activeCalories`, `activity_logs` | daily activity scalars, detected sessions |
| `cardio` | `activity_logs`, `oura_heartrate` (for HR-based training load) | activity sessions with HR, distance |
| `body` | `body_metrics` (weight/body-fat/composition panel) | any scale or manual-entry source |
| `devices` | owns the transport layer described in this whole doc | — |

A source that only supplies a subset of §3 is fine — the missing fields simply stay NULL/absent for
that user and every pillar's read path already degrades rather than blanking (§4a of
`device-agnostic-source-architecture.md`). **What is not yet true**: that degrade-gracefully promise
is stated as a design decision but "has not run against a real Health Connect provider" per the
`docs/domains/devices/README.md` reference-doc note — worth re-verifying before leaning on it for a
new source's rollout.

---

## References

- [`device-agnostic-source-architecture.md`](device-agnostic-source-architecture.md) — the goal, the
  tiers, the invariants. Read first.
- [`docs/oura-ble-operations.md`](oura-ble-operations.md) — the operations manual for the one
  raw-capable source that ships today; the reference implementation for §3e's raw-archive shape.
- [`docs/multi-device-comparison.md`](multi-device-comparison.md) — how to validate a new source
  against ground truth before trusting it for scoring.
- [`docs/superpowers/plans/2026-08-26-alternative-ring-colmi-testing.md`](superpowers/plans/2026-08-26-alternative-ring-colmi-testing.md)
  — the reference implementation for §5's isolation pattern.
- [`docs/domains/devices/README.md`](domains/devices/README.md) — the `devices` pillar index; read
  before touching any transport code.
- `lib/data/health-source.ts`, `packages/shared/src/health/source-rank.ts` — the provenance
  mechanism in code.
