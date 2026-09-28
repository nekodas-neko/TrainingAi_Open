# RV-193 — the Google refresh token was being handed to page scripts

**Branch:** `lane-a/rv193-refresh-token-not-in-session` · **Lane A** · **auth — owner confirms
before merge.**

## What it was

`auth.config.ts`'s session callback copied `token.refreshToken` onto the session object. That object
is what `GET /api/auth/session` returns to page JavaScript. The token is long-lived, can write to
Google Calendar, and outlives sign-out. No client code read it — its only consumer is
`app/api/log-calendar-event`, which runs on the server. Verified against `main` before changing
anything: `auth.config.ts:51`, and the only reads are the route and the type declaration.

## The entry says "the change is one line". It is not

Deleting the line takes the token away from the **server** too, because `auth()` returns exactly
what that callback built. So the route needs its own read, and that read has a trap:

**Auth.js derives the decryption salt from the cookie NAME.** A wrong `secureCookie` derives a
different key, every valid token reads as invalid, the route answers a plain 401, and workout
completions stop reaching the calendar with nothing anywhere saying why.

That pairing was already solved twice in this repo — `lib/auth/bearer-session.ts` (Q-1a) and a
comment in `lib/observability/request-error.ts:106` warning that
`__Secure-authjs.session-token` contains `authjs.session-token` as a substring. A third hand-rolled
copy is how the three drift apart. So the `getToken` call moved into
**`lib/auth/session-token.ts`** — `sessionTokenFrom(headers)` plus a
`googleRefreshTokenFrom(headers)` on top — and `bearerSession` now calls it rather than keeping its
own.

## What changed

- `auth.config.ts` — the copy is gone, with a comment saying why the line must not come back.
- `types/next-auth.d.ts` — `refreshToken` off `Session`, still on `JWT`.
- `app/api/log-calendar-event/route.ts` — reads it from `req.headers`. `auth()` still establishes
  identity (it is where `isActive` is enforced); the refresh token still decides authorisation,
  because a signed-in user who never granted the calendar scope has none and has always been a 401.
- `lib/auth/bearer-session.ts` — one fewer copy of the `secureCookie`/salt pairing.

**The mobile bearer path loses the claim identically**, because `bearerSession` builds its session by
running that same callback. Deliberate, and stated here because it is invisible in the diff.

## Verification

- New `lib/auth/__tests__/rv193-refresh-token-not-in-session.test.ts` — **7 passed**. Both halves use
  a **really encrypted** token via `encode()`, not a mocked decode: the session built by the real
  `authConfig.callbacks.session` carries no claim, and the server reads the same token back out of a
  cookie. The second is what would catch the silent death above.
- `lib/__tests__/feedback-calendar-scale-routes.test.ts` and
  `app/api/__tests__/rv177-rate-limits.test.ts` **had to change, and that is the evidence**: both
  mocked `auth()` returning `{ refreshToken }`, which is precisely the shape being removed. The
  no-grant 401 test now moves the token knob instead of the session knob, and a **new** test covers
  the signed-out case separately, since the two conditions became independent.
- **Mutation pass: baseline survives, 4 killed, 1 equivalent control survives.** Killed: restoring
  the copy onto the session; `secureCookie: true` (the silent-death case — it fails by name);
  dropping the secret; accepting an empty-string claim. That last one **survived the first pass**
  and was reachable only through the helper's own contract rather than through the route, where
  `''` is falsy either way — pinned anyway, because a credential-shaped empty string reaching a
  caller that checked `!== null` is the kind of thing this file exists to prevent. Control:
  rewriting the guard as a ternary over a local.
- `tsc` 0 · `lint` 0 · `build` 0 · `check-test-typecheck` at baseline · Custom Rules **83 of 83**.

## Local run on `pnpm dev` (2026-09-27, second session)

The seeded account has no Google token, so the cookie was minted directly: `encode()` from
`next-auth/jwt` with the app's own `AUTH_SECRET` and the dev cookie name `authjs.session-token` as
the salt, carrying the seed user's id and a **fake** refresh token.

- **The new cookie read decrypts.** `POST /api/log-calendar-event` with that cookie reached Google
  and failed there with `invalid_grant` (the route's `500 Calendar write failed`, which is correct
  for a fake token). A wrong salt/`secureCookie` pairing would have answered 401 before any Google
  call. The same request with a cookie carrying no refresh token → **401**.
- **The token is out of the page-readable session.** `GET /api/auth/session` on the same cookie
  returned keys `user, expires, isActive`, with no trace of the token string.
- **Control on `origin/main`, same cookie:** keys `user, expires, refreshToken, isActive`, token
  string present. So the probe can see the leak, and this branch removes it.
- Not covered by this run: a real calendar write (needs the owner's real Google grant), and the
  production cookie name `__Secure-authjs.session-token` over https.

## Not exercised

- **No real Google sign-in and no real calendar write.** OAuth cannot be driven from this container.
  What is proven is that a token encrypted the way the app encrypts one is read back by the way the
  app now reads one; what is not proven is the production cookie name, which is
  `__Secure-authjs.session-token` over HTTPS and is selected by the same `secureCookie` expression
  the mobile token exchange already writes with.
- **Nothing on the device.** JS/server only, so it reaches the phone through a normal Railway
  deploy with no APK.
