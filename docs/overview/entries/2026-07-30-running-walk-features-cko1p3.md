## 2026-07-30 — Merge PR #906, then a gap sweep against the already-shipped cardio redesign

### Part 1 — PR #906
Checked, verified all 6 checks green and `mergeable_state: clean`, squash-merged without a rebase
(`mergeable_state` initially came back `unknown` from a fresh `get`, resolved to `clean` on a
second fetch — GitHub hadn't finished computing it). This closed out the guided-walk uplift arc:
HR zones/live map/speed/cadence (#882/#884), recorded per-segment stats (#886), and the status-bar
phase countdown (#906) are all on `main`.

### Part 2 — the running/walk feature request
The owner asked for a set of running/walk improvements: a daily (not just weekly) zone view on the
home/cardio screen, relocating the "How much time do you have?" button into the run/walk section,
baseline stats and a program picker on the Running screen, a Strava/Garmin-quality active-run
screen, and a fix for the skip-run dead end — plus asked whether guided walk needs matching uplifts.

**Before touching code, a design-brief check changed the whole shape of the task.** The owner's
first answer to "how do you want to sequence this" was "go straight for the full redesign" — but
research surfaced that the full redesign already existed: `docs/superpowers/specs/2026-07-26-cardio-system-spec.md`
is a closed, fully-decided spec (D-1 through D-14, "Nothing open" in §7), and its phases 1–6 were
already mostly implemented between 2026-07-26 and 2026-07-30 (density-progression framework,
`running_baselines` anchors, push-sessions, the cardio hub, `RunHrZoneHero`, cadence via Polar PMD
#790, etc. — all independently confirmed in the live code, not just the docs). The backlog was
independently audited the same day and shrank the entire `[cardio]` remaining-work section to 3
deliberately-deferred items unrelated to any of this. So "go straight for the full redesign" would
have duplicated a large amount of already-shipped work — reported this back to the owner instead of
proceeding, who then asked to continue with whatever real gaps remained.

Re-auditing the owner's original 6 asks against current `main` (not the stale mental model from the
screenshots) found the redesign covers almost all of it already — steps already has a daily+weekly
split, the hub already has "How much time do you have?" in the intended spec location (D-9), and the
active-run screen already has a live HR-zone hero, live map, and a splits/elevation strip. Four real
gaps survived the audit and got fixed this session (see the Known Issues entry in `projectOverview.md`
for the full list: all-time bests card on `/running`, a Today/This week toggle on the zone-quota
card, a "Back to Cardio" button on the skip dead-end, and a leave-confirmation guard on `/activity`
mirroring the guided-walk/workout pattern).

**Not built:** D-14's "beat-your-last" optional walk distance goal — a closed decision that was
never actually wired into `walk-config.tsx`/`walk-active.tsx` (grepped for it, no match) — flagged
in Known Issues rather than built, since the owner never explicitly asked for it; it surfaced as a
side effect of a clarifying question about guided-walk progression.

### Testing
`tsc --noEmit`, `eslint` (targeted files), `check-reconcile.js`, `check-push-mutations.js` all
clean. Ran the local dev server against the seeded local Postgres: created a real running plan via
`POST /api/running-plan`, inserted a test `activity_logs` row with `bestEfforts`/`avgPaceSecPerKm`
to exercise the bests aggregation, verified `/api/cardio-week`'s new `dayQuota` field, and drove the
`/running` and `/cardio` screens with Playwright (session-cookie auth, S25-width viewport) —
confirmed the bests card renders correct values, the Today/This week toggle switches and shows
correctly-divided numbers, and skipping a run shows a working "Back to Cardio" button that lands on
`/cardio`. Test data cleaned up from the local DB afterward. Existing vitest suites for the touched
modules (`activity-store`, `cardio-trends`, `zone-quota`, `session-picker`) all still pass.

### Version bump
1.244.0 (minor — new cardio-screen features + a UX bug fix, no breaking changes).

### Not yet confirmed
The new `LeaveActivityDialog` guard (hardware back button + bottom-nav tab-away mid-run) is
sandbox-verified as wired correctly but **not** verified against a real Android back gesture —
same caveat every other hardware-back guard in this codebase carries. `TabSwipeNavigator`
(edge-swipe tab navigation) still doesn't guard either guided walk or the new run/activity case —
a pre-existing gap, left alone to avoid unrelated scope creep.

### Part 3 — follow-up: choose-your-run on skip, default session time, hub button cleanup
Same session, immediate follow-up after presenting Part 2's results. The owner redirected three
of the four Part 2 items further:

- **Skip → choose an alternative, not just leave.** Added a "Not feeling it? Pick something else"
  picker above the prescribed-run card: a ±10 min duration stepper plus a Recovery/Easy/Long/
  Tempo/Interval chip row. Picking either calls a new `POST /api/running-plan/override`, which
  re-prescribes today's run through the *same* recovery-gate pipeline as the framework's own pick
  (`prescribeOverride`, added to `lib/running/prescription.ts` — a user override never bypasses
  the interference/readiness/monotony/sleep safety checks). "Skip" still exists as the no-thanks
  fallback. Required extracting `assembleInputs`/`resolveSnapshot`/`resolvePushContext` out of
  `app/api/running-plan/route.ts` into `lib/running/assemble-plan-context.ts` so the new override
  route could reuse the exact same signal-assembly code instead of drifting a second copy.
- **Default session time moves into plan setup.** `PlanSetupSheet`'s "Default session length"
  chip row is no longer gated behind the "Fixed time" framework choice — every plan now saves a
  `timePerSessionMinutes`, which seeds the Running screen's stepper.
- **Hub's "How much time do you have?" button hidden once a plan exists** — `ModalityPicker` now
  conditionally renders it only when `!hasRunningPlan`; with a plan, the default time + per-session
  adjuster on `/running` cover the same job.

**A real bug surfaced by my own Playwright testing, not by the owner:** `GET /api/running-plan`
always recomputed the prescription fresh from the framework on every call — so reloading the page
right after overriding silently reverted the display back to the AI's original pick, defeating the
whole point of overriding. Root cause: the route computed `prescription` independently of the
persisted `prescribed_runs` row, only reusing the row for its `id`. Fixed by having GET check
whether today's existing row's rationale carries the override marker (`OVERRIDE_RATIONALE_PREFIX`,
a shared constant — no schema migration needed) and, if so, build the returned `prescription`
directly from the persisted row instead of recomputing. Caveat: `gateReasons` (never persisted)
come back empty on an overridden day — the gate already ran once during the override itself, and
its outcome (`gateAction`) is what persists, but the explanatory sentences are lost until the row
resets. A second, independent client-side race was also caught and fixed: a slow initial-load GET
could resolve *after* a faster override POST and clobber it back — fixed with a monotonic
request-sequence ref so only the most-recently-fired request's response is ever applied to state.

Verified via curl (override → GET → GET again, confirming the choice sticks across repeated
"reloads") and a full Playwright pass: create plan → confirm the default-length chips render
unconditionally → pick Interval → confirm the card updates → +10 the duration → confirm it stacks
correctly → reload `/running` → confirm Interval/duration still shows → Skip → confirm "Back to
Cardio" still works → visit `/cardio` → confirm the time-picker button is gone.

### Version bump (revised)
1.245.0 (minor — three more cardio-screen features, still no breaking changes).

### Part 4 — carousel + zone-gap recommendation, and a real HTTP-caching bug found doing it
The owner asked for the run-type picker to actually look/behave like the workout session-select
carousel (`app/workout-select/workout-select-content.tsx`) — a full swipeable card, dot
indicators, a "Recommended" badge — and for the recommendation to be driven by which run type
would do the most to close the week's biggest open HR-zone gap (their own example: interval work
fills Z4/5, so recommend it when Z4/5 is what's still open).

- **`lib/running/recommend-run-type.ts`** (new, 5 unit tests) — deterministic, no LLM involved:
  for each run type, sums the still-open remaining minutes (from the same `ZoneQuota` the
  Cardiovascular hub already computes) across the zones that type predominantly fills, and picks
  the highest-scoring type. Z1 is excluded from ever driving a recommendation (spec D-10 — it's
  passive daily-movement fill, not something to train toward). Returns `null` once every training
  zone is complete/not-required — no forced recommendation when there's nothing left to close.
- **`components/running/run-type-carousel.tsx`** replaces the flat pill-row picker — built on the
  existing `SwipeCarousel` primitive (`components/ui/`) rather than hand-rolling touch handling a
  second time (the workout carousel's own touch code is bespoke and not reusable). Mirrors the
  workout carousel's shape: one card at a time, dot indicators (the recommended type's dot stays
  visually distinct even when a different card is showing, exactly like "Recommended today" does
  on the workout side), and a "Recommended" badge + one-line reason (e.g. "20 min of Zone 4 still
  open this week") on whichever card matches. The duration stepper stays outside the swiped
  content, composing with whichever type is currently showing.
- The carousel seeds to today's **actual** prescription on load (not the recommendation) so the
  first paint matches the `PrescribedRunCard` below it without a flash of mismatch — the
  recommendation is a badge to swipe toward, not an auto-applied choice. Swiping/tapping a dot
  still calls the same `/api/running-plan/override` endpoint from Part 3, unchanged.

**A second real bug, found by the same kind of deterministic Playwright test as Part 3's** (this
one waiting on the actual network responses via `page.waitForResponse` rather than fixed
timeouts, after fixed-timeout runs gave an inconsistent read): reloading shortly after an override
could *still* show the pre-override prescription, even though Part 3's "trust the persisted
override row" GET fix was in place and the database row was provably correct (verified directly
via `psql` mid-repro). Root cause was one layer up from the app's own cache: `GET
/api/running-plan` carried `Cache-Control: private, max-age=60, stale-while-revalidate=120`, and
`lib/sqlite/cache.ts`'s `cachedFetchCore` calls plain `fetch(url)` with no `cache` override — so
the **browser's own HTTP cache**, not the app's `cachedFetchToday`/`invalidateRunningPlan()`
layer, could serve a stale response for up to 60s, invisible to and uninvalidated by the app's own
cache-group system entirely. Fixed: `GET /api/running-plan` now sends `Cache-Control: private,
no-store` (the app's own TTL+invalidation layer already provides real caching with correct
invalidation, so the extra HTTP-cache layer was redundant and actively wrong once the run-type
carousel made multiple state changes within seconds routine). The override POST route's header was
aligned too, though POST responses aren't browser-cached regardless.

Verified via a `page.waitForResponse`-driven Playwright script (deterministic, not timing-based):
pick Interval → confirm the override response and the rendered card agree → +10 duration →
confirm both agree again → reload and wait for that GET specifically → confirm it still returns
interval/40 instead of reverting to the original easy/30. All three stages matched after the fix
(they didn't before it, on the identical script).

### Version bump (Part 4)
1.246.0 (minor — carousel UX + recommendation logic; the cache-control fix is bundled as a bug
fix within the same feature, not a separate release).

### Not yet confirmed (Part 4)
Same device caveat as Parts 2–3: nothing here touches native code, so risk is low, but the S25 APK
path is unexercised. Also worth noting for a future session: the recommendation badge can lag a
beat behind first paint if the `cardio-week` zone-quota fetch resolves after the `running-plan`
fetch — cosmetic (the badge just appears a moment later), not a data-correctness issue, and not
chased further this session.
