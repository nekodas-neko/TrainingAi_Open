## B3 — prescription generation dedup + AI-usage chart fix (v1.208.6, 2026-07-23)

Data-driven follow-up to the B1/B2 AI-observability work: the owner ran the app and the new
**Admin → AI Usage** panel immediately surfaced the target. Over 7 days, `prescription` was the
**#1 token spender** (34,330 tokens = 56% of all AI tokens, 63% of cost) **and** the worst
**double-trip** (4 redundant · 2 distinct — i.e. 2 prescriptions each generated ~3× within 120s).

**Root cause.** Opening a workout fires `/prescribe` from two paths within ~1s — the client
(`workout-screen.tsx:445`, once per pending episode) **and** `workout-data`'s server-side
fire-and-forget self-fetch (`app/api/workout-data/route.ts:473/497`) — and each AI generation takes
~2.6s, so the same `(user, session, day)` prescription was generated 2–3× per open. All prescription
triggers funnel through one shared function, so the fix lives there and is caller-agnostic.

**Fix (deterministic — never changes prescription *content*, only whether an identical generation
re-runs):**
- New generic `createDedupCache` (`lib/ai-periodization/generation-dedup.ts`): **in-flight dedup**
  (a concurrent call for the same key awaits the running promise) + a **30s read-through cooldown**
  (a near-simultaneous repeat returns the just-made result). Only successful results are cached;
  failures stay immediately retryable; expired entries are pruned on write (bounded memory).
- `generatePrescriptionForSession` now wraps its real work (renamed `runPrescriptionGeneration`)
  through the cache, keyed by `user:session:day:excludeSessionId`. The `excludeSessionId` is part of
  the key because a completion-path result (which excludes the just-finished session from the
  recency gap) is **not** interchangeable with an open-path result — and the completion path
  (`complete-workout`) sets `skipCooldown` so it always produces the NEXT session's prescription,
  while still sharing in-flight dedup so two completions can't double-fire.
- Expected effect: the ~2 redundant open-triggers per session collapse to one generation, cutting a
  large share of prescription token spend (the dominant AI cost).

Also fixed the **empty "Calls over time" chart** in the AI Usage panel: the bar columns had no
definite height, so `height: X%` resolved against an indefinite parent → 0px (blank chart). Added
`h-full` to the column and switched the bar fill to the theme `--color-brand` token.

**Verification:** 7 new `generation-dedup` unit tests (in-flight collapse, cooldown reuse/expiry,
`skipCooldown` bypass, failures-not-cached, bounded prune) — all green. `tsc` clean (only the
pre-existing `onnxruntime-web` sandbox errors), lint 0 errors, full suite **1950 passed** (only the
pre-existing `wasm-parity` suite fails on the missing package — green on CI). `/admin` SSRs 200 and
`GET /api/admin/ai-usage` returns timeline + double-trips against local Postgres.

**NOT verified (flagged):** the real double-trip reduction is only observable against a live
`ai_dynamic` program on the S25 — the local seed is a `manual` program, so `/prescribe` returns early
(no Gemini path) and the dedup can't be exercised end-to-end here (the *logic* is unit-covered). And
the chart's pixel render needs a browser/device eyeball (the fix is a deterministic CSS height fix).
**Owner check:** after deploy, open/reopen a workout a few times, then Admin → AI Usage — the
`prescription` double-trip count should drop toward zero, and the "Calls over time" bars should render.
