# Handoff — 2026-08-07 · Owner UI-bug batch cleared, full-app review backlog dispatched to two parallel agents

_Domain: `cross` (spans workouts, readiness, app-shell, platform, activity, sleep — see per-item tags below) · Branch: `main` (all work this session merged) · PR: none open_

> **Read first:** `projectOverview.md` (status + Known Issues), then
> `docs/domains/<primary>/README.md` for whichever pillar you're about to touch, then
> `docs/implementation-backlog.md` (the live queue — this doc is a snapshot of it, the file itself
> is the source of truth by the time you read this). This file covers only what this session did
> and what it leaves behind.

## Goal

Two things happened in one long session: (1) the remaining items from the 2026-08-05
owner-reported UI-bug batch were cleared to zero, and a same-day full-app deep review (§reviews/2026-08-07-full-app-review.md)
found 22 more real findings, filed as Q-117 through Q-138 plus three follow-ups
(Q-139, Q-140, and Q-73's unblock). (2) This session then worked that new queue
top-down until interrupted for a wrap-up, closing Q-73, Q-117, Q-118, Q-140, plus five items
from the earlier owner batch (Q-103, Q-105, Q-106, Q-108, Q-109). What's left in the review
batch (Q-119–Q-138, minus the two that need an owner decision) is substantial — 16 items,
each independently investigated with file:line evidence — so this handoff splits it into two
non-overlapping lists for two agents to run in parallel. See **Pickup prompt — Agent 1** and
**Pickup prompt — Agent 2** below.

## Current status

- Build/test: every PR this session (10 of them) went through the full gate — `tsc --noEmit`,
  `eslint`, full `vitest run` (404 files / ~3197 tests), green before merge.
- Device-verified: **no** — every fix this session was JS-only or server-side except Q-118
  (safe-area CSS class swap), which is explicitly marked NOT device-verified in
  `projectOverview.md`'s Known-Issues section (a Known-Issues row exists for it — do not
  duplicate). Nothing else this session touched native/safe-area/gesture paths.
- All work is merged to `main`. No open PR, no dirty working tree.

## What shipped (this session, in order)

| # | PR | What |
|---|---|---|
| Q-106 | #1124 | Home "Recommended Today" card's `lastSessionDay` memo now recomputes when `workout-data:all` populates its cache — was frozen on "Last: —" |
| Q-108 | #1123 | Body Battery chart's right-edge axis label derived from the real last-sample timestamp, not a hardcoded `"now"` |
| Q-109 | #1122 | Home's manual "Deload" choice now actually reduces prescribed load on `ai_dynamic` sessions (`deloadOverrideForGoal()` wired into `buildWorkoutExercises`) |
| Q-105 | #1125 | "Body temp elevated" explainer shows real deviation/threshold/baseline-nights numbers, via a new `TEMP_ALERT_THRESHOLD_C` constant sent over the wire (not imported client-side, to avoid pulling the dHRV inference chain into the bundle) |
| Q-103 | #1126 | Body Battery "How it moves" panel now reads `anchorSource` instead of unconditionally claiming Readiness |
| Q-73 | #1130 | Home hydration mismatch (React #418, 283 occurrences) — header date now uses `formatInTimeZone(new Date(), DEFAULT_TZ, …)` instead of ambient `toLocaleDateString`; swept 3 sibling sites |
| Q-117 | #1132 | Early-deload confirm and injury writes now invalidate `workout-data`/`workout-card:`/`ai-periodization-session:`; added an injury fingerprint to `reevaluationKey()` (4th param, same pattern as Q-113's illness flag); exposed `Injury.updatedAt` (5 call sites, all mechanical) |
| Q-118 | #1133 | 6 navless takeover screens (`active-activity-screen.tsx`, `test-active.tsx` ×2, `walk-active.tsx`, `walk-config.tsx`, `walk-summary.tsx`, `done-activity-screen.tsx`) swept from `pb-safe-action` to `pb-safe-action-lg` — **NOT device-verified** |
| Q-140 | #1135 | Removed the redundant "Interval walk" shortcut from `LogActivitySheet` — Guided Walk keeps its own entry point on the Cardio Hub |

Journal entries for each: `docs/overview/entries/2026-08-07-*.md` (one per item above, filename
matches the PR's branch name).

Parallel to this session, other agents landed (visible in `git log`, not this session's work,
mentioned so the next agent isn't surprised by them): the Cardio Hub entry card + 14 new home
score-card styles (#1128), Q-139 queued (ring-clock compression, #1129), Q-73's root-cause found
by the review itself, the day-detail screen behind the training calendar (#1136), workout-card
recovery-chip wrapping (#1134). **Expect `main` to keep moving** — every merge in this session
needed at least one re-fetch-and-merge cycle before it went in; two needed a second round when a
third PR landed mid-merge. This is normal, not a problem — see Gotchas below.

## Deliberately NOT done

- **Q-137 (Activity Score calibration)** — explicitly `⛔ needs an owner decision`, same shape as
  the already-existing Q-72 (Sleep Score). Measured with real numbers (91-day contributor
  analysis) but the fix requires the owner to choose between three re-weighting options. Do not
  build any of them without asking.
- **Q-138 (component-size hotspots)** — the entry's own text says "take opportunistically when
  already touching the file, not as a dedicated PR." Not assigned to either agent as a standalone
  item; if either agent is already deep in one of the six listed files for an unrelated fix, the
  extraction is fair game, but don't go looking for it.
- **Everything below Q-119–Q-138 in the backlog file** (Q-85, Q-116, Q-114, Q-112, Q-111, Q-107,
  Q-105-followup, Q-104, Q-102, the four `-followup` entries, Q-51 and everything after) — each is
  blocked on an owner decision, on-device diagnostics/capture, or needs its own planning session
  first (see the file itself for why, per item). Not re-triaged in this handoff; the backlog
  entries' own text already explains each block.

## Key decisions (with rationale)

- **The review batch (Q-119–Q-138) is split into two lists by rough file territory**, not by
  domain tag, specifically to minimize cross-agent git conflicts on shared files
  (`lib/cache-groups.ts`, `lib/data/postgres/adapter.ts`, `app/api/workout-data/route.ts`). See
  the pickup prompts for the exact split and why.
- **Q-124(c) and Q-134 both touch `updateSupplement` in `adapter.ts`** and the backlog itself
  says "do both in one touch" — kept both in Agent 1's list for that reason, not split across
  agents.
- **Neither agent is assigned Q-132 or Q-133 as a single PR** — both are explicitly "batch"
  entries covering many small independent sites (7+ and 4+ respectively). Whichever agent gets to
  them should consider splitting each into 2-3 smaller PRs rather than one giant diff, matching
  this session's per-fix PR granularity — but that's a judgment call for whoever picks it up, not
  a hard rule.

## Gotchas / what did NOT work

- **`main` moves fast under parallel sessions — budget for at least one re-merge per PR.** Every
  PR this session hit "CI green, then `git fetch origin main` shows a new commit" at least once;
  two hit it twice. The fix is always: `git merge origin/main --no-edit`, resolve conflicts
  (almost always `package.json` version + `packages/shared/src/changelog.ts` top entry +
  `projectOverview.md`'s Current Status header — re-bump the version number on top of whatever
  origin/main now has, don't just take your own number), re-run the full verification gate, push,
  re-check CI on the new head, re-confirm base currency, merge. Never force-push, never skip the
  re-verification after a merge.
- **`package.json`/`changelog.ts` version collisions are literal, not just adjacent-line
  conflicts** — twice this session, another PR claimed the exact same next version number
  (`1.269.2` was claimed by two different PRs independently). Always re-derive the next version
  from `origin/main`'s actual current number at merge time, not from what you planned when you
  started.
- **CI on a freshly-merged head sometimes reports `total_count: 0` for a few seconds** before the
  new run registers — this is normal propagation delay, not a stale-base signal (that specific
  tell only applies several minutes in). Give it a short wait and re-check rather than assuming
  something's wrong.
- **The local dev seed program is `phase_mode: 'manual'`**, not `ai_dynamic`. Several fixes this
  session (Q-109, Q-105) needed `ai_dynamic`-only code paths, and the workaround was: temporarily
  `UPDATE programs SET phase_mode = 'ai_dynamic' WHERE id = '451fc4e8-57aa-46de-8fa9-6afa67bd5d60'`
  (the seeded `Push Pull Legs` program), verify, then revert with `phase_mode = 'manual'`
  afterward. Always revert — don't leave the seed mutated for the next session.
- **The Morning Check-in sheet auto-opens on Home in this Playwright sandbox** and blocks clicks
  on the recommendation card underneath it. Close it first via its header `×` button before
  interacting with anything else on Home in a screenshot/verification script.
- **Logging in via Playwright needs `waitForURL` after the submit click, not a flat timeout** —
  `/sign-in` sometimes hasn't redirected yet when a fixed `waitForTimeout` fires, leaving the
  script stuck on the login page. Pattern used throughout this session:
  ```js
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(url => !url.pathname.includes('sign-in'), { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  if (page.url().includes('sign-in')) {
    await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  }
  ```

## Files to look at

- `docs/implementation-backlog.md` — the live queue. Q-119 through Q-138 are the items this
  handoff dispatches; read each one's full entry before starting (this doc summarizes, the
  backlog entry has the file:line evidence).
- `docs/reviews/2026-08-07-full-app-review.md` — the source review all of Q-117–Q-138 came from;
  read the relevant `§` section cited in each backlog entry for full context beyond the summary.
- `lib/cache-groups.ts` — touched by Q-117 (already done) and Q-126 (Agent 2); the established
  pattern (invalidate-before-refetch, `clearLegacyHomeSeeds()` after any `'workout-data'`
  prefix-drop) is documented inline and in `CLAUDE.md`'s Cache Invalidation section.
- `docs/overview/entries/2026-08-07-deload-injury-invalidation.md` — the most recent example of
  this session's PR-writeup format (root cause → fix → verification → what wasn't exercised); a
  good template for either agent's own journal entries.

## Open questions / blockers

- Q-137 needs an owner decision (three options laid out in the backlog entry).
- Q-105-followup, Q-91-followup, Q-95-followup, Q-97-followup, Q-93-followup, Q-109-followup are
  all standalone follow-ups split off earlier work, each independently ready or blocked — not
  assigned to either agent below, but available as a next batch after Q-119–Q-138 clears.
- Dependabot: 8 vulnerabilities open (4 high, 4 moderate) as of the last PR push. Below the
  CLAUDE.md threshold (≥5 high/critical, or any critical >1 week old) that would force it ahead of
  the queue — but close enough that whoever picks up the next batch after this one should check
  `docs/implementation-backlog.md`'s Dependabot section first.

---

## Pickup prompt — Agent 1 (platform / sync / security focus)

```
Continue working through the TrainingAI implementation backlog (docs/implementation-backlog.md)
on the nekodas-neko/TrainingAI repo, following the standing instructions in CLAUDE.md exactly —
one feature branch per item cut fresh from origin/main, full verification gate (tsc --noEmit,
eslint, vitest run) before every PR, the journal entry + projectOverview.md Current Status update
+ backlog-entry removal + version bump (package.json + packages/shared/src/changelog.ts) bundled
into the same PR as the code, re-confirm the base is still current immediately before every merge,
squash-merge via the GitHub MCP tools when CI is green (no confirmation needed for a standard
JS/server-only change per CLAUDE.md's merge-without-asking policy), then move to the next item.

Read in this order before starting: projectOverview.md, docs/domains/platform/README.md,
docs/handoff-2026-08-07-cross-full-app-review-backlog-dispatch.md (this file — for the gotchas
about main drifting fast and the version-collision pattern), then each backlog entry below in
docs/implementation-backlog.md for full file:line detail before touching code.

Work these items from docs/implementation-backlog.md, in this order, skipping nothing unless you
hit a genuine blocker (say so and move to the next one rather than guessing):

1. Q-128 — sessions_in_phase is reconciled at one read site, read unreconciled at two that matter.
   Call reconcileSessionsInPhase inside getSessionPeriodization (or at the top of workout-data and
   signals.ts's read paths), mirroring the existing reconcileUserStats pattern at achievements.ts:82.
2. Q-122 — three fire-and-forget HTTP calls the server makes to its own origin
   (complete-workout/route.ts:39 -> oura/hr-sync, workout-data/route.ts:503,527 -> prescribe).
   Extract oura/hr-sync's 39-line body into lib/ and call it in-band from both the route and
   complete-workout; same shape for prescribe.
3. Q-123 — offline write-path gaps: (a) pushMutations' complete_workout branch is missing the
   per-set HR attribution pass the web route has (a regression of the Q-11 Defect B fix — extract
   into one shared function, same shape as logExerciseFromPayload); (b)
   exercise-review-sheet.tsx's auto-detected-activity save has no getLocalStore/queueMutation at
   all, copy done-activity-screen.tsx's local+outbox shape; (c) the same file builds its date key
   from device-local getFullYear/getMonth/getDate instead of todayInTz(tz) — this is a PERSISTED
   DATA bug, not just display, fix it first even if you only get to one sub-item.
4. Q-129 — SECURITY: cross-user phase-set leak. POST /api/workout-templates writes
   body.program.phaseSetId into programs.phase_set_id with no ownership check; listProgramPhases
   reads program_phases with no user scope; deletePhaseSet's in-use probe is also unscoped and
   leaks another user's program name in the error message. The fix pattern already exists next
   door at phase-sets/[id]/route.ts:20-37 (validate against listPhaseSets(userId), 400 otherwise)
   — copy it. Also add the missing rowcount guard on saveProgram's UPDATE while you're in the file
   (currently fails closed by accident, not by design).
5. Q-124 — supplements is the one write domain with no pull-clobber guard: (a) CREATE_SUPPLEMENTS
   has no sync_status/deleted_at column so applyDelta can't gate on sync_status='synced' the way
   every other domain does — needs a new local SQLite migration (repo is at local v21, claim v22)
   plus a new Postgres migration if a matching server-side change is needed (next free Postgres
   migration number is 170 as of this writing — re-check docs/implementation-backlog.md's header
   note, it may have moved); (b) nutrition-content.tsx fetches the 'supplements' cache key with
   BOTH cachedFetchToday and cachedFetch (incompatible envelopes, same class as the historical
   weekly-stats crash) — pick one variant and convert every read site; (c) PATCH
   /api/supplements/[id] never bumps updated_at (schema.ts:693 has defaultNow() with no
   $onUpdate) so an edit through the web route never reaches getSyncDelta. Do (c) together with
   item 6 below (Q-134) since they touch the same updateSupplement function — the backlog
   explicitly calls this overlap out.
6. Q-134 — route hygiene: five admin image/media routes have no rate limit (compare against
   sibling admin routes that do); updateSupplement passes the raw request body straight into
   Drizzle .set() (SEC-6 shape, safe today only because its one caller happens to use .strict()) —
   build an explicit allowlisted set object the way updateInjury (adapter.ts:6145-6161) already
   does. Do this in the same PR as Q-124(c) since both touch updateSupplement.
7. Q-131 — sync push/pull field-parity gaps: mood_logs' pushMutations branch has zero validation
   (casts straight through where the web route parses a real MoodSchema with enums/caps) — every
   sibling domain got a shared schema under a prior SYNC-P3/P4 fix, mood was missed, build one the
   same way; food_items push drops barcode/region and uses different defaults than the web route
   despite FoodItemPushSchema already accepting both; the pull chain silently drops
   workout_sessions.session_id/intensity_mode/was_override and exercise_logs.exercise_deloaded
   even though both ends' schemas have the columns — add them to the pull mapping and applyDelta
   inserts.
8. Q-130 — date-handling hardening sweep (all latent, no live bug, but each failure mode has cost
   a release before): (a) four routes (mood, day-checkin, nutrition/food-logs, oura/hr-window)
   take a raw date param with no normalizeDateParam guard — oura/hr-window actually does
   dateParam.split('-').map(Number) on the raw value; (b) formatDateDisplay in
   packages/shared/src/date-utils.ts does exactly what the comment on the function directly below
   it (formatDayShort) says is forbidden — new Date(raw) then device-local toLocaleDateString;
   fix it and its three inline-duplicate call sites (stats-content.tsx:225,
   strength-trend-card.tsx:42-43, recommendation-card.tsx:33-34) to use the safe pattern; (c) seven
   files use a dash-only date regex instead of the required [-/] form (day-checkin, ai/health-insight,
   validation/activity-log.ts, validation/fitness-test.ts, sync/mutation-schema.ts, sync-health,
   admin/timing-baseline) — validators/chat.ts:15 and validation/body-metrics.ts:94 show the
   correct form, copy it; health-connect/ingest:19 has the mirror problem (slash-only); (d)
   sync/pull's since cursor is unvalidated, a malformed one throws inside getSyncDelta and returns
   a generic 500 — reject a non-finite since with a 400 naming the param; (e)
   workout/exercise-hr-trend/route.ts:31 uses the banned Date.now()-N*86400000 window anchor
   instead of local midnight.

For each item: read the full backlog entry first (more file:line detail than this summary),
implement, run the full verification gate, write the journal entry + docs updates, commit, push,
open the PR, subscribe to its activity, wait for CI, re-confirm base currency, merge, then move to
the next item in the list above. If you finish all 8, check docs/implementation-backlog.md fresh
(it may have new entries from other sessions) and pick up the next ready platform/sync/security
item you find, applying the same "skip if it needs an owner decision, device capture, or planning
session first" filter this whole backlog has been using all day.

Do NOT touch: Q-119, Q-120, Q-121, Q-125, Q-126, Q-127, Q-132, Q-133, Q-135, Q-136 — those are
assigned to a second agent working in parallel on the same repo. Touching the same files at the
same time will produce merge conflicts neither of you can predict. lib/cache-groups.ts in
particular is Agent 2's territory (Q-126) — if your own item needs a cache-groups.ts change beyond
what's listed above, note it in your PR description rather than expanding scope.

Do NOT touch: Q-137 (needs an owner decision), Q-138 (opportunistic only, not a dedicated PR),
Q-73/Q-117/Q-118/Q-140/Q-103/Q-105/Q-106/Q-108/Q-109 (already shipped this session), or anything
below Q-119 in the backlog file unless you've cleared this entire list and re-verified against a
fresh pull that nothing else has become ready.
```

## Pickup prompt — Agent 2 (app-shell / UI / cache-correctness focus)

```
Continue working through the TrainingAI implementation backlog (docs/implementation-backlog.md)
on the nekodas-neko/TrainingAI repo, following the standing instructions in CLAUDE.md exactly —
one feature branch per item cut fresh from origin/main, full verification gate (tsc --noEmit,
eslint, vitest run) before every PR, the journal entry + projectOverview.md Current Status update
+ backlog-entry removal + version bump (package.json + packages/shared/src/changelog.ts) bundled
into the same PR as the code, re-confirm the base is still current immediately before every merge,
squash-merge via the GitHub MCP tools when CI is green (no confirmation needed for a standard
JS/server-only change per CLAUDE.md's merge-without-asking policy), then move to the next item.

Read in this order before starting: projectOverview.md, docs/domains/app-shell/README.md,
docs/handoff-2026-08-07-cross-full-app-review-backlog-dispatch.md (this file — for the gotchas
about main drifting fast and the version-collision pattern), then each backlog entry below in
docs/implementation-backlog.md for full file:line detail before touching code.

Work these items from docs/implementation-backlog.md, in this order, skipping nothing unless you
hit a genuine blocker (say so and move to the next one rather than guessing):

1. Q-119 — light mode's brand-colour fix has never applied to anything. app/globals.css:55 sets
   --brand for light mode but never sets --color-brand (the one 495 sites actually consume), so it
   silently stays at the dark-mode default and light-theme brand-coloured text reads at ~2.2:1 on
   white. Fix: set --color-brand alongside --brand in the light :root, matching how every
   non-default [data-brand="..."] variant already does both. Second, related gap in the same area:
   no --brand-foreground token exists anywhere, so 42 sites hardcode text-white and 9 hardcode
   #000 on a bg-brand background — with some custom hues this makes button text nearly invisible.
   Add --brand-foreground per brand/scheme pair and convert both hardcoded groups to use it.
   Contrast ratios in the backlog entry were reasoned from OKLCH values, not measured with a real
   contrast tool — verify with one if available before calling this done.
2. Q-120 — weekly muscle volume splits one muscle into two rows because
   computeDefaultVolumeTargets normalises muscle names (normalizeMuscle folds core->abs,
   quadriceps->quads, etc.) but weekly-muscle-sets/route.ts and
   ai-periodization/weekly-volume/route.ts both key logged sets by the raw un-normalised label.
   Fires on stock seeded data. Fix once in getWeeklySetsByMuscleGroup and drop the ad-hoc
   LOWER()/.toLowerCase() calls from all three consumers.
3. Q-127 — chart.js reaches every cold start through a dynamic import that's statically defeated.
   health-content.tsx correctly wraps ActivityDetailSheet in dynamic(..., {ssr:false}), but a
   static import chain (health-sections.tsx -> activity-history-card.tsx ->
   activity-detail-sheet.tsx) pulls chart.js in anyway, and that sheet is itself internally
   inconsistent (dynamic-imports two charts, statically imports three siblings). Convert the
   static imports to dynamic(..., {ssr:false}) matching the file's own existing pattern, and make
   activity-history-card.tsx's own import of the sheet dynamic too so chart.js stays out of the
   Health tab chunk entirely (which tab-shell.tsx warms via requestIdleCallback on every app open).
4. Q-121 — the active workout screen re-renders up to twice a second for the entire session.
   active-workout-screen.tsx calls useElapsedSec twice at the top of a 762-line screen — two
   independent 1Hz setInterval-driven state hooks at the screen root instead of in a leaf, the
   exact pattern CLAUDE.md's render-discipline section bans by name. Concrete fix already spelled
   out in the backlog entry: sessionElapsedSec -> the existing <SessionClock startMs={...}/> leaf;
   exerciseElapsedSec -> a new sibling <ExerciseClock>; the rest-ring's own elapsed tracking -> a
   <RestRing restStartMs currentRestSec> leaf owning its own tick; readyElapsedSec ->
   <WarmupRampProgress>. Do NOT touch workout-screen.tsx:796's 1Hz interval — it's explicitly
   documented as safe (writes to a module singleton, never React state).
5. Q-126 — five cache-invalidation gaps, each a 1-3 line addition to lib/cache-groups.ts (your
   primary territory this batch — Agent 1 is explicitly told to stay out of this file):
   (a) invalidateActivityWrites() omits running-bests/run-type-stats/walk-segment-stats/
   cardio-trends, all of which read activity_logs — finishing a run leaves four stat caches stale
   for 6h; (b) confirming a flagged scale weigh-in has no cache-groups import in the file at all —
   copy the pair health-content.tsx:918-926 already uses for a manual metric log; (c)
   invalidateOuraSync()/invalidateBiometrics() both omit achievements:, so sleep-streak
   achievements never refresh — the exact gap two "feeds computeAchievements" comments already
   flag as fixed for body-metrics/nutrition, sleep was missed; (d) hr-recovery-profile and
   exercise-hr-trend:<name> are in NO group at all despite deriving from set_hr_stats, which a
   completed workout writes; (e) workout-screen.tsx seeds xpBeforeWorkout from a cache key written
   by exactly one screen but invalidated by five groups, so the done-screen's "+XP earned" badge
   can show the user's entire lifetime XP instead of the session's — either write the real
   /api/achievements response back into the key on the completion path, or skip the badge entirely
   when the seed is undefined rather than defaulting to 0.
6. Q-125 — eight GET routes set a long Cache-Control max-age, silently defeating the client-side
   cache-group invalidation one layer down (the WebView's own HTTP cache answers the "invalidated"
   refetch with the pre-write body). Worst two: exercise-library and activity-types both ship
   public, max-age=3600 on session-gated per-user data. Fix to the repo standard: private,
   max-age=60, stale-while-revalidate=120. There's an open counterpoint in the backlog entry
   (42 of ~48 aggregate GET routes ship no Cache-Control at all) — the entry explicitly says
   "decide whether to enforce the rule or narrow it, do not blanket-add headers" — use judgment,
   don't mechanically add headers to routes that don't have the problem this fix is for.
7. Q-132 — theme/contrast/colour-only-state batch. This is genuinely several independent fixes;
   consider splitting into 2-3 smaller PRs rather than one diff. Highest-value piece first:
   ScreenPaletteLayer paints a full-screen wallpaper from a mounted-gated useHeroColorScheme()
   read across 7 screens, causing a dark flash on every launch for light-theme users — the
   codebase already fixed this exact class of bug once (usePageGradient -> a plain CSS var, see
   detail-hero.tsx:46-47's own comment) but never carried the fix to this larger surface; promote
   the palettes to --screen-palette-* vars under :root/.dark the same way. Then: several dark-only
   white-alpha literals on light-reachable cards (list is in the backlog entry — strength-progress-card.tsx,
   oura-score-chip-row.tsx, achievements-grid.tsx, profile-tab.tsx, home-card-widget.tsx,
   level-sheet.tsx). Then: 3 colour-only-state sites that need a paired label (score-ring.tsx,
   alternatives-card.tsx, readiness-card.tsx) — health-score-detail.tsx:62 is the reference
   pattern (renders {bandLabel} under the number). Then: readiness-card.tsx hand-rolls a
   labelColor with scoreBand's three hexes despite already importing scoreBand — add a
   scoreBandByLabel() helper next to scoreBand and use it there and in contributor-chart.tsx's
   duplicated legend swatches (a legend that hardcodes colours separately from the thing that
   assigns them meaning can silently start lying). Also two divergent batteryColor functions for
   one concept (body-battery-card.tsx vs day-summary-card.tsx) — pick one.
8. Q-133 — accessibility/control-primitive batch. Also consider splitting into smaller PRs. 21
   hand-rolled disclosure toggles ship no aria-expanded (full site list is in the backlog entry) —
   components/ui/collapsible-section.tsx already does this correctly, convert the 21 sites to use
   it or match its shape. The global 44px tap-target floor in globals.css is both 4px under the
   48dp mandate AND a bare button element-selector (the exact "No global element-selector styling"
   anti-pattern CLAUDE.md names) — moving it needs care, it's currently what accidentally rescues
   two 36px steppers in walk-config.tsx, check that specific site doesn't regress before landing
   the change. Six emoji-as-chrome sites need converting to Lucide icons (list in backlog entry,
   content emoji like mood faces are deliberately excluded, don't touch those). Four
   window.confirm() calls in admin/debug consoles should use the existing ConfirmDialog primitive
   instead (7 existing uses to match). chat.tsx:499 paints an opaque bg-background on a screen
   root, hiding the dynamic-background layer underneath — should be bg-page.
9. Q-135 — performance batch: three memoised components defeated at their own call sites by inline
   arrow functions or .map() calls minting new array/object identities every render (AiChatOverlay
   from stats-content.tsx, ModalityPicker from cardio-content.tsx, MuscleHeatmap from
   sore-muscle-picker.tsx — the last is the costly one, it renders on every keystroke in the mood
   check-in sheet). overview-screen.tsx wraps the already-cache-seeded ReadinessCard in a
   dynamic(..., {loading: <Skeleton/>}) even though it's a 268-line props-only component with no
   fetch and no heavy dependency — the skeleton wins and defeats the instant-paint seed;
   static-import it instead. session-select-content.tsx's home workout fetch does a two-stage
   waterfall (awaits one Promise.all, then awaits a second fetch that doesn't depend on the
   first's results) — check whether there's a real bandwidth-priority reason for the sequencing
   before parallelizing it, and if there is, add the comment explaining why (the current comment
   only explains the batching, not the ordering). Four screens bare-fetch /api/hr-profile instead
   of using the shared cachedFetch key with HR_PROFILE_TTL that five other sites already use — fix
   all four to match.
10. Q-136 — dead code and never-shipped features. Read the backlog entry carefully, it explicitly
    warns "do not delete blindly, two of these are decisions not cleanups." Straightforward
    deletions: app/api/oura/debug (dead by design since the BLE re-key), admin/seed-exercise-gifs
    (superseded), admin/test-exercise-image (a scratchpad), admin/list-ai-models (one-off dev
    lookup), app/stats/stats-content.tsx (389 lines, zero importers — the route itself is a
    redirect). Decisions, not mechanical deletes: app/health/timeline/page.tsx is orphaned (zero
    inbound links since creation) — either wire it up or delete it, don't leave it as-is;
    app/api/sync/oura-timeseries is half a feature (client driver never written); app/api/oura/webhooks
    has no UI ever built (note: the SEC-H2 signing-key-echo finding on this route IS already fixed,
    don't re-raise it). The /sheet/[id]/* shims LOOK dead but are the only inbound path to /chat
    (which is the sole caller of the TTS route) and /overview — do not delete those without first
    deciding the fate of those two subtrees. Do NOT delete admin/backfill-derived-scores — it's
    explicitly a curl-only ops tool by design, not dead code.

For each item: read the full backlog entry first (more file:line detail than this summary),
implement, run the full verification gate, write the journal entry + docs updates, commit, push,
open the PR, subscribe to its activity, wait for CI, re-confirm base currency, merge, then move to
the next item in the list above. If you finish all 10, check docs/implementation-backlog.md fresh
(it may have new entries from other sessions) and pick up the next ready app-shell/UI/cache item
you find, applying the same "skip if it needs an owner decision, device capture, or planning
session first" filter this whole backlog has been using all day.

Do NOT touch: Q-122, Q-123, Q-124, Q-128, Q-129, Q-130, Q-131, Q-134 — those are assigned to a
second agent working in parallel on the same repo. lib/data/postgres/adapter.ts and
app/api/workout-data/route.ts in particular are Agent 1's territory — if your own item needs a
change in either file beyond what's listed above, note it in your PR description rather than
expanding scope.

Do NOT touch: Q-137 (needs an owner decision), Q-138 (opportunistic only, not a dedicated PR),
Q-73/Q-117/Q-118/Q-140/Q-103/Q-105/Q-106/Q-108/Q-109 (already shipped this session), or anything
below Q-119 in the backlog file unless you've cleared this entire list and re-verified against a
fresh pull that nothing else has become ready.
```
