# Handoff — 2026-08-13 · queue drain: four owner decisions built, plus ownership coverage

_Domain: `platform` (also touches `workouts`, `sleep`, `devices`, `app-shell`) · Branch: all work is
**merged to `main`**; this doc lands on `docs/handoff-queue-drain-2026-08-13` · PR: none open from
this session_

> **⭐ For picking up work, start with**
> [`docs/handoff-2026-08-13-cross-combined-backlog-handover.md`](handoff-2026-08-13-cross-combined-backlog-handover.md)
> — it reconciles this session with the other one that ran in parallel on 2026-08-13, into a
> single queue and pickup prompt. This file stays as the detailed record.

> **Read first:** `projectOverview.md` (status + Known Issues), then
> `docs/domains/platform/README.md`, then `docs/implementation-backlog.md` (the queue).
> This file covers only what *this* session did and what it leaves behind.

## Goal

Work the implementation backlog top-down. Partway through, the queue ran out of items an
implementer could take — everything left needed an owner decision — so the session switched to
putting those decisions to the owner and then building all four.

## Current status

- **Build/test:** all merged work passed the full gate — `tsc` clean, eslint clean, **all 31**
  Custom Rules steps, suite green at each merge (finished at 460 files / 3,795 tests).
- **`pnpm dev` exercised** for Q-202, Q-185, Q-203 and Q-205 with before/after measurements against
  a seeded fixture (details in each journal entry).
- **Device-verified: NO.** Nothing in this session was checked on the S25. Four Known-Issues rows in
  `projectOverview.md` record which surfaces are unverified. The device checklist has three new
  sections written for the owner (see *Open questions*).

## What shipped

| PR | Version | What |
|---|---|---|
| #1276 | — | **Q-155**: ownership guards on the 13 tables with no `user_id`. 13 cases, each mutation-verified. Closes the pre-check/join class; Q-155 stays open on its two named residuals. |
| #1267 | — | **Q-204** (docs): direction B's two gates measured. Renumbered twice — see *Gotchas*. |
| #1278 | 1.290.1 | **Q-203**: `OuraBatteryChip` removed from the Home header; component deleted. |
| #1279 | 1.290.2 | **Q-205**: More/Profile's ring battery reads the live BLE poll instead of the frozen Cloud value. Also added `oura-ble-battery-latest` to `invalidateOuraSync()` and fixed the card's tab-show refresh. |
| #1280 | — | **Q-206** filed: the local pre-push gate runs 4 of 35 custom-rules checks. |
| #1281 | — | Five owner decisions recorded; three new device-check sections. |
| #1287 | 1.300.0 | **Q-202**: prescription basis is the last *non-deload* session, not `max(lastLog, seed, allTimePr)`. New `getLastRealOneRmBatch`. Also fixed `target80` reading 0 after a deload. |
| #1291 | 1.301.0 | **Q-185**: a deload week now lightens every exercise, not only AI-prescribed ones. |
| #1293 | 1.302.0 | **Q-189**: deleted `app/chat/`, `app/sheet/[id]/chat/`, `components/chat.tsx`, `app/api/ai-chat/` incl. `/tts`. Read-aloud dropped. |
| #1305 | 1.304.0 | **Q-72 (partial)**: `hrv`/`hr` sleep baselines use a 14-night trailing median, not an all-time mean. |

## Deliberately NOT done

- **Q-72 is NOT closed.** The baseline fix un-pins the contributors but does **not** improve
  agreement with the owner's ratings (r −0.220 → −0.226). Shipped on its own merits with the owner
  seeing exactly that number.
- **Q-211 filed, not fixed** — a deload week reduces a *baseline* lift to 50% while
  `estimateOneRm`/`shouldCountTowardPr` both exempt baseline as a genuine max effort. It changes
  prescribed load on a path the owner's Q-185 decision did not cover.
- **`schedule` left pinning** (26/52 at 100). Its baseline is a circular mean of habitual bed/wake
  times, where a long-run window is more defensible than for autonomic state.
- **Nutrition items (Q-187, Q-191, Q-196) untouched** — another agent held that lane all session.
- **Q-206's fix not built**, only filed, per the plan-then-build protocol.

## Key decisions (with rationale)

- **Q-202 — no override switch.** Offered per-exercise / global / time-boxed, the owner rejected the
  framing: *"give you recommendations based on your last non deload lift."* The resolver's
  definition changed instead. **They chose the strict last session over a smoothed "best of last
  3", knowing one light day now lowers the next prescription.** A test is named for that decision so
  it is not quietly "fixed" back.
- **Q-185 — lighten every exercise**, told it was the largest-behaviour-change option.
- **Q-189 — drop read-aloud rather than move it to Coach**, since it was reachable only from an
  unreachable screen.
- **Q-72 — the curves were never the problem, the baseline was.** Not what the entry proposed;
  see *Gotchas*.

## Gotchas / what did NOT work

- **Q-72's premise was wrong in two ways, and only measuring caught it.** `latency` is not pinned at
  all (0/48 nights at 100). And the real defect was an **all-time mean baseline** against a sleeper
  whose HRV rose 24.8 → 62.7 ms — every recent night read 1.3–1.8× better than baseline and hit the
  ceiling. Re-tuning the curves as the entry proposed would have manufactured spread around a wrong
  baseline. **Do not tune Q-72 against the correlation figure**: 33 of 39 ratings are a "2" or "3",
  and the entry's headline r = −0.354 (n=32) reads −0.220 on 60 nights *before* any change.
- **Q-202 needed two halves.** Changing `resolveWorkingBasis` alone fixes nothing: `estimateOneRm`
  stores `estimated1rm: 0` for a deload, so after one the last log carries no usable number and the
  basis falls back to the PR anyway.
- **A guard written in Q-185 was unreachable**, and mutation testing is the only reason it was
  found — deleting `!isBaselinePhase` failed **zero** tests. Chasing why produced Q-211.
- **"All custom rules pass" was a false claim for most of this session.** The habit of globbing
  `scripts/check-*.js` runs **4 of 35** checks; the other 31 are inline in `.github/workflows/ci.yml`.
  #1279 shipped a direct `invalidateCache()` call past that gate. A first attempt at a local runner
  regex-scraped the workflow and got **6 of 31** while printing "ALL PASS" — a more confident wrong
  answer than running nothing. **Parse the YAML.** Filed as Q-206.
- **Q-number collisions twice on one entry** (194 → 197 → 204). Neither was catchable by checking
  open PRs: one number was claimed and merged inside a single session, the other by a PR that merged
  between the check and the push. **A Q number in an unmerged PR is provisional — re-read the
  pointer at merge time.**
- **I committed conflict markers once** (`docs/implementation-backlog.md`, fixed in the next commit)
  by running `git add -A` while a merge was still unresolved. Check `git status` for `UU` before
  staging.
- **A merge restored a completed backlog entry** — Q-185's entry came back because `main` had never
  seen its removal. Re-check that removals survived the merge.
- **Stale `.next/` produced four phantom `tsc` errors** for deleted route modules. `rm -rf .next`.
- **The login rate limit is 20/15 min and in-memory** — scripted sign-ins trip it and it surfaces as
  `CredentialsSignin`. Restart the dev server, don't hunt a broken password.
- **My production diagnosis was in the right area but the wrong mechanism.** I attributed a live
  morning-check-in failure to DB connection-pool contention. The correct diagnosis — confirmed
  against telemetry by another agent — is **event-loop starvation from the BLE rollup**, with pool
  exhaustion as a symptom. See
  [`docs/handoff-2026-08-13-platform-production-event-loop-starvation.md`](handoff-2026-08-13-platform-production-event-loop-starvation.md).
  The owner attributed the check-in regression itself to another agent and took it away.

## Files to look at

- `packages/shared/src/1rm.ts` — `resolveWorkingBasis`, now last-real-session-wins (Q-202).
- `lib/data/postgres/adapter.ts` — `getLastRealOneRmBatch`; `estimated_1rm > 0` **is** the deload
  test, not a proxy.
- `packages/shared/src/workout/session-data.ts` — the Q-185 branch after the AI block, and why
  static programs are excluded.
- `packages/shared/src/health/sleep-score.ts` — `SLEEP_AUTONOMIC_BASELINE_WINDOW_NIGHTS` and
  `sleepScoreBaselines`.
- `lib/data/postgres/__tests__/repository-ownership-scoping.test.ts` — the Q-155 pattern; **check
  every new case by mutation**, two earlier ones could not fail.
- `docs/device-smoke-checklist.md` — three new sections written for the owner.

## Open questions / blockers

- **Four device checks are waiting on the owner**, written up in the checklist. The sign-out wipe is
  the one that matters: `clearLocalStoreData()` is a no-op in the browser, so that seven-table fix
  has **never executed anywhere**. Note Q-189 removed one of the two sign-out buttons — one control
  remains, and finding a second is itself a finding.
- **Q-211** needs an owner call (it changes prescribed load).
- **Q-72** needs a better yardstick than the feel-rating correlation before anyone attempts it again.
- **`GEMINI_API_KEY` can be removed from Railway** — no code reads it after Q-189.

## Pickup prompt

```
You are picking up backlog work on TrainingAI. Start from a fresh `main`:

    git fetch origin main && git remote prune origin && git checkout -B <your-branch> origin/main

Read in this order:
  1. projectOverview.md — status, Known Issues, Risks
  2. docs/domains/<pillar>/README.md for whichever pillar your item is in
  3. docs/handoff-2026-08-13-platform-queue-drain-owner-decisions.md (this session)
  4. docs/implementation-backlog.md — work the queue top-down per the protocol at the top

First concrete action: read the queue and take the top item that does NOT need an owner
decision. Before implementing, re-verify the entry's premise against current `main` — six of
the entries worked in the previous session had premises that did not survive reading, and two
were wrong in ways that would have produced the wrong fix.

Constraints you would otherwise rediscover:

- "Custom rules pass" means 35 checks, not 4. Globbing `scripts/check-*.js` runs FOUR; the
  other 31 are inline bash in `.github/workflows/ci.yml`. Parse that YAML (`yaml.safe_load`,
  take the job whose `name` is "Custom Rules") and run every step, printing how many ran — a
  regex scrape silently gets 6 of 31 and reports all-pass. This is filed as Q-206 and not yet
  built; building it is a legitimate first task.
- A Q number in an unmerged PR is provisional. Check the backlog pointer AND
  `list_pull_requests` AND re-read the pointer again at merge time — numbers get claimed and
  merged inside a single session without ever appearing in an open PR.
- Nothing is device-verified. Four checks are pending with the owner (sign-out wipe, AI Coach
  screens, ring battery/Home header, cold app start). The sign-out wipe has never executed
  anywhere, since `clearLocalStoreData()` is a no-op in the browser.
- Verify every new test by mutation — break the thing it guards and confirm exactly the right
  test fails. This session found one guard that was unreachable (deleting it failed zero
  tests) and one harness that reported four working guards as broken.
- Production has an ongoing event-loop starvation issue from the BLE rollup (Stage 1 shipped,
  not yet proven under real load). Expect intermittent 502s from
  `/api/admin/db-query`; retry rather than concluding the data is unavailable. See
  docs/handoff-2026-08-13-platform-production-event-loop-starvation.md.
- Commit before every `git checkout`, and never `git add -A` while a merge shows `UU`.
- Clear `rate_limits` in the local dev DB if an unrelated test starts failing with
  "Too many requests" after several suite runs.

Items needing the OWNER, not you: Q-211 (deload reduces a baseline lift while the 1RM/PR paths
treat it as a real max), Q-72 (needs a better acceptance measure than the feel-rating
correlation — 33 of 39 ratings sit in two adjacent bins), Q-147 and Q-168 (device time).
```
