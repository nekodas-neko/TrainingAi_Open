# Review sweep 51 — efficiency: logic over AI, faster paint, faster save, better feel

**Branch:** `review/sweep-51-efficiency` · docs-only · Review Agent.
**Write-up:** [`docs/reviews/2026-09-20-sweep-51-efficiency.md`](../../reviews/2026-09-20-sweep-51-efficiency.md).
**Filed:** RV-64 … RV-79 (16 entries, three batches).

The owner asked for a full efficiency review across four lenses: use logic where possible rather
than AI, speed up caching and saving, prioritise app efficiency, and use animation/UI to improve
look and feel. Four read-only lanes, with every load-bearing claim re-verified at source or against
production before filing.

## The AI question needed reframing before it could be answered

**49 LLM calls in 14 days** (`ai_call_log`, owner's rows) — about 3.5 a day across 12 sections, zero
failures. Cost is not the argument here, and a list ranked by spend would have been a list of things
not worth doing. What is left, ranked by what removing the model actually buys:

**RV-65** — the prescription prompt tells the model to pick numbers and, in the same paragraph, that
a deterministic layer will overwrite them: *"do NOT pre-emptively lower pct… a deterministic
autoregulation layer applies those cuts after you."* After the call, reps and sets are replaced
wholesale, accessory pct is recomputed from target RPE, sets are refit to the time budget, phase is
overridden on `stay`, and confidence is replaced by the engine score. The deload path already builds
a complete prescription with no model call. **But the entry does not ask for the model to be
removed** — only the reconciled prescription is stored, so nobody can say how far the model's
numbers sat from what the guards would have produced. Ship the raw-vs-final capture first; the two
possible answers point at different work. That is BF-110's lesson applied before rather than after.

**RV-66** — `calculateBaseline` computes calories, protein, fat, water and steps deterministically,
and the route then asks a model for its own versions. Probing the shipped clamp: against a computed
1,942 kcal the model may return anything in a **545 kcal band**, and whatever it returns is shown to
the user and written into their targets on Apply. That breaks one CLAUDE.md rule twice —
no LLM number may gate an action *or* be shown as fact. `recommendedCarbsG` is requested and then
discarded unconditionally.

An early framing of mine — "the prescription's 2.2s blocks every workout open" — was **wrong and is
not filed**: that path already has a dedup cache, a 30s cooldown, a once-per-episode guard, a rate
limit and a 1–7 day TTL.

## The biggest efficiency defect is not an AI one

**RV-64.** `/api/hr-profile` computes three numbers — two order statistics and a mean — by pulling
every heart-rate row in a 90-day window into JS and sorting the array. Measured in production:
**128,734 rows**. The same answer as a server-side aggregate is **one row in 54 ms**.

What makes it bite is where it is called. `LiveHrChart` fetches it in a mount-once effect and is
mounted only while resting, so it **remounts once per rest period** — roughly twenty full scans
during a 5×4 workout, on the same 10-connection pool as `log-exercise` and `complete-workout`, with
a 20/60s rate limit the chart can trip on itself. `cardio-week` (RV-73) then pulls the same window
twice more.

**RV-67** is the one a reader would never find: a comment at `health-content.tsx:338` states that
*"cachedFetch… honours its TTL, so re-firing a group on a tab revisit is a cache hit rather than a
request."* The TTL gate is opt-in (`if (freshWithinTtl)`), and counted across the app: **191 cached
read sites, 8 with the flag**. So Health re-fires 8–10 requests on every tab entry believing they
are free. The entry deliberately does not prescribe bulk-applying the flag — each key needs a
written invalidation proof first, and that proof *is* the work.

## Feel: mature layer, coverage gaps — and two corrections

Two things I reported mid-sweep were **wrong**. Reduced motion *is* handled globally
(`MotionConfig reducedMotion="user"`); my count missed the provider. And every bare `pb-safe` is
page-level scroll padding, which the rule permits — **no safe-area violation exists**.

The real gaps: the shared `Button` has `transition-all` and **zero `active:` states** while 45 files
hand-roll `active:scale`, so the most-tapped control in a touch-only app has no press feedback — and
Android WebView `hover:` can stick after a tap (RV-71). About ten progress bars animate `width`, a
layout property that reflows siblings, where `scaleX` composites; 26 more snap (RV-72). The health
hero's number counts up while its ring snaps (RV-74). Sheets open in 500 ms against the app's own
deliberately-tuned 180 ms tabs (RV-75). All four batch as `motion-polish` — batched on the device,
which is the scarce resource, not on CI.

## Clean, verified, do not re-sweep

Instant-paint seeding is complete but for one card. The fetch-once ratchet's "CAN BITE" group is
empty. Screen-level parallelism is already deliberate. `complete-workout` and `mood-checkin-sheet`
are the reference save paths and both hold up. No TTL divergence, no N+1 in the data layer, no new
dependency needed for anything proposed.

## Not established

Nothing device-verified — `getLocalStore()` is null off the APK, so every offline-first write path
was read rather than exercised, and RV-68 rests on source ordering plus the repo's own recorded
measurement of the identical shape. `claude_ro` is owner-scoped, so 128,734 rows and 49 AI calls are
both floors. No route was timed end-to-end. No token counts, so every AI cost statement is
call-count based. `app/api/coach` was outside the reviewed surface.
