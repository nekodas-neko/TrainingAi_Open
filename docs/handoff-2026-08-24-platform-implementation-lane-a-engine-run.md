# Handoff — 2026-08-24 · Implementation Lane A, fifteen-PR engine run

_Domain: `platform` (also touches `devices`, `workouts`, `body`) · Branch: `chore/lane-a-wrap-2026-08-24` · PR: docs-only wrap-up_

> **Read first:** `projectOverview.md` (status + Known Issues), then
> `docs/domains/platform/README.md` (that pillar's code, docs and open issues), then
> `docs/implementation-backlog.md` (the queue). This file covers only what *this* session did
> and what it leaves behind. The **state** it leaves is in
> [`docs/agents/state/implementation-lane-a.md`](agents/state/implementation-lane-a.md) — read that
> before the queue.

## Goal

Work the Lane A queue top-down as the standing Implementation (A) agent: engine paths only
(`lib/data/**`, `app/api/**`, `packages/shared/**`, migrations, device pipelines), merging each PR
on green without pausing for confirmation on standard changes.

## Current status

- **Build/test:** `pnpm dev` exercised per PR against the local seeded Postgres; full `pnpm test`
  green on each branch; `pnpm check:rules` **Ran 51 of 51** (do not hardcode — it reads the count
  from `ci.yml`).
- **Device-verified:** **no.** Nothing ran on the S25 this session. Every offline-first / native /
  safe-area path shipped here is unverified on device; the ones that matter carry Known-Issues rows.
- **In flight:** nothing. Every branch this session opened is merged.
- **Migrations:** through **209**; next free is **210**. Local SQLite **v28**, untouched.

## What shipped

Twelve PRs of code plus three of docs/process. All merged to `main`.

| PR | Entry | What it actually changed |
|---|---|---|
| #360 | **Q-541 Task 6** | The raw-frame packer fires itself from the ingest path — `claimAutoPackSlot()` in `lib/data/postgres/slices/oura-raw-pack.ts`, throttled **per user** at 6 h, `OURA_AUTOPACK=off` kills it without a deploy. Phase-3 delete moved from the bucket's **ds range** to **row ids**, because automating it made the race reachable: a frame arriving between the select and the delete was previously removed having never been packed. `AUTOPACK_MAX_BUCKETS = 25`, sized from the measured **0.32 s/bucket** — my first number (8) was justified in its own comment as "2.8× the production rate" and was actually 1.4×. |
| #351 | **Q-456** | `claude_ro` views scope on `current_setting('app.claude_ro_owner', true)` rather than a baked user id. Verified live in production: setting configured, migration 207 applied, **85 views**, rows returned. **No `ALTER ROLE` is needed** — `bootstrapClaudeRoOwner()` sets it at boot. |
| #362 / #378 | **Q-464** batches 2+3 | Strict Zod schemas on the admin and ai-periodization routes, each verified against its actual client rather than assumed. |
| #363 | **Q-312** | `scripts/generate-test-constants.js` emits MET values **above** `estWorkoutKcal`'s 1.5 floor (`met_easy: 2, met_moderate: 4, met_hard: 6`), so a fixture MET estimate is no longer silently `0` in CI and the sandbox. This retires the baton's standing "every MET strength estimate is 0 under fixtures" trap. |
| #365 | **BF-4** | AI scan payload instrumentation: `ai_call_log.payload_bytes` (migration **208**, views regenerated in **209**), plumbed through `insertAiCallLog`. |
| #368 | **Q-420** | `packages/shared/src/workout/derive-session-rpe.ts` — `deriveSessionRpe()` + `sessionEffort()`, one place, `{ rpe, source: 'self' | 'derived' }` so a derived value is never mistaken for a self-report. |
| #371 / #372 / #374 | **LA-21** | Measured, then culled. Production held **11 of 81 sessions (13.6%) at 534–845 min** with an empty gap between 92 and 534 min. `isPlausibleSessionDuration()` / `MAX_PLAUSIBLE_SESSION_MIN = 4 h` in `packages/shared/src/health/workout-energy.ts`, consolidated from **three** pre-existing copies and applied on **both** the MET and HR branches. #374 replaced the bare midnight session-start fallback in `log-exercise.ts` with a ladder: `workoutStartedAt` → first set start → now-if-today → midnight. |
| #385 | **Q-298** | The live leak: `listPrevious1rm` gated on `estimated_1rm IS NOT NULL`, so a deload's stored **zero** became the previous 1RM. Now `> 0`, matching the two sibling queries that already did. Plus a named `deloadedForEstimate` predicate used at both the estimate call and the stored column, so provenance and behaviour cannot drift. |
| #345 | **Q-313** | Constants were still a build-time dependency after the A4b public-repo cut. |
| #364 | process | `check-backlog-pointers.js` fails on a **queue heading with nothing under it** — the exact shape all three backlog resurrections took. Deliberately narrower than the class: a resurrection restoring a *full* entry still passes, and the general version wants git history CI cannot reach at depth 1. |
| #381 | journal compaction | 57 entries folded into `docs/overview/history-2026-08-24.md`. |
| #356 | **LB-7** filing | Filed for Lane B; **my diagnosis was wrong** — see Gotchas. |

## Deliberately NOT done

- **Nothing was device-verified.** The LA-21 duration cull, the autopack, and the session-start
  ladder all touch paths whose real behaviour is on the S25. Known-Issues rows carry this.
- **Q-315 (`VACUUM FULL error_events`, ~49 MB)** is still owed. The owner ran the *`oura_raw_samples`*
  vacuum this session and it reclaimed **36 MB** (93 MB → 57 MB; heap 44→28, idx 49→29). `error_events`
  is a **separate table with no button** — it needs `POST /api/admin/vacuum {"table":"error_events"}`
  with an admin session cookie.
- **Q-422** is Tuning-originated and is not Lane A's to start.
- The baton's **"Findings, so they are not re-derived"** block is carried forward again rather than
  relocated. It should move to `docs/oura-ble-operations.md`; I did not, and it is now on its
  fourth baton.

## Key decisions (with rationale)

- **LA-21 culls rather than excludes.** I proposed "exclude from the load series, clamp for calories";
  the owner said cull. Measurement then vindicated the owner — all 11 outliers are **real workouts**
  (5–6 exercises, 13–18 sets) left running, so excluding the session would have deleted training
  history to fix an energy number. Cull the **duration**, keep the session.
- **The autopack throttle is per user, not global.** One shared timestamp lets a busy user starve
  another user's table entirely.
- **`claimAutoPackSlot` distinguishes "unseen" from "long ago" explicitly.** `lastAutoPack.get(id) ?? 0`
  compares against the epoch and is only indistinguishable from a claim because `Date.now()` is large.
  It checks `!== undefined`.
- **The resurrection check is narrow on purpose.** 25 IDs legitimately sit in both a queue heading and
  a journal title today (an entry that shipped half its work stays queued with a `Keep:` line), so the
  obvious general check was measured and rejected.

## Gotchas / what did NOT work

- **My LB-7 diagnosis was wrong, and the shape of the error is worth keeping.** I reasoned from
  `playwright.config.ts` (`workers: 1, fullyParallel: false`) to accumulated suite state. The real
  cause, found by Lane B in #359: `public/sw-template.js` re-issues **every** `/api/` request with no
  method filter, so once the service worker controls the page, `page.route` stubs are bypassed —
  Playwright cannot intercept SW fetches. Fixed with `test.use({ serviceWorkers: 'block' })`.
  #363 needed a rebase, not a diagnosis.
- **I filed LA-21's severity from a dev fixture** ("not a live corruption") when production showed
  13.6%. A severity claim needs the production distribution, not the seeded one.
- **My own PR shipped a sizing defect whose comment asserted the wrong ratio.** A number justified in
  prose inside the diff is not a measured number.
- **Q-298's stated premise was false on `main`** — both `getLastRealOneRmBatch` and the trend query
  already filtered `> 0`. Re-verifying it is what found the query that didn't.
- **A header edit sliced ~1,400 lines off migration 209.** `s.index('DO $')` matched the grant block.
  Regenerate and prepend; never slice a generated file.
- **A commit was dropped on #374** by switching branches after committing and never pushing. Found by
  reading the PR's commit count, not by `git status`.
- **Journal compaction has five traps, three of them new** and now recorded in
  `docs/overview/entries/README.md`. The worst: **a concurrent PR can link an entry you already
  folded.** Three became cited by the Orchestrator's handoff mid-sweep, and git surfaced only the one
  it also modified — two would have gone unnoticed (60 → 57 folded).
- **`git fetch --deepen=N origin main` before any `git merge origin/main`.** The clone is depth 1 and
  the merge fails with "refusing to merge unrelated histories" until deepened. This cost several
  rounds.
- **`get_check_runs` returning `total_count: 0` right after a push is registration lag, not a stale
  base** — distinguish them by checking whether `origin/main` is an ancestor of your head. It also
  reports `in_progress` 16–30+ min after a job passed. Attempting the merge is the authoritative check.
- **A stale remote branch from a previous sweep** (`origin/chore/compact-journal-entries`) is not
  yours to force-push. Date the new one.

## Files to look at

- `lib/data/postgres/slices/oura-raw-pack.ts` — the autopack: throttle, bucket cap, row-id delete.
- `lib/data/postgres/adapter.ts` — `insertOuraRawSamples` fires the autopack; `autoPackRawSamples`
  logs refusals to `error_events` under `url: 'oura-autopack'`; `listPrevious1rm` is the Q-298 fix.
- `packages/shared/src/health/workout-energy.ts` — `isPlausibleSessionDuration`, the one copy.
- `packages/shared/src/workout/derive-session-rpe.ts` — Q-420, new.
- `packages/shared/src/workout/log-exercise.ts` — the session-start ladder and the
  `deloadedForEstimate` predicate.
- `scripts/generate-test-constants.js` — MET floor; the reason fixture-MET tests are no longer vacuous.
- `docs/overview/entries/README.md` — the five compaction traps, before you run a sweep.

## Open questions / blockers

- **Q-315** needs one owner press (or an admin cookie): `POST /api/admin/vacuum {"table":"error_events"}`,
  ~49 MB. The `oura_raw_samples` half is **done** — 36 MB reclaimed 2026-08-24.
- **Q-388 SpO₂** is not a code question. All 14 production days carry SpO₂ frames (673–10,588/day);
  no baseline exists because `enableMeasurementSequence()` sets it AUTOMATIC on **every** connect. The
  missing datum is one night *without* it, which needs a Kotlin change and a new APK.
- **Device checks owed and accumulating:** Q-400 (also decides Q-411), Q-413, Q-412, Q-405, Q-310,
  plus everything this session shipped.
- **Q-422** waits on the owner (Tuning proposes → owner signs off → Lane A implements).

## Production state as left

- `error_events`: **zero new faults** from ~15 deploys. Two pre-existing, both already tracked —
  `/api/body-battery` constants (12 hits, quiet since the LA-20 fix) and an Android
  `SpeechRecognition` gap (`projectOverview.md`). Remember this endpoint is **row-scoped to the
  owner**: "none of the owner's", never "nothing is failing".
- Autopack observed working: 4 runs, **318,883 → 205,278 rows**, 764 → 864 buckets, 0 faults. Each
  deploy resets the per-process throttle, so the session's own merges accelerated it.
- `oura_raw_samples` after the owner's vacuum: **57 MB** (from 93 MB).

## Pickup prompt

```
You are the standing **Implementation Lane A** agent for nekodas-neko/TrainingAi_Open.

Rename this session first, exactly: 🚧 Implementation Agent (A) 🟢
(get_session with session_id omitted returns your own id, then set_session_title.)

Read, in this order:
1. docs/agents/README.md — the six-agent contract: lane ownership, entry IDs, batching, merge authority.
2. docs/agents/state/implementation-lane-a.md — your baton. This is state your predecessor left you; trust it over any older doc.
3. projectOverview.md — status, Known Issues, What's Left To Do.
4. docs/handoff-2026-08-24-platform-implementation-lane-a-engine-run.md — the previous session's fifteen PRs, its wrong diagnoses, and its gotchas.
5. docs/domains/platform/README.md — the pillar you will be in most.

Then do the session-start reads CLAUDE.md requires: production error_events (30-day prune, row-scoped to the owner — write findings as "none of the owner's") and the database size query.

First concrete action: `node scripts/next-item.js --lane A`. Do NOT hand-scan the backlog — the tool is the only thing that can tell you whether the top entry is startable, and re-verify each entry's premise against current `main` before building it. That habit changed the work on four of six entries in one session and on Q-298 in the next.

Constraints you would otherwise rediscover:
- Nothing has been verified on the S25 for two sessions. Anything touching offline-first, native, safe-area, gestures or notifications needs the device smoke run (docs/device-smoke-checklist.md) or an explicit projectOverview.md Known-Issues row.
- Migrations: next free is 210. Local SQLite is v28. Both belong to Lane A alone.
- The local gate is `pnpm check:rules` — quote its "Ran N of N", never the word "pass". Do not hardcode N.
- The clone is depth 1: run `git fetch --deepen=200 origin main` before any `git merge origin/main`, or it refuses as unrelated histories.
- Re-merge origin/main immediately before opening each PR AND again before merging. A green check goes stale while you work, and five agents are merging.
- get_check_runs lies in both directions. `total_count: 0` right after a push is registration lag — check whether origin/main is an ancestor of your head to tell it from a stale base. Attempting the merge is the authoritative green check.
- On docs/implementation-backlog.md a conflict is almost always TWO DELETIONS — keep neither side. On append-only files it is two additions — keep both. Read the headings before choosing.
- Merge a tested, CI-green PR without asking. Confirmation is still required for data-dropping migrations, auth/session/security changes, and secret handling.

Owed to the owner, unstarted: Q-315 needs one press — POST /api/admin/vacuum {"table":"error_events"} with an admin session cookie, ~49 MB. The oura_raw_samples half is done (36 MB reclaimed 2026-08-24). Do not add a bearer path to that route without an explicit yes; it is an auth change.
```
