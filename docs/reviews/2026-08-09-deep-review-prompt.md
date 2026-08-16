# Prompt — the deep review (running app · production data · CLAUDE.md itself · mobile UI standards)

**Written:** 2026-08-08 · **For:** a fresh review session · **Type:** review, docs-only output

This file is a **ready-to-paste prompt**. Everything below the horizontal rule is the prompt.
Written against `main` at `930104bc` (v1.270.22): **197 API routes, 40 pages, 343 components,
~184k lines of TS/TSX, 411 test files, 170 Postgres migrations, local SQLite v21, 248 `###`
sections in `projectOverview.md`, 916 lines of `CLAUDE.md`.** Re-derive all of it; it rots fast.

**How this differs from [`2026-08-07-full-app-review-prompt.md`](2026-08-07-full-app-review-prompt.md),
which you should read first.** That review was excellent and read-only — its own closing section says
*"No device, no emulator, no browser this session."* Everything it found came from reading code and
querying production. This one adds the four things it could not do:

1. **Actually run the app.** `pnpm dev` against the local Postgres, with seeded and deliberately
   *adversarial* mock data. Drive the flows. A bug you can see is worth ten you inferred.
2. **Review `CLAUDE.md` itself as a document**, not just as a checklist to apply. It is 916 lines of
   accumulated rules and at least three of its factual claims were wrong as of 2026-08-08.
3. **Judge the mobile UI against external standards** — Material Design, WCAG, platform
   conventions — not only against this repo's own rules. The repo's rules encode past bugs; they do
   not encode everything good practice requires.
4. **Go deeper on production data**, now that server errors finally carry Postgres codes.

---

## Prompt

You are running **the deepest review this project has had**. Previous sweeps read the code and
queried the database. You will additionally **run the application**, **drive it with data chosen to
break it**, and **audit the rulebook that governs it**.

### What this session is and is not

- **It IS**: a read, run, measure and interrogate sweep producing a review document,
  `projectOverview.md` Known-Issues rows, and prioritised backlog entries.
- **It is NOT** an implementation session. Ship **one docs-only PR**. Trivially safe one-line fixes
  are allowed only if queueing costs more than doing — declare each one in the review doc and bump
  `package.json` + `packages/shared/src/changelog.ts`.
- Per **Backlog-driven implementation** in `CLAUDE.md`: plan now, build later.

### Read first, in this order

1. `projectOverview.md` — **248 `###` sections.** Build the list of open (🔴/🟠/⚠️) rows *before*
   reading code. You must not re-raise anything already there.
2. `docs/implementation-backlog.md` — an already-queued item is not a finding. Note the "Next free
   Q number" line and claim against **both** this file and open PRs.
3. `CLAUDE.md` — both as checklist **and** as the subject of Lens 9.
4. `docs/reviews/2026-08-07-full-app-review.md` — the prior sweep. Its §7 "Checked and clean" is a
   list of things you may skip unless you have reason to doubt them; its §8 "Surfaces NOT exercised"
   is your starting worklist.
5. `docs/reviews/2026-08-08-db-scalability-and-tooling-review.md` — the database layer.
6. `docs/module-map.md` — before flagging "should be shared", check whether it already exists.
7. `docs/domains/README.md` + each pillar index you touch.

### What landed on 2026-08-08 that you must not re-discover

Six PRs, all merged. Read these before starting or you will re-find them:

- **#1155** — DB/scalability review; four new `Custom Rules` CI checks
  (`check-migration-numbers`, `check-timezone-rendering`, `check-date-param-regex`,
  `check-component-size`), each carrying a **shrink-only** grandfather list.
- **#1159 / #1150** — both error-recording paths now capture the Postgres `cause`. **This is why
  Step 0 below is more powerful than it was last time.**
- **#1160** — a user-scoping test that borrowed a user it did not create; vacuous in CI, failing
  locally.
- **#1161** — calendar/streak now bucket by the user's timezone; `getCalendarData`,
  `getRecentTrainedDays`, `getOuraWorkouts`.
- **#1163** — first bundle-size baseline, recorded as a **negative result**.
- **#1168** — triage of the device-local rendering list: 7 benign, 1 fixed, 2 blocked.

Three open items from that day are deliberately left for you or the owner: **Q-143** (clock-anchor
full-table read), **Q-145** (unattributed errors — needs an owner decision between three options),
**Q-147** (cold app start, needs the device), **Q-148** (no client component can read the user's
timezone).

---

## Step 0 — production reality, before any code

Three reads. Do all three first; they steer everything after.

**a) `error_events` — and this time the codes are there.** Both recording paths now prefix the
Postgres error code (`[pg 57014] …`). The table prunes at 30 days.

```bash
curl -sX POST https://trainingai-production.up.railway.app/api/admin/db-query \
  -H "Authorization: Bearer $CLAUDE_DB_QUERY_SECRET" -H 'Content-Type: application/json' \
  -d '{"sql":"SELECT source, left(message,160) AS message, count(*) AS hits, min(created_at) AS first_seen, max(created_at) AS latest FROM claude_ro.error_events WHERE created_at > now() - interval '"'"'30 days'"'"' GROUP BY 1,2 ORDER BY hits DESC LIMIT 60"}'
```

**The single highest-value question in this whole review:** do any `Failed query` rows now carry a
`[pg …]` prefix, and what is the code? `57014` = `query_canceled` = `statement_timeout`, which means
**Q-107's queued `getSyncDelta` batching fix is aimed correctly**. Codeless connection-acquisition
failures mean something else is dropping connections and the batching fix would waste effort. The
2026-08-08 review measured the distribution — **77 of 98 failures were a lone query failing while
every other query in flight succeeded**, which is *not* the shape pool exhaustion makes — but could
not name the cause. You may be the first session able to. Say so explicitly if no fault has occurred
since the fix deployed; "no data yet" is a legitimate and useful answer.

Give every distinct signature a verdict: known-and-recorded, new-and-recorded-this-session, or
stopped-with-no-explanation. *Something that stopped is not something that was fixed.*

**b) Write-path liveness.** Synced domains are authoritative in
`packages/shared/src/sync/mutation-schema.ts` (`SYNCED_MUTATION_DOMAINS`), mirrored by the
`pushMutations` branches in `lib/data/postgres/adapter.ts`. For each: `max(created_at)`, 30-day row
count, and null-rate of the columns the UI renders. **A column 100% null is a dead write path** —
found three times already. Diff against
`docs/reviews/2026-08-05-data-collection-gap-sweep.md` rather than repeating it.

**c) The volume trend, re-measured.** On 2026-08-08 the database was **421 MB growing ~12 MB/day**,
with `oura_raw_samples` at 73% of it and its row count having **doubled in 18 days**. Q-30's
remaining work is owner console actions that reclaim *bloat* and cannot slow *data*. Re-measure:

```sql
SELECT pg_size_pretty(pg_database_size(current_database()));
SELECT relname, n_live_tup, pg_size_pretty(pg_total_relation_size(relid))
FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 15;
```

If the trend holds, say how many days remain before ~924 MB, in the review doc, in bold. That number
is the most decision-relevant thing in this project right now.

Findings from Step 0 outrank anything found by reading code.

---

## Step 1 — RUN THE APP. This is the part previous reviews could not do.

```bash
pnpm db:local        # idempotent; seeds test@local.dev / testpass123
pnpm dev
```

`DATABASE_URL`/`DATABASE_SSL` are pre-set to production in the container and Next will not let
`.env.local` override them — the session-start hook writes the `unset` lines, so use a fresh shell.

**Do not just click the happy path.** Seed data designed to break things, then drive the flows:

1. **A second user in another timezone.** `America/New_York` is the useful one — Brisbane is UTC+10,
   so 14 of every 24 hours fall on a different calendar day. Give them workouts at 20:00 local,
   sleep spanning midnight, food logs at 23:50. **Q-144 fixed the calendar and streak; Q-148 says no
   client component can read the user's timezone at all.** Find what else is wrong for this user.
   Every screen showing a date or a time is a candidate.
2. **Boundary dates.** A workout at 23:59:59 and one at 00:00:01 local. Month-end (Jan 31, Feb 28/29,
   Dec 31 → Jan 1). A date-of-birth in a leap year.
3. **Empty and near-empty states.** A brand-new user with no program, no logs, no ring. **Screens
   that only ever get exercised against the well-populated seed are where crashes hide** — the
   `Cannot read properties of null` and `.reduce is not a function` bursts in `error_events` are that
   shape. Visit every one of the 40 pages as this user.
4. **Adversarial values.** 0 kg, 999 kg, negative reps, a 26-hour sleep, a food entry with 10,000
   calories, an exercise name with emoji and RTL text, a 500-character note. Where is the validation
   boundary, and what does the UI do past it?
5. **Offline.** DevTools offline, then save in each offline-first domain. Does the UI confirm
   instantly? Does it survive reload? Come back online — does it sync, and does the pull clobber the
   local edit? `getLocalStore` returns null in web, so the *native* half stays unverified — say so.
6. **Rapid interaction.** Double-tap every submit. Five taps on "complete workout" once fired four
   POSTs.

**Capture screenshots at a 390×844 viewport** (S25-ish) for anything visual you report. A UI finding
without a screenshot is an assertion.

For each of the 40 pages record: renders / renders-with-console-errors / crashes / not-reached. **A
page you did not open is recorded as not reviewed, not omitted.** Silent partial coverage is the most
damaging thing this review can do.

---

## Step 2 — the lenses

Lenses 1–8 are defined in
[`2026-08-07-full-app-review-prompt.md`](2026-08-07-full-app-review-prompt.md) — **read that file and
run them**; they are not repeated here. Weight them by what the prior review already certified clean
in its §7, and by whatever Step 0 and Step 1 surfaced. Lenses 9–12 below are new.

---

### Lens 9 — `CLAUDE.md` as the subject, not the checklist

916 lines accumulated over ~290 sessions. Every rule was earned, but the file has never been audited
as a document. On 2026-08-08 three of its factual claims were wrong.

- **Verify every factual claim.** File paths, line counts, "N call sites", "the reference is X".
  Known-stale examples: its Key Files table points at `lib/1rm.ts`, which **does not exist**; its
  `oura_raw_samples` growth figure of "~3.2 MB/day" describes the *device-local* window and is ~3×
  under the measured server rate. `grep` every path it names and report the dead ones.
- **Find rules contradicted by the code they govern.** A rule nothing obeys is either wrong or
  systematically violated — both are findings, and they need different fixes.
- **Find rules that could be CI checks.** Eight now exist in the `Custom Rules` job. Which remaining
  strict rules are mechanically checkable? Candidates never automated: `normalizeDateParam` on
  date-accepting routes, SWR headers on new aggregate GETs, rate limits on new AI routes, hardcoded
  timestamps on one side of a rolling window, `.set()` taking a raw request body.
  **Note the known scope limit of the existing checks:** `check-timezone-rendering` matches
  `toLocale*String` only and cannot see shared formatters called without a tz argument — one file
  left its list without becoming correct. Propose rules that do not have that hole.
- **Find rules that are obsolete or now harmful.** The APK-only premise is already formally amended.
  What else has been overtaken?
- **Judge the document's usability.** A rule nobody can find is a rule nobody follows. If a session
  must read 916 lines to start safely, that is a real cost — propose structure, but do **not**
  rewrite it in this PR.

Deliverable: a section listing each inaccuracy with the correct value, and a proposed diff **queued
as a backlog entry**, not applied.

---

### Lens 10 — mobile UI against external standards

Load the `ui-ux-pro-max` skill, then go beyond it. The repo's rules encode *past bugs*; they do not
encode everything good practice requires. Judge against Material Design 3, WCAG 2.2 AA, and Android
platform conventions — and say which standard each finding comes from.

- **Touch targets and reach.** 48dp minimum, 8dp separation. On a 6.9" display the top corners are
  out of one-handed reach — is anything destructive or frequent stranded up there?
- **Contrast, measured not eyeballed.** 4.5:1 body text, 3:1 large text and UI components,
  **in both themes**. Compute the ratios from the resolved token values. `DetailHero` hardcodes dark
  and is the known cautionary case.
- **Input types.** Does every numeric field bring up a numeric keyboard (`inputMode`, `type`)? Does
  every field have a real label, not just a placeholder? Placeholder-as-label fails WCAG and vanishes
  on focus.
- **Focus, keyboard and screen reader.** Every interactive element focusable, visible focus ring,
  sensible order. Radix primitives give this for free; hand-rolled `div role="button"` does not.
  Q-133 covered `aria-expanded` on disclosures — check what it did not.
- **Motion and reduced motion.** Is `prefers-reduced-motion` honoured anywhere? The app has bounce,
  marquee, confetti and ring animations. WCAG 2.3.3.
- **Error, empty and loading states.** For each of the 40 pages: what does the user see when the
  fetch fails, when there is no data, and while loading? A card that silently vanishes on error is
  the documented `cachedFetch` failure mode.
- **Text scaling.** Android font size at maximum — what breaks? Fixed-height containers with text
  inside are the usual casualty.
- **Destructive actions.** Delete a workout, a program, a food log. Is there confirmation? Undo?
  Anything irreversible reachable in one tap?

Screenshots required. Report the *trend* on the 455 hex literals rather than trying to fix them.

---

### Lens 11 — does the test suite actually test anything?

411 test files, ~3,250 tests, and **no coverage tooling has ever been configured**. Green is not the
same as meaningful — 2026-08-08 found a test that passed in CI *because its fixture never landed*.

- **Spot-check by mutation.** Pick ~10 important tests across domains. Break the code they cover —
  invert a condition, drop a `user_id` scope, change a constant. Does the test fail? A test that
  survives its own mutation tests nothing. Report the pass rate.
- **Hunt the vacuous-assertion shape**: assertions inside `if` guards that can be false; fixtures
  that borrow rows they did not create (`SELECT … WHERE id <> $1 LIMIT 1`); `expect(x).toBeDefined()`
  where `x` is always defined; tests that assert only that a function did not throw.
- **CI-vs-local asymmetry.** CI migrates but **never seeds**; local is seeded. A test can pass in one
  and fail in the other for opposite reasons. Find every test whose behaviour depends on which.
- **Rolling-window time bombs.** Any test hardcoding one side of a window relative to the real clock
  will eventually fail on `main` — it has happened.
- **Coverage of the critical paths**, by reading not tooling: the outbox push/pull loop, cache-group
  invalidation, ownership scoping on write routes, the prescription engine, `mergeSet` ranking. Which
  have no test at all?

Do **not** install a coverage package in this PR; propose it as a backlog entry if it is warranted.

---

### Lens 12 — scale, and the second user who already exists

The owner has stated other people already have accounts and a Play Store listing is intended.

- **Cross-user isolation, driven not just read.** With two seeded users, exercise every read path as
  user B and confirm nothing of user A's appears. Ownership was certified clean by reading in the
  prior review; this is the empirical check.
- **Single-user assumptions.** `DEFAULT_TZ` fallbacks on read paths (three were fixed; find the
  rest). `WEBHOOK_USER_ID`, `ADMIN_EXPORT_USER_ID`, `CLAUDE_RO_OWNER_USER_ID`. Module-level server
  state keyed by something other than user id. Rate-limit keys without a user id.
- **What breaks at 10 users, or 100?** Pool `max: 10` × replicas against Railway's connection limit.
  `oura_raw_samples` at ~12 MB/day **per ringed user**. Rate limits sized for one person. The
  `claude_ro` views are scoped to one owner by design — what happens to admin surfaces with more?
- **Play Store gates** listed in `docs/public-launch-checklist.md`: privacy policy, data-safety
  declarations, and the **Health Connect declared-use-case review**, which is not a formality.

---

## Rules of evidence

1. **Every finding carries `file:line`**, or a screenshot, or the SQL that produced it. A claim
   without a location is not a finding.
2. **Verify against current `main`.** Every count in this prompt will rot. Re-derive.
3. **Do not re-raise** what `projectOverview.md` or the backlog already record. Finding a recorded
   issue is *worse* or *differently caused* than recorded **is** a finding — say what changed.
4. **State the user-visible consequence.** "Missing invalidation" is not a finding; "logging a meal
   leaves the achievements card stale for 5 minutes" is.
5. **Severity by blast radius**: silent data loss > wrong number shown as fact > stale/incorrect UI >
   performance > hygiene.
6. **Distinguish observed from inferred.** Say which findings you *saw happen* and which you reasoned
   to. This review can observe far more than its predecessors — that distinction is its main value.
7. **A negative result is a result.** If a lens finds nothing, say so; if a plausible theory does not
   survive measurement, write that down so nobody re-opens it. The 2026-08-08 bundle measurement and
   the Q-127 entry are the models.
8. **Say what you did not check** — native SQLite/Capacitor, safe-area on real hardware, Samsung
   WebView compositing, real Oura/Health Connect tokens, drifted prod data.
9. **No orphaned findings.** Every finding gets a backlog entry or a Known-Issues row **in this same
   PR**.

## Traps that have each cost a previous session

- `pnpm test` behaviour depends on which `DATABASE_URL` form is in your shell. The session-start hook
  exports the **Unix-socket** form; role-sensitive suites (`claude-ro-readonly-role.test.ts`) need the
  **TCP** form or ~20 tests fail at once and read like a broken security guarantee.
- The sandbox's `node_modules` can be missing packages that *are* in `package.json` —
  `@capacitor-community/speech-recognition` was, and it fails `pnpm build`/`pnpm typecheck` on
  `voice-log-button.tsx`. `pnpm install --frozen-lockfile` fixes it and touches nothing. **Do not
  report it as a repo defect** — a previous session did.
- A build started while a merge conflict is unresolved fails inside webpack with an opaque
  `Import trace: ./packages/shared/src/changelog.ts`. That is the conflict markers.
- Oura rollup tests run in a separate `rollup` vitest project at 60 s. A rollup timeout **now** is
  worth believing, not re-running.
- `faketime` shifts node's clock but not Postgres; DB tests mixing node time with `now()` fail
  spuriously past ~1h skew.
- CI state comes from the GitHub MCP tools. A bash `curl` to `api.github.com` with `$GITHUB_TOKEN` is
  **not authenticated** here; its silence means nothing.
- `get_check_runs` returning `total_count: 0` minutes after opening a PR means a **stale base**, not
  slow CI. Fetch, merge `main`, push.
- **`main` moves under you.** On 2026-08-08 a single PR needed five rebases; `package.json` and
  `changelog.ts` collided every time. Resolve by **rebuilding both files from `origin/main`** and
  re-bumping — never splice the conflict hunks.

## Suggested shape

Step 0 (production) → Step 1 (run the app) → lenses in parallel → synthesis. Budget generously for
Step 1: it is the part no previous review has done and where the highest-value findings will come
from. Roughly one agent per lens, each returning file:line evidence, then a synthesis pass that
deduplicates against `projectOverview.md` + the backlog and ranks by blast radius.

## Deliverables (one docs-only PR)

1. `docs/reviews/2026-08-09-deep-review.md` — coverage tables (**197 routes by pillar, 40 pages with
   a render verdict each**), then findings by lens, ranked by severity, each with evidence,
   consequence and proposed fix. Separate **observed** from **inferred**. Include a "checked and
   clean" section and a "not exercised" section.
2. `projectOverview.md` — a Known-Issues row per live user-visible finding, `[domain]`-tagged.
3. `docs/implementation-backlog.md` — an entry per actionable finding at the priority you judge
   right; claim Q numbers against the file **and** open PRs.
4. `docs/domains/<pillar>/README.md` — link the review from every pillar it covers. **This step was
   missed on 2026-08-08; do not miss it.**
5. `docs/overview/entries/2026-08-09-<branch-slug>.md` — the journal entry, a new file.
6. **The CLAUDE.md accuracy report** (Lens 9) — inaccuracies with correct values, and a proposed diff
   queued rather than applied.
7. **The consolidated device-verification list** — every outstanding ⚠️ "NOT verified on device" row,
   grouped so the owner can clear several in one smoke run.
8. **Screenshots** for every visual finding.

Branch from a freshly-fetched `main`, open the PR, let CI run, merge when green (docs-only merges
with zero ceremony). Expect to rebase more than once.
