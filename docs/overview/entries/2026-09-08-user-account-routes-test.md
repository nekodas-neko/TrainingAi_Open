# 2026-09-08 — the account and credential routes get tests (PS-39)

**Branch:** `test/user-account-routes` · **Lane:** A · tests + docs only, no product code.

## What shipped

`lib/__tests__/user-account-routes.test.ts` — 32 cases across `user/password`, `user/profile`,
`user/preferences`, `user/avatar` and `auth/exchange-mobile-token`. Batched because they are the
write paths onto a user's own credentials and identity, and they verify as a set: the password
change reads the hash that `user/profile` must never return, and the token exchange mints the
session the other four authenticate with.

Each carries a decision invisible from the response shape, with a note in the source saying why:

- **A captured mobile token burns on the attacker's first attempt.** The one-time token is consumed
  before the PKCE verifier is checked, so a failed exchange leaves nothing redeemable — pinned by
  the retry: right verifier, already-burned token, still 401.
- **`user/profile` strips the hash and reports only whether one exists.** The repository hands the
  route the whole row; the fixture carries a real-looking bcrypt string and the case asserts it
  appears nowhere in the response.
- **Omitted and explicitly-null stay different** (BF-78). Collapsing them meant no profile field
  could ever be cleared.
- **The avatar MIME check is a whitelist, not a prefix.** The old `data:image/` test accepted
  `svg+xml` — a script-bearing format stored and re-served as a user's avatar. Pinned against SVG,
  `text/html`, `application/octet-stream`, a bare URL and GIF.
- **A malformed body on a credential route is a 400, not a 500.** Bare `req.json()` threw and Next
  answered 500 on a password change.

Also pinned: the eight-character floor rejects before any user lookup; an account with **no**
password may set one without a current password (an OAuth-only account would otherwise be locked
out); the stored value is a bcrypt hash at cost 12 and never the plaintext; both PATCH routes write
to the session user whatever the body names; and the exchange's rate limit is **per IP** — a
different address is unaffected by an exhausted one.

`scripts/check-route-test-coverage.js` baseline 116 → **111**.

## Two mutations survived, and both were mine to explain rather than fix

- **The preferences route's `value !== undefined` filter cannot be covered, and the test now says
  so.** JSON has no `undefined`, so no HTTP body produces a parsed key holding one; mutating the
  filter away fails nothing. The case was renamed to claim only what it holds — the null-clears
  versus absent-leaves-alone distinction — rather than implying coverage it does not have.
- **The exchange's consume-before-verify ordering is structural, not a choice a mutation can undo.**
  The challenge to verify *against* only exists inside the consumed entry, so there is no
  verify-then-consume to write. The comment now says that, and the case pins the consequence.

A third apparent survivor was a bad mutation, not a weak test: it edited `UserPreferencesSchema`'s
`.strict()` instead of `UserPreferencesPatchSchema`'s. Aimed correctly, the case fails.

## Notes

- **Thirteen mutations caught**: skipping the current-password check, accepting a wrong one,
  removing the length floor, storing plaintext, a 500/hour password limit, returning the hash,
  collapsing omitted-versus-null, both `.strict()`s, the `data:image/` prefix hole, the decoded-size
  cap, a non-httpOnly cookie, and a raised exchange limit.
- Six cases initially failed as 429s because they shared one rate-limit bucket. `beforeEach` resets
  mocks but **not** the limiter, so every case now takes a fresh user id and the exchange cases a
  fresh IP. Worth generalising: any route with a per-user limit needs per-case identities.
- The over-size avatar case has to land between two limits 260 KB apart — base64 is 4/3 of the
  payload, so the 5 MiB decoded cap is 6,990,507 characters and the stream guard is 7,340,032 bytes
  of whole body. The arithmetic is in the test rather than a magic number.
