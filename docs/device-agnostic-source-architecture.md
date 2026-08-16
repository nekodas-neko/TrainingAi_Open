# Device-Agnostic Source Architecture

_Owner-directed, 2026-08-02. States a goal that has shaped decisions for months without ever being
written down. Extends — does not replace —
[`offline-first-target-architecture.md`](offline-first-target-architecture.md) (where data lives)
and [`superpowers/plans/2026-08-02-native-convergence-goal-layout.md`](superpowers/plans/2026-08-02-native-convergence-goal-layout.md)
(where the UI ends up). This one settles **where the data comes from**._

---

## 1. The goal

The app must not be a client for one ring. A user switching wearables — or arriving with a Garmin,
a Fitbit or a Samsung watch and no Oura at all — gets a working app.

Two consequences the owner stated directly (2026-08-02):

- **Other people use this.** One friend has an account today. The long-term intent is production
  and a Play Store listing.
- **The Oura ring is the owner's personal enhancement, not the app's dependency.**

**Why this needs writing down.** A prior session searched every phrasing of "device-agnostic",
"wearable-agnostic", "multi-source" and "not locked to" across `docs/`, `projectOverview.md`,
`CLAUDE.md` and the backlog, and found **no statement of the goal and no entry tracking it**. The
only literal hits describe the live-HR picker choosing between ring and chest strap. The
multi-source machinery that does exist was built as a *clobber guard*, not as a portability
strategy — it is reusable for this, but nothing committed to it.

---

## 2. The distinction that makes this tractable

The useful split is **not** "Oura vs Health Connect". It is:

| | **Raw-capable sources** | **Computed sources** |
|---|---|---|
| What they emit | per-beat IBI, PPG amplitude, raw accelerometer, skin temperature | finished values — sleep stages, step counts, RHR, HRV |
| Who derives the metric | **we do**, on-device | **the vendor already did** |
| Today | Oura Ring 5 over direct BLE | Health Connect (fed by whatever the user wears) |
| Tomorrow | any ring/strap exposing raw signal | any HC-writing wearable |

This framing is the owner's (2026-08-02) and it is better than a per-vendor split, because a future
raw-capable device slots into the left column without special-casing, and every computed source
looks identical on the right.

**The practical upshot: for most users we should not be computing sleep stages or step counts at
all.** Their watch already did, and Health Connect hands us the answer. Deriving those ourselves is
only necessary for a raw-capable device — which today means the owner's ring.

### Health Connect gives more than an earlier audit implied

Verified against the pinned plugin source, not memory (per `CLAUDE.md`'s external-field rule):

- `RecordConverter.kt:81–90` serialises a **full sleep-stage array** — `startTime`, `endTime`,
  `stage` per interval. That is a hypnogram, not just durations.
- `lib/health-connect-sync.ts:401–407` already consumes it, mapping
  `SLEEP_STAGE_DEEP/REM/LIGHT/AWAKE`.

An earlier audit's "HC gives only stage durations, never IBI or PPG" answered *"can HC feed
SleepNet?"* (no) rather than *"can HC give us sleep stages?"* (yes, and we already read them).
**Sleep staging for non-Oura users is a solved problem via HC.** Note we currently reduce those
intervals to four totals and discard the structure — a hypnogram for HC users is nearly free.

---

## 3. The three tiers

All three write the **same generic tables**. That is the contract.

| Tier | Who | Source | Sleep stages / steps from |
|---|---|---|---|
| **1** | The owner | Oura BLE + local models | SleepNet / `step_counter` on-device |
| **2** | Everyone else | Health Connect | their own device's app |
| **3** | Future | our own models | replaces tier 1, calibrated against tier-1 output |

**Tier 1 is opt-in and shareable.** The owner asked that a friend be able to use an Oura ring too.
So tier 1 must be a *per-user capability*, not a hardcoded owner path: a user with a ring can point
sleep/steps at the BLE pipeline; everyone else falls through to HC. This must be an explicit,
authenticated per-user setting — never inferred, never global.

**Tier 3 has been done once.** D5 replaced Oura's daytime-HRV ONNX model with a from-scratch
per-user regression, validated against Oura's own output using the D6 comparison harness. That is
the pattern for steps and, eventually, staging. It is a quality project for tier-1 users, **not** a
portability blocker — tier 2 serves everyone else either way.

---

## 4. What this requires that does not exist yet

### 4a. The read path must degrade, not vanish

Today `readiness-score`, `health/trends`, `day-timeline` and `health-trends` read `oura_daily` /
`oura_daily_derived` **with no generic fallback**. A non-Oura user gets blank score cards.

**Decision:** compute a reduced-input version from whatever is available and label it honestly. A
blank card reads as broken; a labelled one reads as intentional. Hiding the card is the wrong
answer — it makes the app look like it has fewer features rather than less data.

### 4b. Nothing user-facing says "Oura"

**Owner decision:** remove every user-visible mention. The app is not an Oura client and should not
present as one. Scope measured 2026-08-02:

| Layer | Count | Cost |
|---|---|---|
| User-visible strings in `app/` + `components/` | ~26 | cheap — do first |
| All `Oura` references in `.tsx` | 182 | mostly identifiers |
| `oura_*` in `lib/data/postgres/schema.ts` | 22 | a migration touching sync engine, local SQLite, every read path |
| Repo-wide `oura` references | 2,813 | not a rename — a project |

Sequence: user-visible copy first (cheap, immediate), then internal identifiers, then table names
last as their own planned migration. **Do not attempt the schema rename as a drive-by.**

### 4c. Health Connect sleep bypasses the provenance layer — ✅ CLOSED 2026-08-02 (Q-43, v1.250.0)

**Fixed; kept here as the record of what was wrong.** `repo.saveSleepSession()` used to take no
`source` parameter and its implementation was a bare `onConflictDoNothing()` with no `sourceMap`
stamping, so HC sleep rows landed with null provenance (rank 0) and first-write-wins semantics —
harmless while HC was off, a real data-quality bug the moment tier 2 went live.

It now takes a **required** `source: HealthSource` (`lib/data/repository.ts:527`) and delegates to
`upsertOuraSleep` → `mergeSet('sleep_sessions', …)`, so both sleep writers share one function and
the same ranked per-field merge. **Keep `source` required** — a caller left on a default writes
rank 0 and beats the ring forever.

### 4d. `CLAUDE.md` documents a superseded merge mechanism

`CLAUDE.md` still says upserts use `COALESCE(EXCLUDED.col, table.col)`. The shipped design is
`lib/data/health-source.ts` — a ranked, per-field merge
(`manual 5 > scale_ble 4 > oura_ble 3 > oura_cloud 2 > health_connect 1`). The difference is
behavioural, not cosmetic: COALESCE is row-blind first-write-wins and can never let a better source
correct a worse value; `mergeSet` can. Anyone reasoning from `CLAUDE.md` gets this wrong.

---

## 5. What survives a device switch today

Useful as the honest baseline, and as the checklist §4a has to close.

**Survives** (stored scalars): weight, body fat and the full Renpho bioimpedance panel; steps,
distance, calories, macros; RHR, HRV, SpO₂; sleep start/end/durations/stage totals; activity logs;
workouts, sets, PRs, programs, nutrition. Live HR survives via the Polar strap.

**Does not survive** (model outputs needing raw ring signal): sleep staging, daytime HRV → stress →
resilience, the readiness composite's temperature term, illness detection, training stress score,
ring step count, Body Battery, temperature deviation.

---

## 6. Invariants

- **The generic tables are the contract.** Sources feed them; the UI reads them. A read path that
  reaches into a source-specific table without a fallback is a portability bug.
- **Per-user, never global.** Tier assignment is per-user capability. Every write stays `user_id`
  scoped — friends' health data lives in the same database, and the read-only audit endpoint is
  deliberately scoped to one user for that reason.
- **Provenance on every health write.** New source-writing paths go through `mergeSet` and stamp
  `source_map`. §4c is the current exception and is a bug, not a precedent.
- **Verify external field names against the pinned source.** The sleep-stage correction in §2
  exists because an audit reasoned from a plausible summary instead of reading
  `RecordConverter.kt`.

---

## 7. Open questions

1. **Does the Play Store ambition change the Canonical Runtime policy?** `CLAUDE.md` currently
   states "Android-only, sideloaded, no Play Store" and several decisions lean on it. Listing also
   means a privacy policy, data-safety declarations, and a **declared-use-case review for Health
   Connect access** — which is a gating dependency on tier 2, not a formality.
2. **How far does tier-1 sharing go?** A friend with a ring needs the BLE pipeline, which currently
   assumes one owner (foreground service, `WEBHOOK_USER_ID`, admin-only console). Making it
   multi-user is real work and is not scoped here.
3. **Does tier 2 need its own retention tiering?** The 14-day/1-year/uncapped split
   (goal layout §4 Stage 1a) was measured from raw BLE volume, which tier-2 users never generate.
   Their local store is far smaller; the tiers are probably fine but are unvalidated for that shape.
