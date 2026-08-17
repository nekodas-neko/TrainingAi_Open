# Handoff — the E2E harness, and a backlog run through the owner's UI-bug batch

**Written:** 2026-08-16 · **Domain:** `platform` (secondary: `nutrition`, `workouts`, `app-shell`)

An implementer session working the backlog queue top-down. Ten items shipped across five PRs; the
largest is Q-249, which gave the repo its first tests that actually run the application.

---

## What shipped

| PR | Items | Version |
|---|---|---|
| #1375 | Q-245 nutrition day guard · Q-246 deload bar · Q-247 day-screen energy summary | v1.317.0 |
| #1376 | Q-248 readiness card flip · **Q-249 E2E harness** | v1.317.1 |
| #1379 | Q-254 device-verification re-tagging | — |
| #1387 | Q-297 Health per-tab E2E coverage | — |
| #1390 | Q-297 water write-path spec · Q-309 filed | **STILL OPEN — see below** |

Journal entries: `docs/overview/entries/2026-08-15-nutrition-day-guard-and-deload-bar.md`,
`2026-08-15-readiness-card-optimistic-flip.md`, `2026-08-15-e2e-harness.md`,
`2026-08-15-device-verification-retag.md`, `2026-08-15-health-per-tab-e2e.md`.

---

## ⚠️ Start here: PR #1390 is open and its E2E job is red for a reason nobody has seen

**Do not merge it blind, and do not "fix" a spec before reading this.**

State when this was written:

- All **five required checks are green** (Lint, Tests, Build, Custom Rules, Migration Check).
- The E2E job is **red** on run `31973027001`. Failed jobs were re-queued; check that result first.
- **The full 12-spec suite passes against a CI-identical database.** This was measured, not assumed:
  a fresh `trainingai_e2e_fresh` database was created, migrated with `scripts/local-db/migrate.js`,
  seeded with `scripts/local-db/seed.sql`, and the whole suite run against it — **12/12 in 4.3 min**,
  with the new water spec the fastest test at 7.3 s.

So the specs are sound under CI's own conditions and the CI failure is environmental. What it is
has not been established, because of a tooling limitation worth knowing:

> **`get_job_logs` returns only the Postgres *service container* stream for this job**, on both the
> `job_id` form and `run_id` + `failed_only`. The Playwright step output is not in it — the spec
> names do not appear anywhere in the 24 KB it returns. Two sessions' worth of diagnosis went into
> that wall.

**The path not yet tried:** the workflow uploads a `playwright-report` artifact on failure
(`.github/workflows/ci.yml`, E2E job). Download it via `list_workflow_run_artifacts` and read the
HTML/JSON report. That is the shortest route to which spec actually failed in CI.

**The one live lead** is `FATAL: role "root" does not exist`, repeating every ~10 s for the whole
run in the Postgres container log. Something connects without the `DATABASE_URL` credentials and
falls back to the runner's OS user. It appears in failing runs; whether it appears in the three
earlier *passing* E2E runs (#1376, #1379, #1387) has not been checked, so it may be harmless noise.
Check that before chasing it.

**If it turns out to be a timeout:** the suite is now 12 specs and CI runs `pnpm dev` cold, so every
route pays a first-call compile. The job ran 9.4 minutes before failing.

---

## The three things blocked on the owner

**1. Q-309 — ten seconds on the S25, and it decides whether a real bug exists.**
Open Nutrition, tap **Water**. Does the sheet open?

Measured in the harness, cleanly, same element and same run: a **real touch sequence**
(Playwright `.click()` under `devices['Galaxy S9+']`, which has `hasTouch`) **never** opens the
sheet — 20 s of waiting, and the failure screenshot shows the button sitting there untouched. A
synthesised `dispatchEvent('click')`, which skips the pointer sequence, opens it **immediately**.

Suspect: the date-swipe binding at `app/nutrition/nutrition-content.tsx:513`
(`useDrag(..., { axis: 'x', filterTaps: true, pointer: { touch: true } })`) spread onto the
container holding the action row. `components/pull-to-sync.tsx` is also on that screen and is not
ruled out. This repo has had gesture handlers swallow input twice before (sessions 150, 152).

**Deliberately not fixed.** A synthetic tap has zero movement and near-zero duration, so the harness
may be the anomaly. If it reproduces under a thumb it is a live bug on the owner's most-used write
path, and `app/health/day/day-detail-content.tsx` copies the same pattern.

**2. Q-231 — a direction call.** The "Exercise detected" card has been permanently empty since
~2026-08-04; its only writer was the Oura Cloud sync, now gone. Either retire the card and its
route, or feed it from the BLE classifier (new work, overlapping Q-222). Note `app/api/day-timeline`
filters the same dead table, so the day timeline has silently lost Oura-detected walks for the same
period. **Do not guess this one** — the entry says so and it is right.

**3. Which slice to prioritise.** Strict queue order is not converging: 10 items removed this
session against ~35 added by the parallel lane (Q-271…Q-308). The queue went 94 → ~129 headings.
Candidate slices: owner-reported bugs · the scoring cluster (Q-271…Q-296) · platform capability
(Q-250 Android emulator CI).

---

## What the E2E harness proves, and what it does not

`e2e/README.md` is the maintained answer and should be read before adding a spec. The three things
that cost the most to learn:

- **It runs `pnpm dev`, not `pnpm start`.** The pg pool enables SSL whenever
  `NODE_ENV === 'production'` (`lib/data/postgres/client.ts:30`), which `next start` sets, so a
  production server cannot reach the local non-SSL Postgres at all. Every request dies with *"The
  server does not support SSL connections"*, which surfaces as a bare `?error=Configuration` on the
  sign-in page and looks exactly like an auth misconfiguration. That cost an hour.
- **Skeleton checks count only what is in the viewport.** Health mounts all three tabs at once in a
  `SwipeCarousel`, so inactive panels are mounted and "visible" to Playwright while the user cannot
  see them. `health-tabs-instant-paint.spec.ts` drives `?tab=` to cover each panel; **every other
  tabbed screen still has this gap**.
- **It proves the web path only.** `getLocalStore` returns null outside the APK, so every
  offline-first domain takes its web fallback. The device branch — the canonical runtime — never
  executes.

---

## Two fixes written and then reverted, both worth not repeating

**The Injuries card.** The harness's first run failed Health: the card stuck loading, with no
`/api/injuries` request across two page loads. Traced to `injuries` being fetched only by
`fetchBodyHealthData`, which runs only when the Body tab is active, while the default tab is
`training`. A fix was written — and reverted on discovering the card is off-screen in an inactive
carousel panel and loads on swipe, by design. It was never stuck on anyone's screen. The milder real
behaviour (a brief skeleton on first arrival at Body/Progress, because nothing has written the cache
the mount seed reads) is recorded in Q-297.

**The row classifier.** Q-254's first pass lowercased headings but left uppercase literals in the
patterns (`SQLite`, `GPS`, `BLE`, `APK`, `PiP`, `WebView`), so those never matched and Android rows
were labelled `browser`. Its second pass had no `data` bucket, so "±5bpm band unvalidated" and
"real-night value" landed in `browser` — rows a browser can never close. Caught before applying.

---

## Process notes that cost time

- **`get_check_runs` returning `total_count: 0` is a stale base, not slow CI.** Hit once on #1390
  when the branch was 6 commits behind; an "E2E failure" was diagnosed against that stale run before
  the base was checked. Check `git log HEAD..origin/main` *first*.
- **Two lanes are working this queue.** A Q number was filed as Q-285 and had to be renumbered to
  Q-297 when #1378 landed holding 285–296. Several entries (Q-255, Q-260, Q-232-followup) were
  completed by the other lane mid-session. Re-verify every premise against current `main`, and check
  open PRs before claiming a number.
- **`pkill` exits 144 and breaks `&&` chains** — a config edit silently never applied because of
  this, and the resulting "fix didn't work" sent the next twenty minutes in the wrong direction.
- **A local dev DB accumulates state that breaks other people's specs.** `goal-invalidation.spec.ts`
  fails against a used database (waits for a `/ 7,000` steps-goal row that never renders) and passes
  on a fresh one. If a spec fails locally and you did not write it, rebuild a fresh DB before
  believing it.

---

## Carrying this into the public repo (Q-49)

The owner has said the next move is the public-repo migration, so here is what this session leaves
that the cut has to account for. None of it blocks the cut; two items want a decision.

**The E2E harness is portable as-is.** `playwright.config.ts` and `e2e/` reference no private path,
no vendored model, and no credential. The one environment-specific line is deliberate and
self-explaining: the config uses `/opt/pw-browsers/chromium` **only when that path exists**, and
falls back to Playwright's own managed download everywhere else — so a public contributor running
`pnpm e2e` after `npx playwright install chromium` gets the same behaviour with no sandbox knowledge.

**⚠️ The E2E CI job puts a credential-shaped literal in a file that is about to become public.**
`.github/workflows/ci.yml:367` sets `AUTH_SECRET: e2e-ci-secret-not-used-outside-this-job` inline.
It is a dummy — NextAuth needs *some* signing key or the credentials callback returns
`?error=Configuration`, and this value signs nothing outside that ephemeral job against an ephemeral
database. But Q-49's own constraint is *"CI stays offline and holds no credential"*, and a reader of
a public repo cannot tell a dummy from a leak by looking. **Decide before the cut:** either move it
to a repository secret (costs nothing, removes the question), or leave it and add a one-line comment
in the workflow saying explicitly that it is a throwaway. Do not leave it bare and unexplained.

**The seeded test user is already public-safe.** `test@local.dev` / `testpass123` live in
`scripts/local-db/seed.sql` and are referenced by `e2e/fixtures.ts`. They only ever authenticate
against a local or CI database, and they were public in intent before this session — worth a
sentence in the public README so nobody files it as a leak.

**The E2E job is not a required check, and should stay that way through the cut.** It has three
green CI runs and one unexplained red (see the section above). Promoting it to required before that
red is understood would make a public repo's first contributor experience a mystery failure.

**What the harness changes about the migration's risk profile.** Q-254's re-tagging measured that
**32 of 83** device-verification rows are waiting on nothing but a browser. That bucket is now
addressable by anyone with the repo — including outside contributors after the cut — which is a
better argument for the cut than any of the ones in Q-49's entry, and worth adding to it.

**Nothing in this session touched the vendored-model or private-path surfaces** that Q-49 Phase A
is actually gated on (`scripts/private-paths.json`, the `.onnx` delivery). The `check:rules` gate
that guards them passed 36 of 36 on every commit here.

---

## Pickup prompt

```
You are continuing an implementer session on TrainingAI. Work on branch
claude/trainingai-backlog-v0abea (create it from a freshly fetched origin/main if it does not exist).

Read in this order:
  1. projectOverview.md
  2. docs/handoff-2026-08-16-platform-e2e-harness-and-backlog-run.md
  3. e2e/README.md
  4. docs/implementation-backlog.md (protocol at the top)

FIRST ACTION: PR #1390 is open with all five required checks green and the E2E job red. Its failed
jobs were re-queued on run 31973027001 — check that result. The full 12-spec suite has been proven
to pass against a CI-identical fresh database (create one: createdb, node scripts/local-db/migrate.js,
psql -f scripts/local-db/seed.sql, then run playwright against it), so the CI failure is
environmental, not a spec defect. Do NOT delete a spec to make CI green.

To find out what actually failed in CI, download the playwright-report artifact via
mcp__github__actions_list method=list_workflow_run_artifacts — get_job_logs returns only the
Postgres service container stream for the E2E job and is useless for this.

Constraints that will otherwise be rediscovered:
  - "Custom rules pass" means `pnpm check:rules` and quoting its "Ran N of N" count. Do not
    hardcode N; it was 36 on 2026-08-16.
  - Run the full vitest suite under the TCP DATABASE_URL
    (postgresql://postgres:postgres@localhost:5433/trainingai_dev), not the socket form the session
    hook exports — the socket form silently skips claude-ro-readonly-role.test.ts.
  - `pnpm build` is part of the local gate; tsc + lint + tests is not sufficient.
  - Every new test must be mutation-verified: run it against the unfixed code and watch it fail.
  - A second lane is working the same queue. Check open PRs and re-verify each entry's premise
    against current main before implementing, and before claiming a Q number.
  - Nothing this session touched has been verified on the S25.

Three items are blocked on the owner and must not be guessed: Q-309 (needs a tap on the device),
Q-231 (retire the Exercise-detected card or feed it from BLE), and which backlog slice to
prioritise. If the owner has not answered, work other entries.
```
