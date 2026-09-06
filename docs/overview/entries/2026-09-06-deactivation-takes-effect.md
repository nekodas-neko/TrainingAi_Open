# Deactivation takes effect on the next request (PS-24)

**Branch:** `fix/ps24-inactive-session-refused` · **Lane:** A · **Domain:** platform
**Version:** 1.436.11

LA-58 (#884) put a 403 gate in the middleware so a deactivated account could not reach the API. The
checkpoint then found the gate reads a claim that never moves: `middleware.ts` builds its own
NextAuth instance from the Edge-only `auth.config.ts`, whose jwt callback has no refresh, so it
gates on whatever was stamped at sign-in — and re-signs it with a fresh 7-day expiry on every
request. The gate worked. The value did not.

## The fix is free, and that is the argument for its shape

`isActiveCheckedAt` lives only in the token, the token never persists, so `refreshIsActiveClaim`'s
once-a-day throttle never engages: **the users row is already re-read on every authenticated
request**, and the true value has been sitting in `session.isActive` with nothing consulting it.
`auth()` now consults it and returns `null` when the row says inactive.

That inverts the checkpoint's third finding. "Every authenticated request performs the once-per-day
read" was filed as a cost; it is now the mechanism, and making the stamp persist would restore
`ISACTIVE_RECHECK_MS` of staleness and quietly undo this. Pinned by a test that fails if the read
stops firing per request.

## Why `null` and not a session with the id removed

Stripping `user.id` closes the 81 routes that guard on `session?.user?.id` and leaves the other 132
reading `undefined` into a query — unscoped or malformed, which is a worse failure than the
staleness being fixed, and the exact class three PRs this week were spent removing. `null` is the
not-signed-in state every caller already handles, so this adds no new state to the app.

## Measured, both directions, on a real session

Signed in with credentials against local Postgres and kept the cookie:

| step | `GET /api/friends` | `GET /` |
|---|---|---|
| active (control) | `200` | app shell |
| `is_active=false`, **same cookie** | `401` ×3 | redirect to `/sign-in` |
| `is_active=true`, **same cookie** | `200` | — |

The response headers on that middle row also confirm the mechanism the entry describes:
`set-cookie: authjs.session-token=…; Expires: Sun, 13 Sep 2026`, the Edge middleware re-signing the
stale claim with a fresh week.

A 401 rather than 403 sends the caller to re-authenticate, which **terminates** rather than loops:
the `signIn` callback returns `/pending` for an inactive account and mints no session.

## A sub-claim of the entry is refuted

*"Same mechanism: an `isAdmin` revocation never reaches a live session."* False for every Node
consumer. `UPDATE users SET is_admin=true` and re-reading `/api/auth/session` on the same cookie
returned `isAdmin: true` with no re-sign-in — the same per-request refresh updates that claim too.
It is stale only in the Edge middleware, which never reads it. Corrected in the entry rather than
left to be inherited.

## Checked rather than assumed

`handlers` is deliberately not wrapped, so `/api/auth/session` still describes a deactivated
account. That would matter if the client believed it — this app has **zero** `useSession` and
`SessionProvider` call sites, so nothing consumes that endpoint; the shell takes its session as
props from a server component that redirects first.

## What is still owed

The middleware gates on a claim it cannot verify. PS-24 stays queued with both routes to closing it
written out: the **Node.js middleware runtime**, which is genuinely available in the pinned Next
15.5.22 (`loadNodeMiddleware` is gated on the functions-config manifest, not an `experimental` flag)
and would keep LA-58's 403 at a single authoritative enforcement point — at the cost of moving every
request in the app onto Node middleware and voiding `auth.config.ts`'s "no bcrypt, no pg" contract;
or accepting `auth()` as the authoritative point, which is where this PR leaves it.

That is not a queue-pass decision, which is why the entry records the options instead of taking one.

## Verification

- `tsc --noEmit` clean · **762 passed | 5 skipped (767 files), 6477 tests** · `pnpm check:rules`
  68 of 68
- New `lib/auth/__tests__/inactive-session-is-refused.test.ts` — 5 cases including fail-open on an
  absent claim, since `refreshIsActiveClaim` swallows a lookup failure so a database blip cannot
  sign everyone out
- Mutation-verified: removing the one-line refusal fails exactly the two tests that assert it
- The live before/after above, on `pnpm dev` against local Postgres

**Not exercised:** the APK. Same routes, but a deactivated account hitting the Custom Tab sign-in
flow has not been walked through on hardware — the entry carries `Verify: device` for it. No
production data was read; the probe user was created and deleted locally.
