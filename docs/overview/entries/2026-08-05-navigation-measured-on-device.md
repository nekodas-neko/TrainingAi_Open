# 2026-08-05 — Navigation measured on the S25 at last: it is not the network

**Domain:** app-shell · **Source:** owner device capture, app v1.256.4, SM-S938B, 22 samples

## The numbers

| | ms |
|---|---|
| median settle | **146.2** |
| p95 settle | 270.4 |
| worst settle | 1348.7 |
| median url (press → URL change) | 115.3 |
| median paint | 126.4 |

**warm 22 · cold 0 · settle-timeouts 0.**

Slowest routes by median settle: `/more` 205.7, `/` 191.9, `/admin/data-capture` 147.5,
`/nutrition` 147.5, `/admin` 131.3. Nothing above ~206 ms as a median.

## What it settles

**Navigation is fast, and the network is not the bottleneck.** 146 ms median is well inside the
range that reads as immediate. More decisively: **not one of the 22 navigations made an RSC payload
fetch.** There was no cold navigation to warm.

**That reframes the perf work.** The whole prefetch line of reasoning — #1062's four warmed targets,
and Q-70's proposal to prefetch the session list on press — is aimed at removing a network fetch
that, in this capture, never happens. Prefetching cannot improve a number whose network component
is already zero.

**The worst sample proves the point.** `/cardio` → `/workout` at **1348.7 ms — with `rscCount: 0`.**
No network at all. That 1.3 s is entirely client-side: render, layout, and whatever the workout tab
does on mount. It is ~9× the median and it is pure main-thread work.

So the remaining "not quite swift" feeling, to the extent it is real, is a **rendering** cost, not a
fetching one. That is what the big-file work (Q-51: `session-select-content.tsx` at 1,453 lines,
`workout-screen.tsx` at 1,815) actually addresses — and it is the first evidence that has pointed
at it rather than at the network.

## Second capture, same session — the workout tap, measured

The owner re-ran it having tapped into a workout. 12 samples, and the gap above is closed:

| route | n | median settle | worst | warm/cold |
|---|---|---|---|---|
| **`/workout?session`** | **4** | **115.4 ms** | 119.5 | **4 / 0** |
| `/workout` | 5 | 103.2 | **1086.4** | 5 / 0 |
| `/more` | 1 | 165.7 | — | 1 / 0 |

**Tapping a session is 115 ms, and it was warm all four times.** That closes the original complaint
and **refutes Q-70** rather than merely leaving it unsupported: there is no cold payload fetch on
that navigation to remove, so prefetching the session list cannot make it faster. Both "Start
Workout" taps measured 119.5 and 115.5 ms.

## The real finding: the workout screen's FIRST mount costs ~1 second

Both captures contain exactly one ~1 s outlier, and both land on **`/workout`**, and both are
**warm**:

| capture | from → to | settle | rscCount |
|---|---|---|---|
| 1 | `/cardio` → `/workout` | 1348.7 ms | **0** |
| 2 | `/workout?session` → `/workout` | 1086.4 ms | **0** |

In capture 2, `/workout` was visited **5 times**: four at ~100 ms and one at 1086 ms. Same route,
same session, 10× spread — and `/workout?session` → `/workout` measured **121.3 ms** on a *later*
tap ("Back to sessions") versus 1086 ms on the outlier.

That shape is a **first-mount cost**: the workout screen does ~1 s of client-side work the first
time it renders, then ~100 ms once React has it mounted and warm. No network is involved in either.

**This is the whole remaining perf story**, and it is squarely Q-51's territory —
`session-select-content.tsx` (1,453 lines) and `workout-screen.tsx` (1,815). Splitting or
lazy-loading those is now the only change with a measurement behind it, and the metric to move is
*first mount*, not median.

## Also confirmed by the same capture

- **`nativeVersionStatus: "unconfigured"`** — `GITHUB_RELEASES_TOKEN` is still unset in Railway, so
  the update card cannot work and More → Download APK still fails.
- **`/api/oura-ble/device-metrics` returns `{"days": []}`** — empty on a device that has been
  ingesting all day. Worth a look; not investigated here.

## The ingest failures — noisy, and NOT lossy

The BLE service log is full of `ingest POST failed`: timeouts on most drains, plus HTTP 500, 502 and
one 403. The plugin's own counters read `ingestPosted: 101550` against `ingestStored: 71179` — a
30% gap that looks exactly like data loss.

**It is not.** Checked against production rather than inferred:

| | |
|---|---|
| device cursor | 26 389 620 |
| server `max(ring_timestamp_ds)` | **26 389 619** |

The cursor points at the *next* frame to fetch, so the server holds **everything the ring has
produced**. 809,512 frames total. The posted-vs-stored gap is **dedup on re-send** — the table keys
on `(user_id, ring_timestamp_ds, tag, body_hex)` and the retry design re-posts whole batches, which
is exactly what `docs/oura-ble-operations.md` describes. Nothing is missing.

Worth recording that the near-miss was one query away from being reported as a 30% loss.

`error_events` holds **no** server error for these ingest failures in the last 36 hours, which fits:
timeouts and 502s never reach the application, so there is nothing for the app to record. The single
recurring entry in that window is the hydration error (13 hits, latest 21:05).


---

# Correction — the chest strap IS recording; the per-set attribution is what fails

I reported *"26.1% of sets have HR (152/582)"* and framed a strap run as a test of whether the strap
records at all. **That was a misleading number and the wrong framing.** 26% is a **lifetime**
aggregate over every set ever logged, dominated by history from before the strap existed. The owner
pushed back that the HR looks strap-grade, and they were right.

Per session, recent history:

| date | sets | with HR | % |
|---|---|---|---|
| 2026-08-02 | 15 | 0 | **0** |
| 2026-08-01 | 18 | 15 | 83 |
| 2026-07-30 | 36 | 0 | **0** |
| 2026-07-27 | 14 | 14 | 100 |
| 2026-07-26 | 15 | 0 | **0** |
| 2026-07-24 → 07-18 | 94 | 94 | **100** each day |

**Seven consecutive sessions at 100%.** The strap works.

## The actual defect is narrower and more interesting

The three zero days are **not** missing heart-rate data. Checked against `oura_heartrate` over each
session's own start→complete window:

| date | session | HR samples in window | sets with HR |
|---|---|---|---|
| 2026-08-02 | Pull | **229** | 0 |
| 2026-07-30 | Upper | **284** | 0 |
| 2026-07-30 | Legs | **248** | 0 |
| 2026-07-26 | Pull | **949** | 0 |
| 2026-08-01 | Lower | 287 | 15 of 18 |

**HR was captured for every one of those workouts.** Hundreds of samples sit inside the session
window. The per-set attribution simply did not run — or ran and wrote nothing — for those sessions,
while an adjacent session with a comparable sample count attributed fine.

`hr_synced_at` is **false on all five**, including the one that worked, so it is not the gate.

**That reframes Q-11 completely.** The entry reads *"`set_hr_stats` has usable HR on ~20% of sets"*,
which sounds like a sensor-coverage problem needing a device check. It is not. It is an
**attribution bug on the server**, reproducible from data already in production, and it needs no
device at all.

`workout_hr_stats` remaining at **0 rows** is a separate and still-open gap — that summary has never
been written for any session, including the 100% ones.
