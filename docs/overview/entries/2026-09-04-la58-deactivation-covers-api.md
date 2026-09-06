# 2026-09-04 — deactivation now covers API routes (LA-58)

**Branch:** `fix/la58-deactivation-covers-api` · **Lane:** A · **Domain:** platform

Owner chose option (1) of the three the entry offered: middleware covers `/api`, answering 403.

## What changed

`middleware.ts`'s matcher had `api` as its **first** exclusion, so the deactivation branch ran on
pages and on none of the 219 route files. It now excludes `api/auth` only, and the handler answers
**403 JSON** for a session whose `isActive === false` on any `/api` path.

Everything else about `/api` is left to the routes. A session-less request falls straight through, so
each route still answers its own 401 — and signature-authenticated ingest and webhook routes, which
never carry a session, are untouched. A redirect was rejected on purpose: a 307 to `/pending` hands
an API caller HTML, which no client reads as an auth failure.

## The way this could have gone badly

`/api/auth/*` stays outside the gate deliberately. NextAuth's handler, the mobile PKCE exchange and
registration are how a session *comes to exist*, so gating them on having one is circular — it would
lock sign-in out of the app, including on a fresh APK install where there is no session by definition.

That is the failure a later "tidy the exclusion" would reach for, so it is pinned rather than
commented. `deactivation-covers-api.test.ts` evaluates the **real matcher string** (read from source,
since `middleware.ts` imports next-auth and will not resolve under vitest) against concrete paths, in
both directions. Mutation-checked, one test each:

| mutation | fails |
|---|---|
| restore `api` as the exclusion (the original bug) | "reaches API routes" |
| widen the exclusion to swallow `/api/auth` (the lockout) | "does NOT reach the routes that create a session" |
| swap the 403 for a redirect | "answers with a 403 rather than redirecting" |

A test that restated the intent in its own regex would pass while the shipped matcher did something
else, which is why it runs the shipped string.

## ⚠ The window is ≤24 h, not instant

`ISACTIVE_RECHECK_MS` is a day (`lib/auth/is-active-refresh.ts`), so the claim middleware reads
refreshes at most once per day. **API access now closes on the same schedule pages already had** —
which is the whole point, since the defect was that the two disagreed. It is inherited, not
introduced.

Immediate revocation is a different change: it needs the claim re-read per request, with the cost
that implies. "Fixed" here does not mean "bites immediately", and the entry says so.

## Verified, and not

Proven at runtime on `pnpm dev` — every path class **except** the one the fix exists for:

| path | result |
|---|---|
| `/api/readiness-score`, no session | **401** from the route, no redirect |
| `/api/auth/session` | 200 |
| `/api/auth/providers` | 200 |
| `/health/day`, no session | 307 → `/sign-in` |
| `/sign-in` | 200 |

**Not verified: a genuinely deactivated session receiving the 403.** The sandbox cannot mint a
session. That branch is four lines, pinned by test, and the entry keeps a `Keep:` saying exactly what
closes it — deactivate an account, let the claim refresh (or sign out and in), and confirm an `/api`
call answers 403 while `/pending` still loads.

## Gates

`tsc --noEmit` clean · `pnpm check:rules` 68 of 68 · full suite 758 passed | 5 skipped (763 files),
6449 tests passed.
