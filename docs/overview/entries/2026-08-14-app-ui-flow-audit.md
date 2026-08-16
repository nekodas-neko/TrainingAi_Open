# 2026-08-14 — UI, flow and information-architecture review, plus caching (docs-only)

**Branch:** `claude/app-ui-flow-audit-140pzy` · **Type:** review, no code changed
**Deliverables:** [`docs/reviews/2026-08-14-app-ui-flow-ia-review.md`](../../reviews/2026-08-14-app-ui-flow-ia-review.md)
and its [prompt](../../reviews/2026-08-14-app-ui-flow-ia-review-prompt.md) · 13 backlog entries
(Q-232 … Q-244) · three `projectOverview.md` Known-Issues rows.

## What was asked

The owner asked for a review of "the ui and flow/location mainly — there is a lot of pages/settings
etc that are just placed randomly (i.e. admin tools, more screen, nutrition buttons)", then caching
and cache busting, then the standing lenses. They asked for the prompt to be written first and then
worked through; both are committed here.

## What was found

**The premise held, and it is narrower than it sounds.** The individual screens are mostly well
built. What is disorganised is the **container layer** — five bottom-nav tabs plus a "More" tab that
has absorbed thirteen unrelated kinds of thing. Nothing is missing; a lot of it is unfindable.

The three that carry the most weight:

- **More → Profile is one 845-line scroll** holding identity, gamification, goals, four device
  pairings, every setting, "Restore from cloud", "Export my data", feedback, the admin entry and
  sign-out (Q-232). The fix is composition, not logic — every section is already an extracted
  component — and it retires one of the six `check-component-size.js` hotspots as a side effect.
- **The Program Builder lives in More under a sub-tab also called "Workout"** (Q-235), one tab bar
  away from the actual Workout tab. That ambiguity already produced a shipped bug, Q-223.
- **Admin mixes user administration with developer diagnostics** and buries both at the bottom of
  that scroll (Q-234) — with the frequently-used half (BLE debug, cadence calibration, data capture)
  the deepest-buried thing in the app, four levels down.

Two dead surfaces fell out of the reachability grep rather than being looked for. **`/overview` is a
543-line screen with zero in-app entry points**, duplicating Home and carrying live cache reads that
make it look maintained (Q-236). And **Health's card ordering/hiding has live readers in six places
and no caller for either writer** (Q-238) — the same shape as Q-180: dead code with a passing test
suite reads as a working feature in every grep.

## Caching: the codified rules hold; two call sites the checks cannot see do not

This was worth measuring rather than assuming, and the healthy half is the more surprising result:
all 33 Custom Rules steps pass, there are **zero** `invalidateCache()` call sites outside
`lib/cache-groups.ts`, all 73 cache keys are reachable from an invalidation group, no key is fetched
as both `cachedFetch` and `cachedFetchToday`, every `body-metadata` read is guarded by
`isBodyMetadataFresh` on both the seed and the hit path, and the service worker's two-generation
retention makes deploy-time busting sound. The bug class that produced #1279 is genuinely gone.

The two real findings are both at call sites no mechanised check reaches:

- **Q-240** — `patchGoalsDebounced` (`components/profile/goals-section.tsx:177`) PATCHes
  `/api/user/goals` and invalidates nothing, while `patchProfile` in the *same file* calls
  `invalidateGoalRecommendations()` — a group that already contains `invalidateCache('user-goals')`.
  Change a goal, open Health, and it renders the old one for 30 minutes.
- **Q-241** — and the reason that staleness reads as confusing rather than obvious: goals are
  written to `localStorage` **and** the server, and Health reads the water goal, target weight and
  target body fat from the device copy only. On a second device or after a re-install the server has
  the goals and the screen shows defaults, with nothing to reconcile them.

## Traps worth knowing

- **`node_modules` was only partially installed at session start** (68 packages), so `pnpm
  check:rules` failed with `Cannot find module 'js-yaml'` — which reads exactly like a broken gate.
  `pnpm install --frozen-lockfile` first; the gate then ran 33 of 33 clean.
- **The clone is shallow (50 commits)**, so `git log --since=…` returns essentially every file and
  cannot be used to scope "what changed since the last review".
- **A substring grep of `lib/cache-groups.ts` under-reports coverage.** `friends-list`/`friends-feed`
  look uncovered until you notice `invalidateFriends()` invalidates the `friends-` *prefix*. Three
  of the four "missing" keys were false alarms for this reason.
- **`WaterLogSheet` already invalidates internally**, so the three divergent call-site callbacks are
  redundant rather than broken — the finding inverted from "stale data" to "over-invalidation"
  (Q-243) only after reading the sheet itself. Worth checking the component before writing up a call
  site.

## Not done, deliberately

No code was changed — this is a review session, per *Backlog-driven implementation*. Q-232 is
explicitly marked as needing a written plan before any of the five IA items are built; taken
one-at-a-time from their entries they would leave the app half-reorganised in two incompatible
directions.

**Nothing here was exercised on the S25.** Native SQLite/Capacitor paths, safe-area insets, Samsung
WebView rendering, real device pairing and drifted production data were all out of reach; every
finding is from source reading and static analysis.
