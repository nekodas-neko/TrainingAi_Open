# Cached AI insights are served only when the data still matches them (Q-293)

**Branch:** `fix/insight-context-hash` · **Lane A** · no migration · user-visible

## Intent, established before writing anything

Q-293 found `ai_health_insights.context_hash` NULL on 109 of 117 rows and named three possible
intents. Migration 121 settles it: the column was added for **NUT-7** — a daily digest generated at
lunch reported lunch totals all evening — and `getAiHealthInsightWithHash`, plus the optional
`contextHash` parameter, sit on the *generic* repository interface. Every section was meant to write
it; one was wired.

## The entry's severity read was backwards

Q-293 said *"nothing is broken for the user — insights regenerate rather than being served stale."*
They do not regenerate. All four other read sites served the cache **unconditionally** for the whole
day or week, so an insight written before the ring syncs is the one the user reads afterwards.

`health-insight` already carried an in-code workaround for a single instance of this, which is the
strongest evidence it was a known-but-unfixed defect rather than a design choice — its zero-data
answer was *"Deliberately NOT cached: the cache is keyed by (user, section, date), so persisting
this would still be served after the ring syncs later the same day."*

## What shipped

One helper, `lib/ai/insight-cache.ts`, and all five surfaces through it: `ai/health-insight` (four
sections), `session-explain`, `weekly-digest`, `workout-sessions/[id]/recap`, and `daily-digest`
converted off its private copy. The context is the prompt each route already assembles, so the
comparison is exact rather than a proxy.

**A legacy NULL hash counts as a MISS.** It is precisely a row we cannot vouch for; the cost is one
regeneration per section per day, once.

**The hash-less `getAiHealthInsight` is deleted** from the repository interface and the adapter. The
bug class is now unreachable rather than fixed — there is no read that skips the check.

## Two costs, stated rather than buried

1. **The cache check moved after the deterministic reads** in every route, so a cache *hit* now pays
   for them. Cheap next to the model call it avoids, and the trade daily-digest already accepted.
2. **`session-explain` lost a fast path.** It served the narrative from the `sessionId` query param
   without calling `getNextSession` at all — so the Home card now pays for that call. That read
   structurally could not know whether the signals it describes still hold, on the one route whose
   entire subject is signals that move during the day. The param is still accepted and ignored, so
   an older client keeps working.

This is a plausible mechanism for **Q-291** (the AI surfaces contradicting each other on the same
day), but it is not confirmed as its cause and Q-291 stays open.

## Verification

Four route-level tests in `app/api/ai/health-insight/__tests__/stale-cache.test.ts`, driven end to
end because the defect was never in a helper — it was in *where* the cache check sat. **Both
mutations are caught**: ignoring the hash fails two cases (including the core one, where the key
matches but the readings changed), and treating a NULL hash as a hit fails the legacy-row case.

- `pnpm check:rules` — Ran 55 of 55. `tsc --noEmit` clean, `pnpm lint` 0 errors.
- Full suite: 3958 passed, 820 skipped, 2 pre-existing unrelated failures (missing `qrcode`).

## Not exercised

Nothing was seen on device, and `pnpm dev` could not be run (missing `@sentry/nextjs`). **No
production insight was observed regenerating** — the tests drive the mechanism, not the live ring
timing that motivates it. The added `getNextSession` cost on the Home card is reasoned, not measured.
