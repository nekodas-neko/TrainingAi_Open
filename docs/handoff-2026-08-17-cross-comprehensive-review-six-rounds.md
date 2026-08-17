# Handoff — 2026-08-17 · comprehensive app review, six rounds (Q-271 … Q-308)

_Domain: `cross` (touches `readiness`, `sleep`, `activity`, `workouts`, `nutrition`, `cardio`, `platform`) · Branch: `wrapup` (from `main`) · PRs: **#1377, #1378, #1380, #1381, #1388, #1394, #1401 — all merged**_

> **Read first:** `projectOverview.md` (status + Known Issues), then
> `docs/domains/<pillar>/README.md` for whichever pillar you are working in, then
> `docs/implementation-backlog.md`. This file covers only what this session did and left behind.

## Goal

An owner-requested full review: bugs, UI, performance, architecture, a comparison against
Garmin/Samsung Health/Strava, and production data pulled through the admin endpoint to judge whether
the scoring pillars actually work. It expanded across six rounds as each one exposed what the
previous had not covered.

## Current status

- **Build/test:** `pnpm check:rules` **36 of 36** at every commit. All seven PRs merged with six
  green checks each (Lint · Tests · Build · Migration Check · Custom Rules · E2E).
- **Device-verified:** **no.** Nothing in six rounds was rendered — no device, emulator, browser, or
  `pnpm dev` run. Every finding is from source reading, production queries, or the local load-test
  harness. **This is docs-only work; nothing shipped that needs device verification.**
- **⚠️ Repo migrated mid-session.** The owner moved to **`nekodas-neko/TrainingAi_Open`** (public).
  See *Open questions* — one PR's content did not make the migration.

## What shipped

Seven merged PRs. **38 backlog entries, Q-271 … Q-308**, plus one CI check and one measurement harness.

| PR | What |
|---|---|
| **#1377** | Five scoring pillars measured together against production for the first time (Q-271…Q-284) |
| **#1378** | Six lenses twelve prior reviews never used (Q-285…Q-296) |
| **#1380** | Every remaining pillar reviewed for model soundness (Q-298…Q-303); heart-rate and body came back **clean** |
| **#1381** | Q-298 corrected, 1RM/volume gaps measured, **conflict markers I put on `main` fixed** (Q-304, Q-305) |
| **#1388** | The multi-user load test, built and run (Q-306…Q-308) |
| **#1394** | Four deferred measurements taken; a confounded synthesis retracted (Q-292/298/300/304 amended) |
| **#1401** | **Q-308 resolved — serialise the sync fan-out**, settled by owner-measured Railway RTT |

**Code, not docs:** `scripts/check-conflict-markers.js` (Custom Rules step 1 of 36) and
`scripts/load-test/{seed-users,sync-fanout}.js`.

### The findings that matter most

- **Q-275** — readiness is structurally blind to training load. `readiness-payload.ts:329` reads
  `preTaperScore` *specifically* to avoid double-counting ACWR, and load enters the composite
  nowhere else. Both activity terms (15%) are goal-completion scores. Garmin takes two load inputs
  of six. Largest modelling gap in the app.
- **Q-308 — RESOLVED, ready to implement.** Serialise `getSyncDelta`'s `Promise.all`
  (`lib/data/postgres/adapter.ts:3362`) onto one connection. At the owner's measured RTT
  (p50 0.86 ms), serial beats parallel at **p50 and p95 at every concurrency** with **21× fewer
  connections**. Spec and verification command in the entry.
- **Q-298 — one line.** `log-exercise.ts:196` zeroes the 1RM when *either* the AI flag **or the
  phase** says deload; **`:264` stores only the AI flag**. That is why Q-228's filter misses them.
- **Q-274** — 10 of 46 post-re-key `sleep_sessions` are under 1.5 h; on two dates the fragment is
  the *only* record. Feeds `previousNight` (16%) and `sleepBalance` (10%).
- **Q-285/286** — web push has neither senders nor subscribers, stranding a supplement-reminder
  `<Switch>` that persists and syncs and can never fire.
- **Q-287** — no self-service account deletion (Play Store gate). Plan drafted at
  `docs/superpowers/plans/2026-08-16-account-deletion.md`, **seven owner decisions, nothing built.**

## Deliberately NOT done

- **No implementation of any finding.** Per *Backlog-driven implementation*, all six rounds were
  plan-now-build-later. Nothing in Q-271…Q-308 has been fixed.
- **Cost was measured and deliberately not optimised** — ~26k tokens/day, cents per month. Recorded
  as a negative result so nobody re-investigates it.
- **The serial fan-out change was NOT applied** despite being resolved — Q-308 carries the spec; the
  edit itself is one PR of implementation work.
- **Q-107/Q-213 were NOT struck** even though the pool measured as not the binding constraint. The
  production faults were real and a local measurement does not refute a production diagnosis.

## Key decisions (with rationale)

- **Two pillars reported clean rather than padded.** Heart rate (observed max 168 corroborates
  Q-57's figure) and body (the composition-column gap is a column-introduction date, not a producer
  gap) produced **no entries**. Manufacturing findings to fill a pillar would have been the wrong
  result.
- **Five findings died on verification and are recorded as such** — a "dead" sleep-score column that
  is documented as deliberately frozen; `blendActivityScore` firing on 1 day in 40 rather than never;
  `core` appearing absent from `MUSCLE_LANDMARKS` when `normalizeMuscle` maps it; five "stuck"
  `sessions_in_phase` rows belonging to an **inactive** program; a regex hit for train-through-illness
  that reads as describing the illness radar. Recording the near-misses is what keeps the rest
  trustworthy.
- **A synthesis was retracted before merge.** "Prescribed sets score r=0.50 vs unprescribed r=0.30"
  was a comparison of **data eras** — `planned_pct` only exists from 2026-07-18. Withdrawn in the
  review, the PR body and `projectOverview.md`. It **narrowed Q-289** (low-end error was a
  pre-cutover artefact; re-scoped to the top of the range) and **weakened Q-306's headline**.

## Gotchas / what did NOT work

- **I merged 21 conflict markers onto `main`** in #1380 via `git add -A` after a partial merge
  resolution. They passed **all six checks** — nothing looks at markdown for this.
  `scripts/check-conflict-markers.js` now exists and fails on them. The `CLAUDE.md` rule about
  `git add -A` after a checkout applies to *merge resolution* too, and more sharply.
- **A genuine Q-number collision.** #1376 took **Q-297** on merge after `list_pull_requests` showed
  it claiming only Q-248/Q-249. My block renumbered 297–302 → **298–303**. The pointer cannot see an
  unmerged PR; the merge conflict caught it, the check did not.
- **The first chunked load-test variant was mislabelled** — it ran queries *serially within* each
  batch, so it measured as serial with extra churn. Fixed before publishing; those numbers never
  shipped.
- **`bash curl` to `api.github.com` is unauthenticated here** (as `CLAUDE.md` warns). A poll loop
  reported "all complete" when checks were still running. Use the GitHub MCP tools.

## Files to look at

- `docs/reviews/2026-08-1{5,6}-*.md` — the six review documents, each with its queries.
- `docs/implementation-backlog.md` — Q-271…Q-308. **Next free Q number: 309** (old repo has Q-310).
- `scripts/load-test/` — seeder + fan-out harness, both refusing non-local databases.
- `docs/superpowers/plans/2026-08-16-account-deletion.md` — the seven owner decisions.
- `lib/data/postgres/adapter.ts:3362` — the `Promise.all` Q-308 says to serialise.
- `packages/shared/src/workout/log-exercise.ts:196,264` — the Q-298 one-line fix.

## Open questions / blockers

- **⛔ The repo migration left PR #1401 behind.** `nekodas-neko/TrainingAi_Open` carries everything
  from rounds 1–5 but **not #1401** (merged to the private repo minutes after the migration cut).
  Missing there: `docs/reviews/2026-08-16-sync-fanout-rtt-verdict.md` (new file), the Q-308
  resolution in `docs/implementation-backlog.md`, its `projectOverview.md` row, and the chunked-mode
  fix in `scripts/load-test/sync-fanout.js`. **This session could not push to the public repo** —
  the push attachment was refused. Port it by cherry-picking `6136768` from the private repo.
- **🔸 Q-276 — owner decision.** Readiness and Body Battery share no variance (r = +0.12). Different
  questions, or should they agree? Product call.
- **🔸 Q-284 — owner decision.** The Oura activity blend fires on 1 day in 40. Retire or document?
- **🔸 Q-287 — seven owner decisions** in the linked plan before any code.
- **Not answered:** the systematic AI-output quality audit is complete for *patterns* (all 117) but
  not an independent judgement of each insight's coaching quality; the degradation matrix (Q-294) is
  desk-only and wants the E2E harness.

## Pickup prompt

```
You are picking up a comprehensive review that ran across six rounds and filed 38 backlog entries
(Q-271 … Q-308). All of it is merged. Nothing has been implemented.

FIRST, resolve a repo split:
- The owner has moved to nekodas-neko/TrainingAi_Open (public).
- That repo has rounds 1–5, but is MISSING the content of PR #1401 from the private repo
  nekodas-neko/TrainingAI (commit 6136768, "Resolve Q-308: serialise the sync fan-out").
- Missing files: docs/reviews/2026-08-16-sync-fanout-rtt-verdict.md (new), plus the Q-308 resolution
  in docs/implementation-backlog.md, its projectOverview.md row, and the chunked-mode fix in
  scripts/load-test/sync-fanout.js.
- Cherry-pick that commit into the public repo before doing anything else, and confirm
  `grep -c 'RTT MEASURED 2026-08-16 BY THE OWNER' docs/implementation-backlog.md` returns 1.

READ, in order:
1. projectOverview.md — Known Issues (the six newest rows are this review's)
2. docs/handoff-2026-08-17-cross-comprehensive-review-six-rounds.md (this file)
3. docs/implementation-backlog.md — Q-271 … Q-308
4. The review doc for whatever you pick up, listed in that entry

THEN implement, in this order — each is fully specified and needs no re-derivation:
1. Q-298 — one line. log-exercise.ts:264 should store the same predicate line 196 uses
   (`exerciseDeloaded === true || (isAnyDeload && !isBaseline)`), so a phase-level deload is
   recorded and Q-228's filter stops missing it. Store null rather than 0 for an unestimated 1RM.
2. Q-308 — replace the Promise.all at lib/data/postgres/adapter.ts:3362 with a sequential loop on
   one checked-out client. Keep the pagination contract (packages/shared/src/sync/cursor.ts)
   untouched. Verify with: RTT_MS=1 CHUNKS=1 node scripts/load-test/sync-fanout.js 50 10
3. Q-274 — fragment sleep nights (10 of 46 rows under 1.5 h; on two dates the fragment is the only
   record). Decide the invariant once, at the write or at nightSessions — NOT at the read sites.
4. Q-292 — the AI states false numbers ("a perfect activity score" when it was 80) and gives
   Fahrenheit to a metric user. 7 unit errors and 12 superlatives across 117 insights.
5. Q-288 — /api/export covers 27 of 80 tables. This BLOCKS Q-287.

CONSTRAINTS you would otherwise rediscover:
- Every finding is docs-only and one user's production data via row-scoped claude_ro views.
  error_events prunes at 30 days.
- Nothing in six rounds was device-verified — no device, emulator, browser or pnpm dev run.
- Q-289 was NARROWED after filing: its "+1.93 at expected-5" is a pooled figure across a data-era
  boundary (planned_pct only exists from 2026-07-18). On current data it is +1.09, inside the dead
  band. The real defect is at the TOP of the range (−2.29 at expected-10) plus a non-monotonic top
  end. Q-306's headline was weakened by the same correction.
- Q-276, Q-284 and Q-287 need OWNER DECISIONS before implementation — do not start them.
- Claim Q numbers against both the backlog file AND list_pull_requests; the pointer cannot see an
  unmerged PR, and that trap fired this session (#1376 took Q-297 after my check showed it clear).
- Never `git add -A` after a partial merge resolution. This session put 21 conflict markers onto
  main that way and they passed all six CI checks. scripts/check-conflict-markers.js now catches it.
```
