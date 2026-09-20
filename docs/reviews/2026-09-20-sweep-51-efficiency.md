# Review sweep 51 — efficiency: logic over AI, faster paint, faster save, better feel

**Date:** 2026-09-20 · **Scope:** whole app, four lenses the owner asked for — use logic not AI,
speed up caching/saving, prioritise efficiency, use animation/UI to improve feel.
**Method:** four read-only lanes reporting into this session, **every load-bearing claim
re-verified at source or against production by the coordinator before filing.**

## The finding that reframes the AI question

**The app made 49 LLM calls in 14 days** (`claude_ro.ai_call_log`, owner's rows) — about 3.5 a day,
across 12 sections, zero failures. **So "use logic not AI" cannot be argued on cost here.** It has
to be argued on latency, offline capability, testability and correctness, and only where those
actually bite. Ranking the AI work by spend would have produced a list of things not worth doing.

Ranked by what it *does* buy, the picture is much better than the raw prompt suggests:

- **The prescription path has already been engineered hard.** A dedup cache, a 30s read-through
  cooldown, a once-per-episode client guard, a rate limit and a 1–7 day stored TTL. An early
  reading of mine — "2.2s blocks every workout open" — was **wrong**, and is not filed.
- **Every prose route already computes its numbers deterministically before prompting**, imports
  `PROSE_GUARDS`, and discards the model's self-reported confidence in favour of the engine score.
- **`nutrition/scan` divides per serving in code** rather than asking the model, and bounds the
  result. That is the correct pattern and the repo already knows it.

What is left is two real cases and a measurement gap.

### The prescription asks a model for numbers it then overwrites (RV-65)

`prompt.ts:124` tells the model its numeric job and, in the same breath, tells it the job does not
matter: *"Pick a neutral pct inside the phase zone… do NOT pre-emptively lower pct for fatigue, RPE,
soreness or recovery signals — **a deterministic autoregulation layer applies those cuts after
you**."* After the call, in `generate-prescription.ts`: `ex.reps = a.reps` and `ex.sets = a.sets`
replace the model's reps and sets outright (`:390-391`); accessory pct is discarded and recomputed
from target RPE (`:396`); sets are then replaced again by the time-budget fitter (`:525`); phase is
overridden whenever `phase_action === 'stay'`; and `confidence: signals.confidence` (`:590`)
substitutes the deterministic engine score. The whole-session deload path (`:59`) builds a complete
prescription **with no model call at all**.

The model's surviving numeric contribution is compound pct inside a clamped band, plus
`phase_action` and prose. **Whether that is worth a 2.2s call cannot currently be answered by
anyone**: `session_periodization` stores only the reconciled prescription, never the raw model
output, so there is no way to measure how far the model's numbers sat from what the guards would
have produced anyway. **That measurement is the work to do first** — same shape as BF-110, where
shipping the diagnostic before the fix is what stopped two different files being guessed at.

### A model invents nutrition numbers next to a function that already computes them (RV-66)

`app/api/nutrition-goals/recommend/route.ts:266` calls `calculateBaseline(...)`, which produces
calories, protein, fat, water and steps from Katch-McArdle/Mifflin, measured RMR, goal offsets and
lean-mass protein dosing. The route then hands that baseline to the model and asks it to return its
*own* `recommendedCalories/ProteinG/CarbsG/FatG/WaterMl/StepsGoal`. `clampRecommendation` is a
safety band, not a derivation — probed against the shipped module, the model may return anything in
a **545 kcal band (1,785–2,330)** around a computed 1,942, and whatever it picks is what the sheet
displays and what `goal-recommendation-sheet.tsx:135-138` writes into the user's targets on Apply.
`recommendedCarbsG` is requested and then discarded unconditionally.

This is both halves of a CLAUDE.md rule at once: *no LLM self-reported number may gate an automatic
action **or be shown to the user as fact***.

## The single biggest efficiency defect in the app (RV-64)

`/api/hr-profile` computes three numbers — a high order statistic, a low one, and a mean — by
**pulling every heart-rate row in a 90-day window into JS and sorting the whole array**
(`observed-hr.ts:77`, `const desc = [...plausible].sort(...)`), because `getHrForWindow`
(`oura.ts:801`) is an unaggregated `SELECT timestamp, bpm, source … ORDER BY timestamp`.

**Measured in production today: 128,734 rows in that window.** The same answer as a server-side
aggregate: **54 ms, one row** (`max`, `min`, `avg`, `count`).

What makes it bite rather than merely offend: `LiveHrChart` fetches `hr-profile` in a
mount-once effect (`live-hr-chart.tsx:46`) and is mounted **only while resting** —
`active-workout-screen.tsx:520`, `{workoutPhase === "rest" && !allSetsLogged && <LiveHrChart/>}`.
It therefore remounts once per rest period, so a 5-exercise × 4-set workout triggers on the order of
twenty full 128k-row scans **during the workout**, on the same 10-connection pool as
`log-exercise` and `complete-workout`. The route's own 20/60s rate limit means a dense rest cadence
can make the chart 429 itself. `cardio-week` compounds it by calling `resolveHrProfile` and then
issuing two more `getHrForWindow` pulls whose windows are subsets of the one just materialised
(RV-73).

## The cheapest fix in the sweep, and the most expensive habit (RV-80…RV-83)

The runtime lane reported last and found the best ratio in the review. `computeMovedHours`
(`hourly-movement.ts:47`) constructs a `new Intl.DateTimeFormat(...)` **inside** its per-row loop,
with loop-invariant options. Measured twice independently — the coordinator reproduced it on a real
day's volume at **228.8 ms → 21.9 ms (10.4×)** for 2,831 rows; the lane measured 11.6–17.4× across
400/2,170/5,606. Production HR volume per local day over the last ten days peaks at **5,606**, and
the path is warmed on **every app launch** at a 5-minute TTL. It is a two-line change with no
behaviour difference.

What makes it a finding rather than a nit is the contrast the lane found while checking it:
`formatInTimeZone` is called in loops at 18 other sites and benchmarks at ~11 µs a call, because
`date-fns-tz` caches its formatter internally. **Those 18 are not worth touching.** This one is ~7×
worse than the repo's own idiom purely because a constructor was not hoisted.

Alongside it: the program editor renders the whole 156-row catalogue as a `<datalist>` **once per
exercise row** — 3,900 `<option>` elements at production scale against 156 — and rebuilds all of
them on every keystroke, because editor state is lifted to the parent and there is no memo boundary
(RV-81). Two routes fetch the active program twice in one request, each wasting 5 of ~20 statements
(RV-82). And `/api/readiness-score` does three sequential writes on a GET, usually two to the same
row (RV-83).

## A measured finding deliberately NOT filed

`/api/sync/pull` issues **26 statements every 5 minutes even when the delta is empty** — ~312
queries/hour per active device to usually return nothing — and a watermark column would collapse it
to ~2. It is not in the queue, on the lane's own recommendation and the coordinator's agreement:
every table it touches is tiny in production (`set_logs` 1,351, `food_logs` 679, `workout_sessions`
134), 26 indexed queries at that size are genuinely cheap, and a watermark is **a new write-path
invariant every mutation must maintain**. That is a web-scale fix for a single-user app, and the
cost of getting it wrong is a sync bug.

The same judgement applies to the **missing `(user_id, updated_at)` indexes** on ~16 of 21
sync-delta tables. The repo already has the counter-precedent recorded: `docs/module-map.md:166`
notes `oura_heartrate_user_updated` was **dropped in migration 249** after measuring **21 MB at
`idx_scan` 0**. Adding eight more of that shape would repeat it. Revisit only if `food_logs` reaches
tens of thousands.

## A wrong comment is licensing ~10 needless round-trips per tab entry (RV-67)

`app/health/health-content.tsx:338`: *"cachedFetch dedups in flight and **honours its TTL**, so
re-firing a group on a tab revisit is a cache hit rather than a request."* It does not. The TTL gate
in `cachedFetchCore` is `if (freshWithinTtl)` (`lib/sqlite/cache.ts:294`) — **opt-in**. Without the
flag the function paints the cached value and then always falls through to the network. Counted:
**191 cached read sites, 8 with `freshWithinTtl`** — so 183 of 191 are network-unconditional, and
Health re-fires 8–10 requests on every tab entry believing they are cache hits.

This is the Q-262 rule read in the direction nobody wrote down: the TTL constants govern how long a
*seed* survives, not how often the app touches the network.

## Feel: the motion layer is mature, the gaps are coverage

Two things I reported early were **wrong and are corrected here**. Reduced motion *is* handled —
`MotionConfig reducedMotion="user"` at `app/layout.tsx:153` covers every Framer Motion component,
with CSS blocks behind it; my count of "6 files" missed the global provider. And every bare
`pb-safe` is page-level trailing scroll padding, which the rule permits — **no safe-area violation
exists**. The repo already has View Transitions with M3 easings, animation pausing when backgrounded
and in idle tab panels, and a properly direction-locked swipe primitive.

The real gaps:

- **The shared `Button` has `transition-all` and zero `active:` states** (`button.tsx:7`), while
  **45 files hand-roll `active:scale`**. On a touch-only product `hover:` never fires — and on
  Android WebView it can *stick* after a tap. The most-tapped control in the app is the one without
  press feedback (RV-71).
- **~10 progress bars animate `width`**, a layout property that forces layout+paint every frame and
  reflows siblings; 26 more snap with no transition at all. A `scaleX` primitive composites and
  covers both (RV-72).
- The health hero's **score ring snaps while its number counts up** — an inconsistency inside one
  component (RV-74). Sheets open in **500ms** against the app's own deliberately-tuned 180ms tab and
  200ms route transitions (RV-75).

## Clean — verified, do not re-sweep

Instant-paint seeding is essentially complete (one gap, RV-78). Seeds are in effects, never
`useState` initializers. The fetch-once ratchet's "CAN BITE" group is **empty**. Parallelism on the
main screens is already deliberate (`Promise.all`, `runWithConcurrency`). `complete-workout` is the
reference save path and holds up — optimistic stamping, local write, fire-and-forget POST with
outbox fallback, in-flight guard. `mood-checkin-sheet` is the correct save shape. No TTL divergence.
No N+1 in the data layer — a brace-tracking scan of every awaited DB call inside a loop across `lib/data`, `lib/` and `app/api` found **no read-path N+1**; every hit is a batched `inArray`, a chunked bulk insert, a one-off admin repair, or the sync-push loop that is serial on purpose. **The `users` SELECT on every authenticated request is intentional** — it looks like a broken 24-hour throttle, and `lib/auth/__tests__/is-active-refresh.test.ts:111` asserts the behaviour by name as load-bearing for PS-24's deactivation guarantee. **Do not "fix" it.** Its doc comment at `is-active-refresh.ts:45-47` still justifies a throttle that never engages, which is how a reader would come to the wrong conclusion. Bundle is healthy: shared First Load JS **193 kB**, tab routes 453 kB, chart.js absent from both shared chunks, admin code behind its own routes. Production **does** gzip (dev's missing `content-encoding` is a `next dev` artefact). Every migration 267–277 query pattern is indexed. No new dependency needed
for anything proposed here.

## Not established

- **Nothing device-verified.** `getLocalStore()` is null off the APK, so every offline-first write
  path was read, not exercised; no Samsung WebView, no real safe-area, no native SQLite contention.
  RV-68's claim rests on source ordering plus the repo's own recorded measurement of the identical
  shape, not on a measurement taken here.
- **`claude_ro` is the owner's rows only** — 128,734 is the owner's heart-rate volume, and 49 calls
  is the owner's AI usage. Both are floors for the system.
- **No route was timed end-to-end.** `/api/hr-profile` could not be authenticated against in
  production, so its wall time is inferred from the row count and the aggregate's 54 ms, not
  measured on the route.
- **The `freshWithinTtl` candidates in RV-67 have not had their writer sets audited** — that proof
  is required before any of them ships, and is the actual work.
- **No token counts**, so every AI cost statement is call-count and latency based, not dollars.
- **`app/api/coach`** was outside the reviewed surface.
