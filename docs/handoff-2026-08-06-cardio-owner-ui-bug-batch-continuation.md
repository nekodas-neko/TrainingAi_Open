# Handoff — 2026-08-06 · Owner UI-bug batch, continued (Q-93→Q-90 shipped, Q-88 onward next)

_Domain: `cardio` (next item up) · also touches `app-shell`, `heart-rate`, `sleep`, `workouts` ·
Branch: `main` (all work this session merged) · PR: none open_

> **Read first:** `projectOverview.md` (status + Known Issues — has a `🆕` bullet for every PR
> below), then `docs/domains/cardio/README.md` for Q-88's context, then
> `docs/implementation-backlog.md` (the live queue), then
> `docs/superpowers/plans/2026-08-05-owner-ui-bug-batch.md` (the plan every Q-number below traces
> to — Tasks 1–14). This file covers only what *this* session did and what it leaves behind.

## Goal

Work through the owner-reported UI-bug batch (`docs/superpowers/plans/2026-08-05-owner-ui-bug-batch.md`,
Q-86 through Q-102) top-to-bottom per `docs/implementation-backlog.md`'s protocol: one PR per
item, fresh branch → implement → verify → docs update → merge when CI-green, skip anything needing
an owner decision or on-device-only verification.

## Current status

- Build/test: every shipped PR ran `tsc --noEmit`, `eslint`, and the full `pnpm test` suite
  (green each time — 402 files / ~3,190 tests by the last PR) plus a `pnpm dev` + Playwright pass
  exercising the actual changed screen(s) with real seeded local-DB data.
- Device-verified: **no.** Every PR this session was JS-only (no `android/**` changes) and
  verified via the web dev server only. Chart/UI rendering was screenshotted in both light and
  dark themes via headless Playwright, not on the S25.
- Git state: clean, `main` synced to `origin/main` at `05ecddd`.

## What shipped (this session, in order)

| PR | Item | Domain | What changed |
|---|---|---|---|
| [#1104](https://github.com/nekodas-neko/TrainingAI/pull/1104) | Q-93 | app-shell | Today's Timeline meal card is tappable → `/nutrition?date=...`. Sleep/workout cards deliberately left non-interactive — see "Deliberately NOT done" below. `TimelineEvent` gained a `date` field. |
| [#1105](https://github.com/nekodas-neko/TrainingAI/pull/1105) | Q-92 | heart-rate | Home HR-today chart: bucket width promoted to a `bucketMinutes` prop (default 10, was hardcoded 5); new opt-in `showBackfill` dashed-line interpolation across 20min–2h coverage gaps (`interpolateGaps` in `hr-day-chart-gaps.ts`), wired on only at the home widget. |
| [#1107](https://github.com/nekodas-neko/TrainingAI/pull/1107) | Q-91 | sleep | Sleep hypnogram "going missing" was a reactivity gap, not a data gap (measured production first — no night was actually missing data). `sleep-content.tsx`, `health-content.tsx`, `session-select-content.tsx` all now refetch `'sleep-sessions'` on the `ta:oura-ble-synced` event while mounted. |
| [#1108](https://github.com/nekodas-neko/TrainingAI/pull/1108) | Q-90 | sleep | Sleep screen gained a segmented-control toggle (Sleep Stages / Bedtime / Wake Time, 14-day trends) + a skin-temperature card. `extraCards` callback grew an additive 3rd `trends` arg. |

Versions: v1.266.8 → v1.267.1 across these four PRs (plus one intervening PR from a different
session, "Add awake-time fragmentation cap to the Sleep Score", v1.267.0 — landed on `main`
mid-session, required a rebase on PR #1108).

## Deliberately NOT done

- **Q-93's sleep/workout timeline cards are NOT tappable.** The plan claimed sleep-card wiring was
  "straightforward" — false: `SleepContent` has no date-selection UI at all (always shows the
  latest night), so wiring a "yesterday" tap to it would silently show the wrong night. The
  workout card needs a historical HR-chart/exercise-detail screen that doesn't exist yet. Filed as
  **`Q-93-followup`** in the backlog with the concrete screen work each half needs — not scoped
  enough to implement yet.
- **Q-91's BLE ingest rollup still has no invalidation signal for the ordinary (non-manual) sync
  flow.** Only the two signals that already existed (manual Redecode, BLE drain-settle) got wired
  up. The rollup itself (`app/api/oura-ble/samples/route.ts`) is intentionally fire-and-forget for
  latency reasons (I20) — wiring a signal off its completion needs a scoped design, not a quick
  add-on. Filed as **`Q-91-followup`**.

## Key decisions (with rationale)

- **Q-92: bucket size 10min, `showBackfill` opt-in, wired only at the home widget.** The plan
  flagged "consider whether 10–15 min reads better" and "decide whether it's owner-toggleable" as
  open — picked the smaller/safer end of each range since only the home screen's chart was
  reported as jagged; the other 3 `HrDayChart` consumers got the smoother bucket but no backfill.
- **Q-90: "toggle" (not "combine"), segmented control over one shared chart area, skin temp as its
  own separate card.** The plan explicitly said "don't guess silently" on toggle-vs-combine.
  Picked toggle because it's one of the two options the owner literally named, using the app's
  existing `SegmentedTabs` pill-tab primitive (already used ~17× elsewhere) rather than inventing
  new UI. Skin temperature reads as a separate ask in the report's own phrasing ("shown somewhere
  on this screen"), so it's not part of the toggle group.
- **`HealthScoreDetail`'s `extraCards` callback grew an additive 3rd `trends` argument** (was
  `(data, color) => ReactNode`, now `(data, color, trends?) => ReactNode`) instead of duplicating
  a second `/api/health/trends` fetch inside `sleep-content.tsx`. Confirmed both other consumers
  (Readiness, Activity) use 1-arg callbacks and are structurally unaffected.

## Gotchas / what did NOT work

- **A chart.js `Legend` plugin omission passed every automated check.** On PR #1108's stacked-bar
  phase-hours chart, I registered `BarElement`/`Tooltip` but forgot `Legend` — `tsc`, `eslint`,
  and the full test suite all passed clean, and the legend simply rendered nothing, no error
  anywhere. Only caught by looking at an actual Playwright screenshot. **Lesson: a chart.js
  component with a `legend: {display: true}` option needs `Legend` in its `ChartJS.register()`
  call, same as any other plugin (`Tooltip`, `Filler`) — this is easy to miss because chart.js
  fails silently, not with an error.**
- **Local `main` briefly shows pre-merge file content if checked out before `git fetch` lands.**
  Happened twice this session (benign both times, no data lost) — always `git fetch origin main`
  *before* trusting what `git checkout main` shows you, not after.
- **Mid-session base drift is real with parallel sessions.** PR #1108's base moved (another
  session's PR landed) between opening and merging. `git fetch origin main` before merge showed
  it; resolved via `git rebase origin/main` with conflicts in `package.json`,
  `packages/shared/src/changelog.ts`, `projectOverview.md` — re-bumped the version on the fresh
  base (1.267.0 → 1.267.1, not the 1.266.12 I'd originally picked before the drift).
- **`planned-pct-bodyweight-migration.test.ts` failed once under full-suite load** with "deadlock
  detected", passed clean re-run alone. This is the documented pool-contention flake in
  `CLAUDE.md` (not a regression) — don't chase it, just re-run alone to confirm before treating a
  full-suite failure there as real.
- **Playwright browser sandbox timezone ≠ Brisbane.** Headless Chromium here runs in UTC, and
  `hr-day-chart.tsx`'s `midnightMs` calc uses the *browser's local* timezone (matches the real
  device in production, since the S25 is set to Brisbane) — so seeding HR data at real Brisbane
  local-midnight boundaries doesn't line up with what the sandboxed chart renders. Worked around
  by seeding test HR data within the *UTC* calendar day instead, purely for visual verification.
  Not a bug — a sandbox-only quirk, don't "fix" the component for it.
- **`NODE_PATH=$(npm root -g) node script.js`** is needed to run ad-hoc Playwright scripts in this
  sandbox — `playwright` isn't a project devDependency, only a global install.

## Files to look at

- `docs/superpowers/plans/2026-08-05-owner-ui-bug-batch.md` — the source plan for every Q-number
  in this batch (Q-86 through Q-102, Tasks 1–14). Re-verify each task's "what's already there"
  section against current `main` before implementing — two tasks this session (Q-90, Q-93) had
  premises that didn't fully hold up under inspection.
- `docs/implementation-backlog.md` — the live queue, in priority order. Q-88/Q-87/Q-86 are next
  (search for those headings), followed by Q-98/Q-99 (paired, cardio) further up the file.
- `components/health/hr-day-chart-gaps.ts` and `components/health/sleep-timing-trend-utils.ts` —
  the two "pure logic extracted from a .tsx so it's unit-testable" examples from this session; copy
  this pattern for any new chart with non-trivial math (bucket/gap logic, axis transforms).

## Open questions / blockers

None owner-blocking for the next 3 queue items (Q-88/Q-87/Q-86) — the plan already flags where
each one needs a decision and says the implementer (not the owner) should make it during the work
(see below). Q-98/Q-99 haven't been investigated this session at all; re-read their plan sections
(Tasks 13–14) before starting, since Q-98 is flagged as containing a real on-device-only bug
(`applyOverride` skipping the local-store/outbox write path) alongside a redesign ask — the fix
and the redesign may warrant separate PRs.

## Pickup prompt

```
Continue working through the TrainingAI implementation backlog's owner UI-bug batch
(docs/superpowers/plans/2026-08-05-owner-ui-bug-batch.md, tracked in
docs/implementation-backlog.md). Read projectOverview.md first, then
docs/domains/cardio/README.md, then this handoff:
docs/handoff-2026-08-06-cardio-owner-ui-bug-batch-continuation.md, then the plan doc itself.

Git state should be main, clean, synced to origin/main — verify with `git fetch origin main` before
trusting local main's content (don't just `git checkout main` and assume it's current).

Take the next ready items from docs/implementation-backlog.md in file order:
1. Q-88 (cardio) — give Zone 1 minutes credit on no-workout "lazy days". This reopens a documented
   design decision (D-10, docs/superpowers/specs/2026-07-26-cardio-system-spec.md:60-82), not a
   bug — the plan says the product-shape decision (what the "counts" UI looks like) should be made
   during implementation, not treated as a blocker.
2. Q-87 (workouts) — show "up next" exercise + starting weight on the exercise-summary/rest screen.
   Plan says this is cheap — traced to source already.
3. Q-86 (workouts) — AI prescription duration-preset switch feels unresponsive. Plan traces this to
   a decoupled-feedback bug between two controls, not a caching bug.
4. Then reconsider Q-98/Q-99 (both cardio, paired) — Q-98 has a real on-device-only bug
   (applyOverride skipping the outbox) bundled with a redesign ask; consider splitting the bug fix
   from the redesign rather than deferring the whole thing. Size carefully before committing to a
   single PR.

Skip anything needing an owner decision or on-device-only verification (there shouldn't be any in
items 1-3 per the plan's own framing, but re-check before assuming).

Follow the standard procedure used all session: fresh branch from a freshly-fetched origin/main,
implement, verify via typecheck + lint + full test suite + `pnpm dev` (seed real data in the local
Postgres, hit the real routes, screenshot any UI change with Playwright in both light and dark
themes — don't trust typecheck/lint/tests alone for chart.js UI, they won't catch a missing plugin
registration), update backlog + journal (docs/overview/entries/, new file per PR) + projectOverview.md
+ the relevant domain README + changelog + version bump all in the same PR, open the PR, and
re-confirm the base is still current (git fetch origin main) immediately before merging — another
session's PR landing mid-work is a real, not theoretical, risk here. Merge when CI is green without
asking first (standing instruction). Continue this loop through the remaining batch items.
```
