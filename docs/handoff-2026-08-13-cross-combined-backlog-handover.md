# Handoff — 2026-08-13 · combined: two parallel sessions, one queue

**Date:** 2026-08-13 · **Domain:** `cross` (platform · devices · heart-rate · nutrition · workouts)
**Status:** both sessions closed. `main` at **v1.304.0**. Nothing of either session left open.

**This is the single door for the next agent.** Two agents ran in parallel today and each wrote its
own handoff. Both remain as the detailed record; this file reconciles them, corrects two places where
they disagreed with each other or with measurement, and carries the one pickup prompt.

| Detailed record | Covers |
|---|---|
| [`…-platform-queue-drain-owner-decisions.md`](handoff-2026-08-13-platform-queue-drain-owner-decisions.md) | The queue drain — nine PRs, four owner decisions built, ownership coverage |
| [`…-platform-production-event-loop-starvation.md`](handoff-2026-08-13-platform-production-event-loop-starvation.md) | The production outage — ten PRs, diagnosis, fix, verification |
| [`…-platform-production-connection-starvation.md`](handoff-2026-08-13-platform-production-connection-starvation.md) | The session that first found the outage. **Superseded on cause** — see below |
| [`…-nutrition-meal-plan-build-out.md`](handoff-2026-08-13-nutrition-meal-plan-build-out.md) | The nutrition lane, earlier the same day |

---

## 1. What landed today

Nineteen PRs across the two sessions, v1.302.1 → **v1.304.0**.

**Queue drain (#1281 lane):** Q-155 ownership guards on the 13 tables with no `user_id`, each
mutation-verified · Q-204 direction B's gates measured · Q-203/Q-205 ring battery off Home and
More/Profile reading the live value · Q-202 prescriptions follow your last real session · Q-185 a
deload lightens every exercise · Q-189 the unreachable chat surface and read-aloud deleted · Q-72
sleep baselines on a 14-night median (partial) · Q-206 filed.

**Outage lane (#1295–#1304, #1307):** the diagnosis · Q-215 the HR batch-dedupe data loss · barcode
telling the truth during an Open Food Facts outage · **Q-213 Stage 1** · Q-218 scan-failure reporting
· the rollup watermark · Q-219 the index bloat · the watermark/batch span fix · the owner's
device-primary decision · Q-187 phase 2 planned.

## 2. Three corrections — read these before trusting either handoff

### 2.1 The outage cause: event-loop starvation, not pool contention

The earliest handoff named **connection-pool contention** and pointed at a `/api/workout-data`
fan-out. That is **refuted**, and the queue-drain agent has already deferred rather than defended it.

The confirmed cause is **event-loop starvation**: `aggregateOuraRawSamples` re-decoded a 35-day window
of `oura_raw_samples` (986,959 rows against ~37 days of history — effectively the whole table) on
every BLE sync, holding Node's single main thread for 15–30 minutes. The DB connection errors were
downstream: `pg`'s connect timeout is a JS `setTimeout` and fires late on a blocked loop, killing
healthy connections while the database answers in milliseconds.

**The control that settles it:** `/api/version` touches no DB and is capped at 5 s. It measured
**122,044 ms**. Do not ship the fan-out change.

### 2.2 "Custom rules pass" — the real numbers are 31 and 20, not 35 and 4

Both sessions got this partly wrong, in opposite directions. Measured from the YAML today
(`yaml.safe_load`, the job whose `name` is `Custom Rules`):

| | count |
|---|---|
| run-steps in the job | **31** |
| of those, invoking a `scripts/*.js` | **20** |
| inline grep rules, no script | **11** |
| what `ls scripts/check-*.js` gives | **20** (not 4) |

So the outage session's repeated **"all 20 custom rule checks passed" ran 20 of 31** — accurate about
what it ran, but the phrase overstated coverage. **Nothing shipped unverified**: CI runs all 31 and
every PR was green. The gap was in the local pre-flight claim only.

The 11 that a script sweep misses are inline greps, and several bear on what was touched today:

```
No UTC date slicing · No hardcoded PPL session names · No hand-rolled safe-area insets
No PRAGMAs in local SQLite upgrade statements · No pt-safe stacked with another pt- class
No pb-safe* stacked with another pb-/py-/p- class · No fixed bottom-N outside bottom-nav.tsx
Safe-area utility classes must be defined · No nested button inside a role=button wrapper
No JSON.parse of free-text LLM output in AI routes
No hand-rolled invalidateCache outside lib/cache-groups.ts
```

**Q-206 is the fix and is not built.** Until it is, run the job by parsing the YAML and printing how
many steps ran — a count you can check beats a pass you can't.

### 2.3 Q-72's correlation is not an acceptance measure

`r` moved −0.220 → −0.226 and that is not a failure of the fix. **33 of 39 owner ratings sit in two
adjacent bins**, so the statistic cannot resolve an improvement. Do not tune against it. The entry
says so.

## 3. The queue

**Take the top item that does not need an owner decision.**

| Item | State |
|---|---|
| **Q-206** | Filed, not built. The local gate runs 20 of 31 checks. Small, self-contained, and it makes every later verification honest — a legitimate first task. |
| **Q-213 Stage 2** | Move the BLE rollup into a `worker_thread`. **The one outage piece left**, with measured justification (§4). Plan: [`plans/2026-08-13-oura-ble-rollup-incremental-and-off-loop.md`](superpowers/plans/2026-08-13-oura-ble-rollup-incremental-and-off-loop.md). Stage 3 in that plan is deliberately deprioritised — read the entry for why. |
| **Q-187 phase 2** | Planned, ready to build: [`plans/2026-08-13-meal-plan-prefill-and-confirmation.md`](superpowers/plans/2026-08-13-meal-plan-prefill-and-confirmation.md). Keep unconfirmed prefills **out** of `food_logs` (24 readers would each need a new filter); store only "no". |
| **Q-214, Q-216, Q-217, Q-212** | Ordinary, unblocked. |
| **D4 / Q-30** | Owner confirmed device-primary 2026-08-13. Needs a **planning** session, not code (§5). |

**Owner, not you:** Q-211 · Q-72 · Q-147 · Q-168 (device time).

## 4. Why Stage 2 is necessary, not tidy

Stage 1 and the watermark are live and verified on a real ring sync:

| | duration | CPU | memory |
|---|---|---|---|
| before Stage 1 | 15–30 min | 1.0–1.8 | 0.9–2.2 GB |
| cold start, Stage 1 only | 6 min | 1.8 | 2.19 GB |
| seeding pass, watermark live | **2 min** | **0.815** | **0.553 GB** |

**And it still was not enough.** At 15:47:33 a concurrent `POST /api/oura-ble/samples` returned **500
after 27.6 s** — `getNewestOuraClockAnchorByUtc` failing with `Connection terminated due to connection
timeout` while that 2-minute rollup held the thread. A non-2xx there holds the ring's history cursor
and triggers a re-drain: the storm mechanism.

**A rollup on the request thread can always starve a request landing beside it.** Narrowing shortens
the window; only a worker removes it. Backgrounding does **not** achieve this and never did — it stops
the rollup holding its *own* response, not starving the next one.

## 5. The owner's device-primary decision

Confirmed 2026-08-13: majority of data on the phone, only summaries and rollups on Railway, *because
the current shape does not support many users*. Measured:

| | size |
|---|---|
| raw / timeseries | **364.4 MB** |
| derived / summary (what the app renders) | **1.6 MB** |
| | **231×** |

~3.6 GB/year/user versus ~16 MB. Ten users is ~36 GB/year today, ~160 MB device-primary.

**Two things it does not settle, and they decide whether D4 is a migration or a data-loss event:**
the device copy is a **14-day rolling cache** today (an archive cannot live inside that window), and
"Restore from cloud" has nothing to restore an archive *from* once the server stops holding raw
frames.

## 6. Method notes worth more than the code

- **Both sessions' worst errors were caught by measuring, not by reading.** Q-72's filed premise was
  wrong on two counts and only measurement found it. The outage session shipped **two regressions and
  fixed both within the session** — a cold-start pass its own PR called "expected, not a regression"
  which measured at six minutes of a pegged thread per deploy, and then a span resolver that took the
  caller's value *instead of* the watermark. The second was caught because a number disagreed with a
  prediction: 2 minutes where 6 was expected.
- **A performance change's cost model is a claim about production**, and only production settles it.
  Both wrong predictions were written confidently in PR bodies.
- **Verify every new test by mutation.** One guard was found unreachable (deleting it failed zero
  tests); one harness reported four working guards as broken.
- **Re-verify a backlog entry's premise before implementing.** Six worked yesterday had premises that
  did not survive reading; two were wrong in ways that would have produced the wrong fix.

## 7. Environment traps

- **`RAILWAY_API_TOKEN` is a PROJECT token.** Header `Project-Access-Token: $RAILWAY_API_TOKEN` against
  `https://backboard.railway.com/graphql/v2`. `Authorization: Bearer` returns `Not Authorized` on
  every query, which reads like a bad token and is not.
- **Railway `httpLogs` carries `upstreamRqDuration` per request** — the single most useful view for any
  latency question. It pages via `anchorDate`/`beforeLimit`/`afterLimit`, **not** `startDate`/`limit`
  (that is `deploymentLogs`).
- **`claude_ro` is read-only by role** — no DDL. REINDEX/VACUUM are owner actions. Expect intermittent
  502s from `/api/admin/db-query`; retry rather than concluding the data is unavailable.
- **`claude_ro.error_events` is row-scoped to one user and prunes at 30 days**, and cannot see an
  outage where the app cannot reach the DB. A quiet `error_events` is not a quiet production.
- **Do not run analytical queries against `claude_ro.oura_raw_samples`** (~987k rows). `pg_class` and
  `pg_stat_user_tables` answer size questions from the catalog in milliseconds.
- **`claude-ro-readonly-role.test.ts` pins a views migration** and rebuilds the schema from it.
  Re-point it in the same commit as any new views migration. **A green suite does not prove the pin is
  current** — only that no *table* has been added since; a column-only migration hides it.
- **`scripts/local-db/migrate.js` can mark a migration applied when a statement inside it errored**,
  leaving the local schema wrong and the failure attributed to your change. If a `claude_ro` coverage
  count is off by one, drop the schema and re-apply by hand before believing it.
- **A Q number in an unmerged PR is provisional.** Check the backlog pointer AND `list_pull_requests`
  AND re-read the pointer at merge time. Grepping `main` misses work sitting in an open PR's files —
  that cost a duplicate Q-213 and a collided Q-215.
- **Commit before every `git checkout`; never `git add -A` while a merge shows `UU`.** Conflict markers
  were committed once today, and a merge silently restored a completed backlog entry.
- **Clear `rate_limits` in the local dev DB** if an unrelated test starts failing with "Too many
  requests" after several suite runs.

## 8. Still with the owner

- **Four device checks** in [`docs/device-smoke-checklist.md`](device-smoke-checklist.md). **Sign-out
  wipe first** — `clearLocalStoreData()` is a no-op in the browser, so that seven-table fix has
  **never executed anywhere**. Q-189 removed one of the two sign-out buttons; one remains, and finding
  a second is itself a finding.
- **Q-211** — a deload week prescribes half weight for a baseline test that the 1RM and PR paths then
  treat as a genuine max. Changes prescribed load, so it needs an owner call.
- **Q-72** — needs a better yardstick than the feel-rating correlation.
- **Local SQLite v25 has never run on a phone.** If Saved Meals comes up blank after an update,
  **revert rather than debug forward** — that is the signature of a failed local upgrade (#27, #85).
- **`GEMINI_API_KEY` can be removed from Railway** — no code reads it after Q-189.
- **`TOKEN_ENC_KEY` is unset in production** (Q-217): every container start logs `token writes will
  fail closed` at `error` severity. Either the variable is missing or the message overstates it.

---

## Pickup prompt

```
You are picking up backlog work on TrainingAI. Start from a fresh main:
    git fetch origin main && git remote prune origin && git checkout -B <your-branch> origin/main

Read in this order:
  1. projectOverview.md — status, Known Issues, Risks
  2. docs/domains/<pillar>/README.md for whichever pillar your item is in
  3. docs/handoff-2026-08-13-cross-combined-backlog-handover.md  ← start here; it reconciles the
     two parallel sessions that ran on 2026-08-13 and corrects two places where they disagreed
  4. docs/implementation-backlog.md — work the queue top-down per the protocol at the top

FIRST CONCRETE ACTION: read the queue and take the top item that does NOT need an owner decision.
Before implementing, re-verify the entry's premise against current main — six entries worked
yesterday had premises that did not survive reading, and two were wrong in ways that would have
produced the wrong fix.

CONSTRAINTS YOU WOULD OTHERWISE REDISCOVER:
- "Custom rules pass" means the 31 run-steps of the ci.yml job named "Custom Rules", not the 20
  that invoke a scripts/*.js. Parse the YAML (yaml.safe_load, take the job whose name is
  "Custom Rules"), run every step, and print how many ran — a count you can check beats a pass you
  cannot. The 11 non-script steps are inline greps covering UTC date slicing, hardcoded session
  names, safe-area insets, local-SQLite PRAGMAs, nested buttons, JSON.parse of LLM output, and
  hand-rolled invalidateCache. Filed as Q-206, not built; building it is a legitimate first task.
- RAILWAY_API_TOKEN is a PROJECT token: header `Project-Access-Token: $RAILWAY_API_TOKEN` against
  https://backboard.railway.com/graphql/v2. `Authorization: Bearer` returns Not Authorized on every
  query, which reads like a bad token and is not. httpLogs (upstreamRqDuration per request) is the
  best latency view and pages via anchorDate/beforeLimit, unlike deploymentLogs.
- The claude_ro endpoint is read-only by role and cannot run DDL. Expect intermittent 502s from
  /api/admin/db-query; retry rather than concluding the data is unavailable. Do not run analytical
  queries against claude_ro.oura_raw_samples (~987k rows) — the catalog answers size questions in
  milliseconds.
- A Q number in an unmerged PR is provisional. Check the backlog pointer AND list_pull_requests AND
  re-read the pointer at merge time.
- Nothing is device-verified. Four checks are pending with the owner; the sign-out wipe has never
  executed anywhere, since clearLocalStoreData() is a no-op in the browser. Local SQLite v25 has
  never run on a phone — if Saved Meals comes up blank after an update, REVERT, do not debug forward.
- Verify every new test by mutation. Yesterday found one guard that was unreachable (deleting it
  failed zero tests) and one harness that reported four working guards as broken.
- Production's event-loop starvation is FIXED as far as narrowing can fix it (Q-213 Stage 1 +
  watermark, verified on a real sync: 15-30 min -> 2 min). Stage 2 — the worker thread — is the one
  piece left and now has measured justification: a concurrent ingest still returned 500 after 27.6s
  while a 2-minute rollup held the thread. Do NOT ship the workout-data fan-out change; that
  hypothesis is refuted.
- Commit before every `git checkout`, and never `git add -A` while a merge shows UU.
- Clear rate_limits in the local dev DB if an unrelated test starts failing with "Too many requests"
  after several suite runs.

ITEMS NEEDING THE OWNER, NOT YOU: Q-211, Q-72 (needs a better acceptance measure than the
feel-rating correlation — 33 of 39 ratings sit in two adjacent bins, so r cannot resolve an
improvement; do not tune against it), Q-147 and Q-168 (device time).
```
