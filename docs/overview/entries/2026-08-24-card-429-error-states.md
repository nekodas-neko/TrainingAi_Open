# Two Health cards stop vanishing on a failed fetch — and the cache layer that would have swallowed the fix (Q-499)

**Branch:** `fix/card-fetch-error-states` · **Lane B** · v1.356.0

## What was wrong

`hr-recovery-profile-card.tsx` and `strength-progress-card.tsx` both called `useCachedValue` with
no `onError`, then rendered a bare `return null` when their data was empty. `useCachedValue`
swallows a failed fetch unless the caller opts in, so a request that 429'd (the app's own rate
limiter, or any other server error) rendered identically to a genuinely empty result: the card
just disappeared. The 2026-08-18 review reproduced this for `strength-progress-card.tsx`
(`Estimated 1RM` went from 1 node to 0 under a forced 429) but the fix itself — wiring `onError` —
was left to the implementer.

## What shipped

Both cards now pass `onError` and render a compact "Couldn't load… — pull to refresh" state,
following `observed-hr-card.tsx`'s existing pattern. `CLAUDE.md`'s wording is corrected: `cachedFetch`
swallows `!res.ok` **only when the caller passes no `onError`**, not unconditionally as it previously
read.

## The fix that made the fix actually work

Verifying this against the real dev server, both cards kept vanishing under a forced 429 even with
`onError` wired — confirmed by instrumenting `cachedFetchCore` directly: `onError` fired at the
cache-layer level, but the component's own wrapper discarded it because its effect had already
cleaned up (`alive = false`).

That clean-up is React StrictMode's double effect-invoke, which Next.js runs by default in dev: the
first effect instance starts the fetch and is torn down almost immediately; its request stays in
flight and becomes the "owner" of `cachedFetchCore`'s per-key dedup. The second, real instance's own
call joins that owner as a **waiter** rather than firing a second request. On success, waiters are
notified — `cachedFetchCore` already relays `onData` to every joiner. On failure, they were not: only
the owning caller's `onError` ran, and that caller was the torn-down first instance. A production
build (no StrictMode double-invoke) doesn't hit this specific path, but the same race is reachable
there too whenever two different components read the same cache key around the same time — this
just happens to be the one shape dev mode reproduces on every single render.

Fixed in `lib/sqlite/cache.ts`: `pendingWaiters` now carries each waiter's own `onError` and whether
*that* waiter had its own cached value to fall back on, and a failure is relayed to every waiter
with nothing cached — the same "stale beats an error state" rule the owning caller already followed,
extended to joiners. Confirmed via `next.config.ts`'s `reactStrictMode` toggled off temporarily
during verification (reverted, not shipped) that this was the exact mechanism, then fixed the real
cause instead of routing around it.

## Verification

- Two new unit tests in `lib/sqlite/__tests__/cache-onerror.test.ts`: a failure relays to a joined
  waiter with no cache; a joined waiter that already had its own cached value does not get the error
  (stale beats error, per caller). Full file: 6/6 pass, run 5× with no flake.
- Ran every test file importing `lib/sqlite/cache.ts` (`cache-groups`, `cache-groups-legacy-seeds`,
  `q165-cache-seeded-reads`, `cache-fetch`, `cache-http-layer-bypass`) plus
  `use-cached-value-today-agreement` — 63 + 3 pass.
- Full unit suite (`vitest run --project unit`): 3922 passed, 0 failed, 733 skipped (DB-dependent,
  no `DATABASE_URL` in that run).
- New e2e spec `e2e/card-429-error-state.spec.ts` (adapted from the review's paste-ready
  reproduction, extended to both cards): forces each card's endpoint to 429 via route interception
  and asserts the error text appears. **Ran against the real dev server** (StrictMode on, the same
  conditions CI uses) — both pass, twice in a row.
- Rendered both error states live in the browser (screenshot) against a running `pnpm dev` +
  local Postgres, logged in as the seeded user, with the routes forced to 429.
- `pnpm tsc --noEmit` / `eslint` on all touched files — clean.
- `pnpm check:rules` — Ran 55 of 55.

## Not exercised

Device/APK and offline — `cachedFetch` cannot revalidate at all offline, so this class doesn't apply
there the same way. The other ~10-18 candidate cards from the 2026-08-18 sweep remain an
unenumerated worklist (see the backlog entry's `Keep:` line); several are likely legitimate empty
states and need per-file judgement, not a bulk conversion.
