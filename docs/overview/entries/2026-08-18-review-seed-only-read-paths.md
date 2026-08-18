# 2026-08-18 — Review: case (b), seed-only read paths

**Agent:** Review 📖 · **Branch:** `claude/review-seed-only-reads` · **Docs-only.**
**Filed:** nothing · **Review:** [`docs/reviews/2026-08-18-seed-only-read-paths.md`](../../reviews/2026-08-18-seed-only-read-paths.md)

## Why

Sweep 21 audited case (a) of Q-262's staleness test and named case (b) as the next sweep and the
likelier source of a real report: a seed-only read path never revalidates at all, so a missed
invalidation is permanent staleness rather than a flash.

## The mechanical test does not work

Differencing `readCacheSync` keys against `cachedFetch` keys (51 vs 66) yields five candidates:
`achievements:<userId>`, `ai-health-insight:<section>:<date>`, `mood:<date>`, and two
`workout-card:*`. **All five revalidate. None is seed-only.**

Revalidation happens three ways and `cachedFetch` is only one:

1. `cachedFetch` / `cachedFetchToday`
2. a raw `fetch(...)` then `setCached(...)` — `ai-insight-card.tsx`, `workout-screen.tsx`
3. a **local-store read** then `setCached(...)` — `session-select-content.tsx`'s `mood:` path

The third matters most: for an offline-first domain the local store *is* the source of truth, so
"revalidate" correctly means reading SQLite, not the network. A test that looks for a network call
marks the app's most authoritative paths as stale.

So the test for seed-only has to be "no write-back to the key from any source after the seed", which
is not greppable in one pass. Five candidates, read individually.

## Second Q-comment false alarm this run

`workout-screen.tsx:272` (Q-126 — lifetime XP reported as one session's gain) is the **fix's
rationale**, not a live defect, exactly like `session-select-content.tsx:896` (Q-117) last sweep. In
this codebase a comment naming a Q number is usually why the code is shaped that way. Worth knowing
before grepping `never invalidated` or a Q number and reaching for the alarm.

## Result

Both halves of Q-262's test are now audited and both are clean. The most repeated bug class in this
project has no live instance that either half of the documented test can find.

## Not verified

Static audit and source reading; not on the APK or against production. A stale-value bug arising some
other way — a write that updates the DB without touching the local store — is outside what this test
catches and was not looked for.
