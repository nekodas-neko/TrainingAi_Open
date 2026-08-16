# Handoff — 2026-08-11 · queue drain: deload wiring, soft-delete coverage closed, Coach charts

_Domain: `platform` (also touches `workouts`, `activity`, `app-shell`) · Branch: `docs/session-wrapup-2026-08-11` · PRs: #1244 #1246 #1247 #1249 #1251 #1252 #1253 #1255 — **all merged**_

> **Read first:** `projectOverview.md` (status + Known Issues), then
> `docs/domains/platform/README.md`, then `docs/implementation-backlog.md` (the queue).
> This file covers only what *this* session did and what it leaves behind.

## Goal

Work the backlog queue top-down, autonomously, merging on green. Follows
[`handoff-2026-08-09-platform-single-agent-queue-drain.md`](handoff-2026-08-09-platform-single-agent-queue-drain.md)
and continues the mutation-testing method from
[`handoff-2026-08-09-platform-mutation-testing-invariants.md`](handoff-2026-08-09-platform-mutation-testing-invariants.md).

## Current status

- **Build/test:** full suite green at each merge (last run 443 files / 3580 tests), lint + every
  custom-rules script + `tsc` clean. `pnpm dev` was actually exercised, not just typechecked:
  `/api/workout-data` (both paths), `/api/confirm-early-deload`, `/api/readiness-score` and
  `/api/coach` were driven against the local DB with a real session cookie.
- **Device-verified: NO.** Nothing here touches an offline-first domain, a native plugin,
  safe-area or notifications, so the changes reach the APK through the Railway deploy with no
  rebuild — **except the Coach chart, which paints on canvas in Samsung's WebView** and is
  recorded as an unverified Known-Issues row in `projectOverview.md`.

## What shipped

| PR | Item | What |
|---|---|---|
| #1246 | **Q-175** | A confirmed early-deload *week* never reached the AI-dynamic prescription. `isEarlyDeloadWeek()` (`packages/shared/src/phase-engine.ts`) answers the window with no phase to consult; both `app/api/workout-data/route.ts` paths surface it; `buildWorkoutExercises` reads `aiDeload \|\| isDeloadActive`. Measured live: **82.5% × 4 sets → 50% × 2**, back to full on day 8. v1.279.1 |
| #1249 | **Q-183** | A lifting day with zero zone-minutes was scored as a missed cardio target at full weight. `computeActivityScore` takes `strengthSessionToday` and excludes the lane on an exact zero. Live A/B: **33 → 38**. v1.279.2 |
| #1253 | **Q-141** (redirected) | Coach's prompt instructed charts it had no way to draw. New `renderChart` widget + `components/coach/coach-chart.tsx`. v1.281.0 |
| #1244 #1251 #1252 | **Q-182** | Soft-delete filter coverage closed: `user-stats.ts` (7), `periodization.ts` (17), `oura.ts` (11). Entry removed. |
| #1247 | **Q-173** | Removed — already shipped in #1223, resurrected by a stale-base merge for the second time. |
| #1255 | **Q-189** | Filed the unreachable `/chat` + `/api/ai-chat` pair. |

## Deliberately NOT done

- **Q-185** — during an ai_dynamic deload only the exercises the AI prescription *names* are
  reduced. Accessories and any session with a missing/expired prescription stay at full base-style
  load. Predates #1246 and **both** deload entry points share it. Left because deciding what a
  deload means for an exercise the AI is not driving is a load-changing decision, not a rider on a
  bug fix. **Needs the owner.**
- **Q-186 Meal Plan** — the queue's top item, left for its own agent (owner's call). Its backend
  half has since merged as #1256.
- **Q-189** — filed, not done. Note the entanglement recorded in the entry:
  `components/chat.tsx:307` is the **only** caller of `/api/ai-chat/tts`, so deleting the surface
  deletes text-to-speech from the app.

## Key decisions (with rationale)

- **Q-183's trigger was measured, not chosen.** The entry left "decide the trigger" open. Queried
  the owner's last 45 days through `claude_ro`: **40 were exactly zero zone minutes, 32 of those on
  lifting days.** Exact zero covers it, so no threshold was invented. Rest-day zeros stay scored —
  a zero *there* genuinely means no moderate activity.
- **Q-175 extracted a helper rather than duplicating the window check.** `isDeloadActive` needs a
  `ProgramPhase`; ai_dynamic programs have none. `isEarlyDeloadWeek` splits the window out and
  `isDeloadActive` calls it — one formula, one place.
- **Q-141 was redirected after re-verifying, not implemented as filed.** It targets
  `/api/ai-chat` + `components/chat.tsx`, which **no UI links to any more**. Building it would have
  improved an unreachable page.
- **The Coach chart resolves itself on render.** Every other widget asks the user something; a
  chart does not, so nothing would ever answer it — and an unanswered client-side tool call wedges
  the thread (the `AI_MissingToolResultsError` class). It sends `{status:'shown'}` on mount, and
  `coach-message.tsx` special-cases it so it never collapses into the spent-form bubble.

## Gotchas / what did NOT work

- **A mutation sweep must swap in an always-true predicate on a table the query already joins.**
  First attempt used `isNotNull(s.users.id)` in queries that never join `users` — the extra
  "failures" were SQL errors. **A mutation that fails for the wrong reason is indistinguishable
  from coverage** unless you read the output.
- **Counting tests would have called Q-182 done when it was not.** The first periodization draft
  left two filters alive: `getWeeklySetsByMuscleGroup` is **two queries with three filters each**,
  and a case deleting only the library-side row never exercises the non-library query's copies.
  Only the per-filter sweep named them.
- **Q-182's own deferral reason was wrong.** `oura.ts` was held back for a whole entry as "needs a
  seeded rollup window". Its eleven filters are ordinary work-list queries over
  sessions/logs/sets — the estimate came from the slice's *name*. The deferral cost more than the
  work did.
- **`ChartMessage` passes dataset colours straight to chart.js.** A `var(--accent-cyan)` would have
  painted black; `CoachChart` calls `resolveColor` first. CLAUDE.md records this shipping twice.
- **Q-number collisions, twice more.** Q-183/184 were held by then-open **#1245**, and Q-188 by
  **#1254** — neither visible in the queue file. Checking `list_pull_requests` before taking a
  number caught both *before* pushing, a first. The pointer now says to do that.
- **Version conflicts are constant with parallel agents.** #1253 lost 1.280.0 to another session
  mid-CI. Resolved by taking `git show origin/main:packages/shared/src/changelog.ts` and rewriting
  the file — never splicing the conflict hunks.
- **`normalizeMuscle` folds `core` → `abs`**, which failed a first-draft assertion keyed on the raw
  library label.

## Files to look at

- `packages/shared/src/phase-engine.ts` — `isEarlyDeloadWeek` / `isDeloadActive`, the two-entry-point convergence.
- `packages/shared/src/workout/session-data.ts` — the `aiDeload || isDeloadActive` branch, and the accessory-RPE guard that shares it. **Q-185 lives inside `if (aiDrivesLoad)` here.**
- `packages/shared/src/health/activity-score.ts` — the zone-minutes structural-zero guard.
- `lib/coach/widgets.ts` + `components/coach/coach-chart.tsx` + `components/coach/widget-registry.tsx` — the chart widget and its self-resolve.
- `lib/data/postgres/__tests__/{user-stats,periodization,oura-workout}-soft-delete.test.ts` — the coverage pattern to copy for any new slice.

## Open questions / blockers

- **Q-185 needs an owner decision** (above).
- **The Coach chart is not device-verified** — ask Coach "show my weight over time on a chart" on
  the S25 and confirm the canvas renders in both themes.

## Pickup prompt

```
Work the TrainingAI backlog queue. Check out `main` fresh:
  git fetch origin main && git remote prune origin && git checkout -B <your-branch> origin/main

Read in this order:
  1. projectOverview.md — status and the live Known Issues table
  2. docs/domains/<pillar>/README.md for whichever pillar your item is in
  3. docs/handoff-2026-08-11-platform-queue-drain-deload-coverage-coach-charts.md (this session)
  4. docs/implementation-backlog.md — the queue, worked top-down

First concrete action: read the top queue entry and re-verify it against current `main` BEFORE
implementing. Two of this session's items were stale — one targeted a route no UI links to any
more, one had already shipped and was resurrected by a stale-base merge. The queue is not
self-verifying.

Constraints you would otherwise rediscover:
- Q-186 (Meal Plan) is being handled by its own agent. Its backend half merged as #1256. Do not
  start it without checking with the owner.
- Q-185 is blocked on an owner decision: during an ai_dynamic deload, only exercises the AI
  prescription NAMES are reduced (inside `if (aiDrivesLoad)` in
  packages/shared/src/workout/session-data.ts). Accessories and expired-prescription sessions stay
  at full load. Do not pick a rule for this unilaterally — it changes prescribed load.
- Before claiming a Q number or a migration number, check BOTH docs/implementation-backlog.md AND
  the open PR list (`list_pull_requests`). Numbers were taken twice this session by PRs that had
  not merged yet.
- Expect package.json / packages/shared/src/changelog.ts conflicts. Resolve by rebuilding from
  `git show origin/main:packages/shared/src/changelog.ts` and re-bumping — never splice the
  conflict hunks; that corrupted the changelog twice on 2026-08-08.
- If you write a coverage test, verify it by mutation, and make the substitute predicate name a
  table the query already joins — otherwise the "failure" is a SQL error, not detection.
- Device gate: any change touching an offline-first domain, a native plugin, safe-area, gestures
  or notifications needs the on-device smoke run OR a Known-Issues row saying it is unverified.
  Server/JS changes reach the APK through the Railway deploy with no rebuild.
- Outstanding device check from this session: ask AI Coach "show my weight over time on a chart"
  on the S25 and confirm the canvas chart renders correctly in both light and dark themes.
```
