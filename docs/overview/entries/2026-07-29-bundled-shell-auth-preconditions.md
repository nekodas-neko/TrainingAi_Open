## 2026-07-29 — Read the auth boundary before rewriting it: three preconditions for Phase 3

Branch `docs/bundled-shell-auth-preconditions`. Docs only — no code changed.

Phase 3 (bundle the shell into the APK) is gated on an owner decision about the build split, so
Task 3's 21-site auth conversion is not startable. What *is* startable is the reading that task
depends on: the plan describes replacing a `auth()` preamble with a client hook, and that description
turns out to be incomplete in ways that would open a hole. Written into the plan as a new **Task 2b**.

### (a) The auth hole the plan as written would open

`isActive === false` is enforced in exactly one place in the running app: `middleware.ts:18`. No page
preamble checks it (`rg "isActive" app/**/page.tsx` is empty). Task 3 Step 2 says to replace
`if (!session?.user?.id) redirect("/sign-in")` — reproduce only that predicate client-side and
**every deactivated user with a live JWT gets into every screen.**

Not theoretical: `auth.ts:32` returns the user from `authorize` *deliberately* when `isActive` is
false ("signIn callback handles the redirect"), so a real token with `isActive: false` exists and the
middleware is what makes deactivation stick per-request. Static export runs no middleware. The client
gate needs both predicates.

### (b) The matcher is negative, and the route count was wrong

The plan says "the 20 `app/**/page.tsx` files". There are **40**; the matcher is an exclusion pattern,
so it guards everything except assets and the four `PUBLIC_PATHS` — 36 routes. More importantly, Step
4's instruction to "enumerate exactly which paths it currently guards and reproduce that list" is the
wrong shape: **a positive list cannot reproduce a negative one.** Today every new route is guarded by
default; under a whitelist every new route would be public by default. Reproduce as default-deny with
an explicit public list.

### (c) The bearer token already exists — it's the session JWT

Task 1 noted `auth-mobile-bridge` "does something close to this". It is closer than that: the whole
PKCE flow is built and working (`/mobile-signin` → Google → bridge mints a one-time challenge-bound
token → `trainingai://` deep link → `/api/auth/exchange-mobile-token`). And the value it carries,
`TokenEntry.sessionCookieValue`, **is the NextAuth session JWT**.

So the bearer token needs to be no new credential: return that JWT in the exchange response body,
store it in Capacitor secure storage, send `Authorization: Bearer <jwt>`. Same key, claims, expiry and
revocation as the cookie — one token type, two transports, exactly the `ADMIN_EXPORT_SECRET`
precedent. This removes the largest unknown from Task 3.

### Found along the way: `/mobile-signin` is guarded, and that looks like a live bug

Chasing (b) turned up that `/mobile-signin` — the URL `components/google-sign-in.tsx:29` opens in a
system browser to *start* the mobile OAuth flow — is not in `PUBLIC_PATHS`. Measured against
`pnpm dev`: unauthenticated `GET /mobile-signin?challenge=abc` → `307 /sign-in`, challenge dropped.
That is the state of a fresh install, and without the challenge the deep link that hands the APK its
session never fires.

Known Issues row added. **Not fixed here** — the one-line fix edits the auth boundary (confirm-first),
and it deserves a real first-run install to confirm rather than shipping on inference. It would break
*first* sign-in only, which is consistent with it going unnoticed.

### Not verified

- **Nothing on device**, and the `/mobile-signin` finding specifically needs a fresh install to
  confirm — a system browser carrying a session from an earlier sign-in would mask it entirely.
- **(c) is a design conclusion, not a working implementation.** Nothing was built against it; the
  claim that the session JWT can serve as the bearer token is from reading `exchange-mobile-token`
  and `mobile-auth-tokens.ts`, not from a request that actually authenticated by header.

No version bump — docs only.
