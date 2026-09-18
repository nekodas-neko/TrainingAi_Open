# 2026-09-18 — Q-1a (server half): a session resolved from `Authorization: Bearer`

**Branch:** `lane-a/q1a-bearer-session-engine` · **Lane A** · one PR · no migration · unversioned ·
**nothing user-visible changes**

Q-1a's scope is "the bearer-token client + an `apiUrl()` indirection". This ships the **server half
only**, which is the lane rule for a both-lanes entry (engine first) and, as it turned out, the only
half that can ship without an owner decision. The rest is gated — see the end.

## What the entry got right, and the two things it got wrong

Right, and it is the whole point: **`middleware.ts`'s deactivation gate reads `req.auth`, which is
the cookie session, and structurally cannot see a bearer.** So a bearer path cannot inherit that
enforcement and has to carry its own.

**Wrong (a): the failure mode.** The entry says a deactivated bearer holder would reach *"every
`/api` route"* with the 403 never firing. The 403 indeed never fires — but **PS-24 moved the real
enforcement into `auth()` itself**, which re-reads the users row and returns `null` for
`isActive === false`. Measured: **222 route files import `auth` from `@/auth` and none construct
NextAuth themselves.** So the answer is 401 rather than 200 — *provided the bearer resolves through
that wrapper*. Resolving it anywhere else is what would produce the bypass the entry describes, which
is exactly why the fallback was put inside the wrapper rather than in a helper each route calls.

**Wrong (b): the size.** `getToken` from `@auth/core/jwt` **already reads `Authorization: Bearer`**
(`jwt.js:92-94`), already prefers the cookie, and already returns `null` instead of throwing on a
malformed, re-signed or expired token. So the server half is a wiring job, not a crypto one, and no
token parsing was written by hand.

## The shape

`lib/auth/bearer-session.ts` resolves the token, runs `refreshIsActiveClaim` against the row, and
builds the session by calling **`authConfig`'s own `session()` callback** rather than a second copy of
the claim→session mapping — so a claim added there reaches a bearer caller without anyone remembering
a list. `auth()` calls it only when the cookie path yielded nothing, so a browser request is resolved
exactly as before.

Three details that are load-bearing and would be silent if wrong:

- **The salt is the cookie NAME.** `secureCookie` has to track `NODE_ENV` the same way
  `exchange-mobile-token` does; get it wrong and the derived key differs, so every valid token reads
  as invalid — a failure that looks like "bearer auth just doesn't work". A test mints under the
  other salt and asserts the refusal.
- **An inactive cookie session is a final answer**, not a reason to consult the header.
- **`headers()` throws outside a request scope**, and `auth()` is called from places that are not
  handling one. The chokepoint answers "not signed in" there; it never throws.

## Verification

`lib/auth/__tests__/q1a-bearer-session.test.ts`, **18 passing**. The tokens are **really encoded and
really decrypted** — `encode` from the module the app decodes with, same secret, same salt. A mocked
decode would pass against an implementation that verified nothing.

Three mutations, because "the file exists" is not a result:

| mutation | outcome |
|---|---|
| delete the module entirely | 13 fail — the weak one, listed for completeness |
| **drop the `refreshIsActiveClaim` call, keep everything else** | **4 fail**, including the deactivated-holder case — the security defect is caught specifically |
| weaken cookie precedence to `session.isActive !== false` | **17 passed — a gap** |

**The third mutation found a real hole and the suite grew because of it.** No case sent a bearer
*alongside* a cookie, so a rewrite that let an inactive cookie session fall through to the header left
everything green — and would have served a deactivated browser session as whatever identity the
bearer named. There is a case for it now, and re-running the mutation fails exactly that one.

Two cases also failed on first write and both were the fixture, not the code: `isAdmin` came back
`false` because the refresh takes it from the **row** (the rule
`admin-claim-not-authoritative.test.ts` already pins for cookies, inherited here for free). Both
directions are asserted now, since a resolver ignoring the lookup would satisfy either alone.

Gates: `tsc --noEmit` exit 0 · Custom Rules 75 of 75 · `check-test-typecheck` · full suite.

## What is deliberately NOT done, and why the rest is owner-gated

- **`apiUrl()` is not here.** It is an indirection for client fetch sites; with no callers it is dead
  code that reads as done.
- **The exchange route still returns only a cookie.** That step is where the exposure actually
  changes: the session token is httpOnly today, so XSS in the WebView can act as the user but cannot
  *take* a 30-day credential — once it is in JS and Capacitor storage, it can. **And there is no
  consumer yet:** the APK is a WebView on the same origin using cookies, and Q-1b, the separate
  origin that makes a bearer necessary, is the half the owner deferred. That is a decision worth
  making deliberately rather than inheriting from a scope line written in August, so the remainder
  now carries `Gate: owner`.
- **The server half stands on its own and adds no exposure**, which is what makes it separable:
  sending a bearer requires already holding the JWT, and today that means reading an httpOnly cookie.

## Not exercised

- **The S25 device.** No client change, no native change, no APK — a Railway deploy reaches it.
- **A real bearer request against production.** Nothing issues a bearer yet, by design, so the path
  is exercised by tests and by nothing else.
- **`__Secure-` cookie naming under a real `NODE_ENV=production`.** The salt branch is asserted by
  minting under the wrong salt and checking the refusal; the production *name* itself is inherited
  from `exchange-mobile-token` rather than re-derived, and has not been observed end to end.
