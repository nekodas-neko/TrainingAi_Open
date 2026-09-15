# Q-44 Phase 3 — the discriminator audit the plan does not carry

**Measured 2026-09-15 (Lane A), against `main` and production.** The Orchestrator's 2026-09-11 note
on Q-44 says the rename plan is missing a second requirement — the owner's *"make sure we know which
sensor somewhere, so we can use the same tables for other recording devices"* — and asks for a column
audit deciding per table whether a second source ever writes there.

**Confirmed first:** `docs/superpowers/plans/2026-08-04-vendor-table-rename-phase-3.md` is 120 lines
and contains the words `source`, "discriminator" and "audit" **zero times**. The requirement is
genuinely absent, not merely implicit.

This is that audit. It reaches a conclusion the rename plan cannot absorb, so it ends with a decision
rather than a table of column changes.

---

## 1. The finding that reframes Q-44: the second device already exists, and it did NOT share a table

`colmi_*` is live in production right now:

| table | rows |
|---|---:|
| `colmi_readings` | **4,237** |
| `colmi_raw_frames` | **1,173** |
| `colmi_sleep_segments` | **158** |

So the app has already answered *"can we use the same tables for other recording devices?"* in
running code, and the answer it gave was **no — a second device gets its own vendor-named tables.**

Renaming `oura_daily` → `sensor_daily` against that background produces a generically-named table
holding one vendor's data while the other vendor sits beside it in `colmi_*`. That is precisely the
outcome the Orchestrator warned about — *"a generically-named single-vendor table, which is worse
than the honest vendor name"* — except it is not a risk to avoid, it is **the state the schema is
already in**.

## 2. The two devices use opposite schema idioms, so "the same tables" is not a rename

This is the part that decides whether Phase 3 can deliver the owner's goal at all.

| | Oura | Colmi |
|---|---|---|
| shape | **one table per metric** — `oura_heartrate`, `rr_intervals`, `oura_bucket`, … | **one table, many metrics** — `colmi_readings` with a `kind` column |
| discriminator | `source` on some tables | `kind` (what is measured), keyed `(userId, kind, measuredAt)` |
| raw frames | `oura_raw_samples` (`ring_timestamp_ds`, `tag`, `body_hex`) | `colmi_raw_frames` (`receivedAt`, `channel`, `tag`, `hex`, `seq`) |

Unifying these is not adding a column and it is not a rename. It is reconciling two designs that
disagree about what a row is. **A rename executed today would move `oura_*` to `sensor_*` and leave
`colmi_*` exactly where it is**, and the owner's requirement would be no closer than before.

## 3. Discriminator coverage, for the 11 tables the plan renames

| table | `source` column? | rows (owner) | note |
|---|---|---:|---|
| `oura_heartrate` | ✅ | 116,079 | already multi-device — **73% chest strap** |
| `oura_daily_derived` | ✅ | 147 | |
| `oura_workouts` | ✅ | 13 | |
| `oura_tags` | ✅ | 0 | |
| `oura_daily` | ❌ | 86 | dead Oura **Cloud** era; the integration was removed 2026-08-13 |
| `oura_daily_summary` | ❌ | 71 | on-device rollup output |
| `oura_bucket` | ❌ | **0** | **never written — see §4** |
| `oura_accel_chunks` | ❌ | 41 | ring protocol frames — structurally single-device, like `oura_raw_samples` |
| `oura_daytime_hrv_model` | ❌ | 1 | a fitted per-user model; the plan is right that it is not source-specific |
| `oura_ble_battery_poll` | ❌ | 10,494 | plan renames to `ring_battery_poll` — keeps a device-specific name, so needs none |
| `oura_ble_clock_anchors` | ❌ | 10,456 | same |

**4 of the 11 carry a discriminator; 7 do not.** Of those 7, three (`accel_chunks`, and both
`ble_*`) are structurally single-device and correctly keep a device-specific name under the plan's
own rules. That leaves **`oura_daily`, `oura_daily_summary` and `oura_bucket`** as the genuine
questions — and §4 answers one of them outright.

## 4. `oura_bucket` — the table this was most about — has never been written

The Orchestrator singled it out: *"`oura_bucket` is among them — the intraday rollup that a second
device would most need to share."*

**It holds 0 rows.** Renaming an empty table to `sensor_bucket` and adding a `source` column to it is
designing for a consumer that does not exist yet, against a shape that has never been exercised. If
the rollup ladder is ever built for two devices, its schema should be decided then, with a writer in
hand.

## 5. The plan enumerates 13 vendor tables; there are 18 `oura_*` alone

The backlog entry records *"Counted 13 vendor-named tables, not 22"* as a correction of an earlier
overcount. **The 22 was not an overcount** — it is the all-vendor total: 18 `oura_*` + 3 `colmi_*` +
`rr_intervals`. The plan's 13 (11 renames + 2 keeps) omits five `oura_*` tables entirely:

`oura_ble_rekey_declarations` · `oura_daytime_stress_buckets` · `oura_raw_packed` ·
`oura_redecode_jobs` · `oura_rollup_state`

A rename PR built from that list leaves the schema half-renamed, which is worse than either endpoint.
Two of the five (`oura_raw_packed`, `oura_rollup_state`) plausibly follow `oura_raw_samples` into
"keep the vendor name" — but that is a decision nobody has made, because they were not on the list.

## 6. A measurement hazard, re-confirmed in passing

`pg_stat_user_tables.n_live_tup` read **0** for three tables that are not empty:
`oura_accel_chunks` (41 real), `oura_workouts` (13), `oura_daytime_hrv_model` (1). `oura_bucket`'s
zero is real, confirmed by `count(*)`.

This is the documented trap in `CLAUDE.md` firing again — *"to ask whether a table is empty, run
`count(*)`"*. Recorded because this audit would have reported four empty tables instead of one had it
trusted the estimate, and three of those four would have been wrong.

---

## The decision, and it is the owner's

**The rename as planned does not deliver what was asked for.** The goal was *"use the same tables for
other recording devices"*; the second recording device is already here, in its own tables, with a
different row shape. Renaming `oura_*` to `sensor_*` changes 2,813 references, carries a real
regression risk the entry already flags, and leaves that goal exactly where it is.

**Recommendation: split Q-44's Phase 3 in two, and do only the cheap half now.**

1. **Rename the tables that are genuinely multi-source, and only those.** Today that is
   `oura_heartrate` — 73% of its rows are a Polar chest strap, so its name is actively wrong — plus
   `rr_intervals`, which is already vendor-neutral. Small, honest, low-risk, and it fixes the one
   name that misleads a reader today.
2. **Leave the rest vendor-named until a second writer exists**, on the plan's own `oura_raw_samples`
   argument: a generic name with no second source is a promise the schema cannot keep.
3. **File the real goal as its own entry**: reconciling `colmi_*` and `oura_*` into shared tables.
   That is a design problem about what a reading is, not a rename, and it is where the owner's
   requirement actually lives.

**Why this over renaming everything:** it costs a fraction of the 2,813 references, it removes the
one genuinely misleading name, and it stops the schema advertising a portability it does not have.
The alternative — rename all 18 and add `source` columns speculatively — is more work, more
regression surface, and ends with `colmi_*` still beside it.

**Why this over doing nothing:** `oura_heartrate` is 73% chest-strap data. That one is not hygiene;
it is a name that will mislead whoever reads it next, and it is cheap to fix.

**Reversal cost: low for (1), high for the alternative.** A single-table rename behind a compatibility
view is reversible in one migration; a 2,813-reference sweep is not something anyone will undo.
