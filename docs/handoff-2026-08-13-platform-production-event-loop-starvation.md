# Handoff — production instability is event-loop starvation from the BLE rollup, not connection contention

**Date:** 2026-08-13 · **Domain:** `platform` (secondary: `devices`, `heart-rate`)
**Branch:** `claude/trainingai-production-outage-lfbgq7`
**Status:** **resolved as far as narrowing can resolve it, and verified against a real ring sync.**
Ten PRs landed. Stage 2 (moving the rollup off the request thread) is the one piece left, and it now
has measured justification rather than a principled one.

> **⭐ For picking up work, start with**
> [`docs/handoff-2026-08-13-cross-combined-backlog-handover.md`](handoff-2026-08-13-cross-combined-backlog-handover.md)
> — it reconciles this session with the other one that ran in parallel on 2026-08-13, into a
> single queue and pickup prompt. This file stays as the detailed record.

| PR | Version | What |
|---|---|---|
| #1295 | 1.302.2 | The diagnosis. Plus Q-215 — a repeated timestamp discarded a whole 5,000-row HR batch (2,472 occurrences). |
| #1296 | 1.302.3 | Barcode said "not in the database" during an Open Food Facts outage. `unavailable` and `notFound` are now separate answers. |
| #1297 | 1.303.0 | **Q-213 Stage 1** — the rollup re-derives only the span a sync touched. Benchmarked 10,560 ms → 930 ms. |
| #1298 | 1.303.1 | Q-218 — the AI food-scan route reports its failures instead of only logging them. |
| #1299 | — | Handoff correction. |
| #1300 | 1.303.2 | The watermark — a restart no longer re-derives 35 days. Fixes a regression #1297 introduced. |
| #1301 | — | Q-219 filed: 54% of the database was indexes. |
| #1302 | 1.303.3 | The rollup covers **both** the watermark and the incoming batch. Fixes a gap #1300 introduced. |
| #1303 | — | Owner's device-primary decision recorded; Q-219 closed (owner ran the REINDEX). |
| #1304 | — | Q-187 phase 2 planned (nutrition — separate line of work). |

**✅ Verified on production, 2026-08-13 15:47 Brisbane**, on a real ring sync:

| | duration | CPU | memory |
|---|---|---|---|
| before Stage 1 | 15–30 min | 1.0–1.8 | 0.9–2.2 GB |
| cold start, Stage 1 only (14:45) | 6 min | 1.8 | 2.19 GB |
| seeding pass, watermark live (15:47) | **2 min** | **0.815** | **0.553 GB** |

Watermark row populated: `last_rolled_ds = 33595063, epoch = 2`.

**⚠️ The one gap narrowing cannot close.** At 15:47:33 a concurrent
`POST /api/oura-ble/samples` still returned **500 after 27.6 s** —
`getNewestOuraClockAnchorByUtc` failing with `Connection terminated due to connection timeout` while
that 2-minute rollup held the thread. A non-2xx there holds the ring's history cursor and triggers a
re-drain, which is the storm mechanism. **A rollup on the request thread can always starve a request
landing beside it**; narrowing only shortens the window. That is Stage 2, and this is the first hard
evidence it is necessary rather than tidy.

**Two regressions were introduced and fixed within this session** — both worth reading before
touching this code, because both were found by *watching production*, not by reading it:
#1300 fixed #1297's cold-start pass (six minutes of a pegged thread on every deploy, and the PR that
shipped it called that "expected, not a regression"), and #1302 fixed #1300 taking the caller's span
*instead of* the watermark rather than as well as it.

---

## 1. What this session was asked to do

Pick up an undiagnosed intermittent production outage, read the Railway deploy logs, and establish
what the Node process is doing while it holds all ten of its pool connections — explicitly *without*
shipping the workout-data fan-out change (Q-213's leading hypothesis) on the hypothesis alone.

**A correction to how this session started.** The prior handoff
([`docs/handoff-2026-08-13-platform-production-connection-starvation.md`](handoff-2026-08-13-platform-production-connection-starvation.md))
and backlog entries Q-213…Q-216 appeared not to exist, so the diagnosis below was re-derived from
scratch. They did exist — on **PR #1292's unmerged branch**, which merged partway through this
session. The initial `git fetch` timed out at two minutes, leaving a stale remote-branch list, and
that was read as "never committed" rather than "not fetched". **A grep of `main` and the open-PR
*list* does not see work sitting in an open PR's *files*.** That mistake cost a duplicate Q-213 and a
collided Q-215, both reconciled here.

The re-derivation was not wasted: the prior session's leading hypothesis was the fan-out, and it is
refuted below. But the accurate version of this section is "the evidence was hard to find", not "the
evidence was lost".

## 2. The finding, in one paragraph

The Node process spends 15–30 minutes at a stretch with its **single main thread pegged at 100%**,
running `aggregateOuraRawSamples` — a 1,084-line rollup that decodes a 35-day window of
`oura_raw_samples` in JavaScript and runs SleepNet ONNX per night. `oura_raw_samples` now holds
**984,862 rows**, and the ring has only been streaming since 2026-07-07 (~37 days), so the "35-day
incremental window" currently covers **essentially the whole table**. One run costs more wall-clock
than the gap between BLE syncs, so runs go back-to-back and never let the event loop breathe.
Everything else on the process starves. The DB connection failures are a **symptom**, not the cause:
`pg`'s connect-timeout is a JS `setTimeout`, and on a blocked loop it fires late and kills healthy
connections, producing `Connection terminated due to connection timeout` against a database that is
answering in milliseconds.

---

## 3. Evidence

Railway project `Training-Ai` (`38270134-789b-4d82-b32a-8552479a74c6`), service `TrainingAI`
(`bdd6ac08-9b01-4115-906f-604277ff1d87`), env `production`
(`ad299071-5198-4956-aded-a94f974019fa`). `RAILWAY_API_TOKEN` is present and is a **project token**,
not a personal one — `me`/`projects` return `Not Authorized`. Use the
`Project-Access-Token: $RAILWAY_API_TOKEN` header, not `Authorization: Bearer`. That one detail
costs an hour if you don't know it.

### 3.1 CPU is the proof

`CPU_LIMIT` is 8 cores. Idle CPU is **0.001**. Across both degraded windows on 2026-08-12:

| Window (UTC) | Window (Bne) | CPU | Memory |
|---|---|---|---|
| 22:40 – 22:55 | 08:40 – 08:55 | sustained 1.1 – 1.6 | 0.9 – 1.07 GB |
| 23:28 – 23:57 | 09:28 – 09:57 | sustained 0.8 – 1.6, peak **2.96** | 0.9 – **2.14** GB |
| between (22:55 – 23:27) | 08:55 – 09:27 | **0.001** | 0.38 GB |

Sustained ≥1.0 on a Node process means one full core is busy continuously — and Node has exactly one
main thread. The excess above 1.0 is the libuv pool and ONNX Runtime's intra-op threads. Idle memory
is 0.38 GB; the rollup adds 0.5–1.7 GB, which is the decoded row set plus the ten filtered copies
`rowsByTags()` makes of it.

### 3.2 `/api/version` is the control

`/api/version` touches no database. Its only outbound call is `lookupLatestApkRelease()`, which is
bounded by `AbortSignal.timeout(5_000)` and cached with `next: { revalidate: 300 }`. It cannot
exceed about 5 seconds on its own merits.

Measured during the window: **max 122,044 ms, mean 24,723 ms** across 25 requests. Measured now, with
the app healthy: **5 ms**. A route that cannot be slow was slow for two minutes. Nothing but
event-loop starvation explains that — and note the 5 s abort is itself a JS timer, so it could not
fire either.

### 3.3 The self-sustaining loop, from the HTTP logs

```
23:29:09  200  up=    258ms  /api/oura-ble/samples   ← healthy
23:29:12  200  up=   2283ms  /api/oura-ble/samples   ← rollup starts in background
23:29:53  200  up=  13419ms  /api/version
23:31:49  499  up= 115329ms  /api/version
23:32:07  499  up=  29857ms  /api/oura-ble/samples   ← 30s native readTimeout → cursor held
23:33:48  499  up= 122044ms  /api/version
23:43:15  502  up=   7820ms  /api/hr-ingest          ← container killed
```

`/api/oura-ble/samples` returning 499 is the dangerous part. The native client
(`OuraRingService.kt`) aborts at a 30 s `readTimeout`; a non-2xx means the ring's history cursor does
**not** advance, so the device re-drains the same batch, which triggers another rollup. The route's
own comment predicts this storm and claims backgrounding the rollup prevents it. **It does not.**
Backgrounding stops the rollup holding *that* response; it does nothing about the rollup starving the
*next* one. The storm still happens — it just arrives via a different door.

`/api/hr-ingest` shows a clean 30 s sawtooth (`up=29.8s → 499`, every ~30 s) — the chest strap
retrying on a fixed cadence and being starved every time.

### 3.4 The trigger correlates exactly, twice

`[oura-models] "…onnx" loaded from object storage` is logged once per file per process
(`sourceLogged` in `lib/oura-models/inference/session.ts`), so each line marks the **first rollup run
in that container**:

| Container | Started | First sleepnet load | CPU ramp begins |
|---|---|---|---|
| `e00f00e5` | 22:37:38 | **22:40:32** | **22:40** |
| `4bf9360b` | 23:24:20 | **23:28:14** | **23:28** |

Two containers, two first-rollups, two CPU ramps, each in the same minute.

### 3.5 This is chronic, and today's deploys did not cause it

Seven days of CPU at 10-minute resolution:

| Bne day | mins > 0.5 CPU | mins > 1.0 CPU | peak |
|---|---|---|---|
| 08-06 | 220 | 170 | 5.52 |
| 08-07 | 220 | 80 | 4.39 |
| 08-08 | 230 | 170 | 5.04 |
| 08-09 | 210 | 60 | 4.47 |
| 08-10 | 180 | 60 | 4.35 |
| 08-11 | 340 | 210 | 4.79 |
| 08-12 | 280 | 140 | 2.90 |

The app has been burning **3–5.5 hours a day** with at least half a core busy, and **1–3.5 hours a
day** with a full core or more pegged, for at least a week — with *higher* peaks on earlier days than
today. The busiest blocks cluster overnight and early morning (02:20, 03:30, 04:30, 06:40, 07:30),
which is the ring drain, not user traffic.

**So the three PRs that merged between 08:10 and 08:50 Brisbane are not the trigger.** They are why
the owner *noticed* — three container swaps during their morning, on top of a fault that was already
there every day. Correcting this matters: the earlier framing invited a rollback that would have
fixed nothing.

### 3.6 Why Q-213 (the workout-data fan-out) was the wrong fix

The pickup brief flagged it as a hypothesis and said to confirm before shipping. It is refuted. A
route fanning out DB queries would show CPU near zero while blocked on I/O, and could never make
`/api/version` — which issues no query — take 122 seconds. Both predictions fail. Do not ship it.

---

## 4. The mechanism, precisely

`lib/data/postgres/adapter.ts:4929`, `aggregateOuraRawSamples`:

1. `ROLLUP_WINDOW_DAYS = 35`. The ring's whole history is ~37 days, so the bound excludes almost
   nothing. This optimisation was correct when written and has quietly become a no-op as the table
   grew.
2. One query selects every row in the window across 15 tags, then `.map()`s each through
   `hexToBytes` + `decodeEventBody` — **pure main-thread JS over hundreds of thousands of rows**.
   Storing `decoded` was deliberately dropped (Lever 1) to save disk; that trade is now being paid in
   CPU on every single run.
3. `rowsByTags()` then `.filter()`s the full decoded array **ten separate times**, one per tag group
   — ten full scans and ten retained copies. This is the memory jump.
4. Per night in the window, SleepNet runs on a 345,600-float input. Assembling that input is also
   main-thread JS. `session.run()` itself is off-thread (onnxruntime-node 1.27 uses a napi async
   worker), so inference is *not* the blocker — the preprocessing around it is.

Trigger frequency, `app/api/oura-ble/samples/route.ts`: `ROLLUP_COALESCE_MS = 8000` throttles bursts,
but `isFinalOrSmallBatch` (`frames.length < 255`) **bypasses coalescing entirely**. Every ordinary
live sync is a small batch, so every live sync triggers a full whole-table rollup. The
`rollupInFlight` guard prevents overlap but not back-to-back scheduling: a run finishes, the next
sync arrives, another run starts.

---

## 5. Fix options (owner decided 2026-08-13: build the correct fix; Stage 1 = B, shipped)

None of these is obviously correct; they trade differently and one of them is a reversal of a
deliberate past decision.

- **A — Move the rollup off the main thread** (`worker_threads`). Fixes the blocking outright and is
  robust to further data growth, because it stops mattering how long a run takes. Largest change;
  the worker needs its own DB access or a data-passing boundary.
- **B — Make the rollup genuinely incremental.** Recompute only the days a batch actually touched
  instead of re-deriving 35 days each time. Best asymptotics, and attacks the real defect. Requires
  care with the look-back windows (21 d resilience, 14 d HR series) and the baseline checkpoint fold.
- **C — Re-persist `decoded`** (reverse Lever 1). Removes the per-run hex-decode cost, likely the
  single largest slice. Cheap to implement, costs disk, and undoes a decision made on purpose.
- **D — Throttle only** (drop the small-batch coalescing bypass, raise the floor to minutes). A few
  lines, ships today, caps the duty cycle. Does **not** reduce per-run cost — it converts "pegged
  continuously" into "pegged periodically", which is mitigation, not a fix.

**Recommendation: D now as a stopgap, then B (optionally with C) as the real fix.** A is the most
robust but is the largest change to make while production is unstable.

Two constraints on any of them: nothing here is device-verifiable in the sandbox (native SQLite and
the Capacitor BLE plugin do not run here), and merging auto-deploys to Railway.

---

## 6. Separately: a real data-loss bug in the chest-strap ingest (Q-215 — FIXED in this PR)

Not the outage cause — it happened at 00:17 when CPU was 0.076 — but genuine and independent.

`upsertOuraHeartrate` (`lib/data/postgres/slices/oura.ts:393`) inserts in chunks of 5,000 with
`onConflictDoUpdate` targeting `(user_id, timestamp)`, and **does not dedupe within the batch**. Two
chest-strap samples sharing a timestamp make Postgres raise `ON CONFLICT DO UPDATE command cannot
affect row a second time`, which fails the **whole chunk** — up to 5,000 HR points discarded, not
just the duplicate. Observed 8 times in a row at 1 Hz, so the device retries and the batch fails
identically every time; those samples are lost permanently.

**Fixed in this PR** (v1.302.2): deduped by `(userId, timestamp)`, last value wins, inside
`upsertOuraHeartrate` so every caller inherits it. Verified by mutation — reverting the dedupe fails
all three new tests with the production error text. The prior session counted **2,472** occurrences
in `error_events`, so the real loss was far larger than the 8 consecutive failures the deploy logs
show.

---

## 7. Also seen, recorded so it isn't dropped

- `[token-crypto] TOKEN_ENC_KEY unset — token writes will fail closed` on **every** cold start.
  Token writes are failing closed in production right now. Either the var belongs in Railway or the
  log is lying about severity.
- `[oura/token] ring_configuration failed: Oura API 401 … token is expired, revoked, malformed`, and
  `[post-completion-hr] sync … 401`. The Oura Cloud PAT is dead. Per `CLAUDE.md` this is expected
  after the BLE re-key and is *not* a freshness signal — but the app still calls the API on a
  completion path and logs an error every time.
- `claude_ro.error_events` cannot see any of this. The app must reach the DB to write an error row,
  and during these windows it cannot. A quiet `error_events` is not a quiet production.

---

## 8. Deliberately not done

- No code change. The brief said to confirm before shipping, and the fix direction needs an owner
  call.
- PR **#1292** (check-in save fixes, v1.302.1) left unmerged on purpose. It is CI-gated and ready,
  but merging swaps the container, and doing that during instability is the wrong move. Merge it once
  production is stable. It is **not** device-verified: the on-device check is a force-stop, reopen,
  and tap Save on the readiness sheet within a second or two of the app appearing.
- No analytical query was run against `claude_ro.oura_raw_samples`. The row count above came from
  `pg_stat_user_tables.n_live_tup`, which is a catalog read and costs nothing (32 ms).

---

## Pickup prompt

```
You are picking up TrainingAI backlog work. A previous session resolved a production outage; that is
done bar one piece, and the queue is otherwise normal. Cut a branch fresh from main.

ORIENT (in this order):
  1. projectOverview.md — status and the live Known Issues table
  2. docs/domains/platform/README.md and docs/domains/nutrition/README.md
  3. docs/handoff-2026-08-13-platform-production-event-loop-starvation.md — this file
  4. docs/implementation-backlog.md — work it top-down per the protocol at the top

THE QUEUE, as of 2026-08-13:

  Q-213 Stage 2 — move the BLE rollup into a worker_thread. THE ONE OUTAGE PIECE LEFT, and it now has
    measured justification: with Stage 1 and the watermark both live, a concurrent ingest still
    returned 500 after 27.6s while a 2-minute rollup held the thread. A non-2xx on
    /api/oura-ble/samples holds the ring's history cursor and triggers a re-drain — the storm
    mechanism. Backgrounding the rollup does NOT prevent this and never did; it stops the rollup
    holding its own response, not starving the next one. The worker needs its own small pg pool
    (max 2), onnxruntime-node must initialise inside the worker, and total connections must stay
    under the Railway limit. Plan:
    docs/superpowers/plans/2026-08-13-oura-ble-rollup-incremental-and-off-loop.md
    Stage 3 in that plan is deliberately DEPRIORITISED — read the Q-213 entry for why before doing it.

  Q-187 phase 2 — meal-plan prefill with a yes/no per meal. PLANNED, ready to build:
    docs/superpowers/plans/2026-08-13-meal-plan-prefill-and-confirmation.md
    Two findings shape it: keep unconfirmed prefills OUT of food_logs (24 readers would otherwise each
    need a new filter, in the domain with the worst data-loss history here), and only "no" needs
    storing ("ate it" stays derivable from the day's food, as phase 1 does it).

  Q-214, Q-216, Q-217, Q-212, Q-206, Q-211 — ordinary queue items, unblocked.

  D4 / Q-30 — owner decided 2026-08-13 that device-primary is the direction, because the current
    shape does not support many users. Measured: 364MB raw against 1.6MB derived, ~231x, or
    ~3.6GB/year/user versus ~16MB. This needs a PLANNING session, not code — two things are unsettled
    and they decide whether D4 is a migration or a data-loss event: the device copy is a 14-day
    rolling cache today (an archive cannot live inside that), and "Restore from cloud" has nothing to
    restore an archive from once the server stops holding raw frames.

CONSTRAINTS THAT WILL OTHERWISE COST YOU AN HOUR EACH:
  - RAILWAY_API_TOKEN is a PROJECT token. Use header `Project-Access-Token: $RAILWAY_API_TOKEN`
    against https://backboard.railway.com/graphql/v2. `Authorization: Bearer` returns Not Authorized
    on every query, which reads like a bad token and is not.
  - Railway httpLogs carries upstreamRqDuration per request and is the single most useful view for
    any latency question. It pages via anchorDate/beforeLimit/afterLimit — NOT startDate/limit, which
    is what deploymentLogs uses.
  - claude_ro.error_events cannot see an outage where the app cannot reach the DB, and it is
    row-scoped to one user. A quiet error_events is not a quiet production.
  - The claude_ro endpoint is READ-ONLY by role. It cannot run DDL — REINDEX, VACUUM and similar are
    owner actions.
  - Do not run analytical queries against claude_ro.oura_raw_samples (~987k rows). pg_stat_user_tables
    and pg_class answer size questions from the catalog in milliseconds.
  - claude-ro-readonly-role.test.ts pins a specific claude_ro views migration and rebuilds the schema
    from it. Re-point it in the same commit as any new views migration. A green suite does NOT prove
    the pin is current — only that no TABLE has been added since (a column-only migration hides it).
  - scripts/local-db/migrate.js can mark a migration applied even when a statement inside it errored,
    leaving the local schema wrong and the failure attributed to your change. If a claude_ro coverage
    count is off by one, drop the schema and re-apply the migration by hand before believing it.
  - Claim a Q number against open PR *files*, not just the queue and the PR list — work sitting in an
    unmerged PR is invisible to a grep of main. This cost a duplicate Q-213 and a collided Q-215.
  - Nothing in the BLE, local-SQLite or notification areas is device-verifiable in the sandbox. The
    owner uses the app daily on a Samsung S25 Ultra; batch deploys away from their morning.
  - Local SQLite v25 has still never run on a phone. If Saved Meals comes up blank after an update,
    REVERT rather than debug forward — that is the signature of a failed local upgrade.

FIRST ACTION: read projectOverview.md, then pick the top unblocked queue item. If you take Q-213
Stage 2, start by confirming from Railway CPU metrics that the sustained 1.0-1.8 plateaus have stopped
recurring since 1.303.3 — that is the baseline Stage 2 has to improve on.
```
