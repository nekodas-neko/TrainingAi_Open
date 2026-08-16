# 2026-07-30 — Deactivation takes effect within a day, not a week

Branch: `fix/deactivation-claim-refresh` · v1.243.1

The second of the two adjacent auth fixes flagged alongside Q-1 Phase 3. Owner picked the option.

## The hole

`auth.config.ts`'s jwt callback sets `token.isActive` only when a `user` object is present — i.e. at
sign-in. `middleware.ts:18` is the **only** place the flag is enforced, and it trusted that claim. So
a user deactivated *after* signing in kept full access until their JWT was re-minted: `maxAge` is 7
days.

## Why the previously-recorded fix was impossible

Both ledgers said "cheap to fix — re-check per request against the now-co-located Postgres". That was
retracted while fixing the sibling `/mobile-signin` bug (v1.242.3): middleware runs on the **Edge
runtime** and imports `auth.config.ts`, which is Node-free by design — its own header reads
*"Edge-compatible config — no Node.js-only imports (no bcrypt, no pg)"*. A Postgres read cannot live
at the enforcement point.

## What shipped

The re-read lives in `auth.ts` (the Node config) instead, and middleware simply reads the claim it
refreshes. Logic is in `lib/auth/is-active-refresh.ts` rather than inline in the callback, so it is
testable.

**Throttled to once per 24h per user.** This is the load-bearing detail: NextAuth's jwt callback runs
on *every* `auth()` call, not only on its own token rotation, so an unthrottled read would be a DB
query per request. One read per user per day bounds staleness to a day at negligible cost.

**It is a claim refresh, not a re-authentication.** It rewrites a field inside the existing session,
so a continuously-active user is never signed out or re-prompted — the owner's explicit requirement.

Failure handling, both deliberate:
- **Lookup throws** → claim untouched, timestamp *not* advanced, next request retries. A DB blip must
  never sign everyone out.
- **User row missing** → not treated as evidence of deactivation; same retry behaviour. Locking
  someone out on a transient read would be worse than the staleness this fixes.

## Verified

8 unit tests: a deactivation is picked up once due; the lookup is *not* called before it is due (the
throttle); a never-checked token checks immediately; re-activation propagates too; a throwing lookup
leaves the claim and timestamp alone; a missing row does the same; no `userId` is a no-op; and a week
of hourly use asserts the claim stays true throughout while the lookup fires exactly 7 times — i.e.
daily re-checks, no interruption.

Runtime against `pnpm dev`: sign-in succeeds, a guarded route still renders, and
`/api/auth/session` still carries the claim — the jwt override does not break the auth flow.

`pnpm tsc --noEmit` clean · `pnpm lint` 0 errors (119 pre-existing warnings) · 2807 tests pass.

## Not verified

- **The 24h flip was not observed end-to-end.** Watching a real token cross the boundary needs either
  a day of wall-clock or a faked clock, and neither was run. The logic is unit-tested; the
  integration (middleware bouncing on a false claim) is pre-existing behaviour this did not touch.
- **Residual, accepted by the owner:** the window is bounded, not closed. Deactivation can take up to
  a day. Closing it fully means a Node-side re-check at a server choke point (root layout or a shared
  `requireActiveUser()`) at the cost of a DB query per server render — judged disproportionate here.
