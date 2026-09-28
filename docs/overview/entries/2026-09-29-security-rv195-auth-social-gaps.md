# 2026-09-29 — RV-195: three auth and social gaps closed

**Lane A · auth · held for the owner's merge-time yes (RV-221).**

1. **The mobile sign-in challenge is bound to its tab.**
   - `components/google-sign-in.tsx` now opens `/mobile-signin/begin`, a new route. It stores the
     PKCE challenge in a 10-minute httpOnly `ta_mobile_challenge` cookie (SameSite Lax, which
     survives the return from Google) and continues to `/mobile-signin`.
   - `/auth-mobile-bridge` mints through `lib/mobile-auth-bridge.ts` → `mintMobileBridgeToken`, which
     refuses a challenge the cookie does not hold.
   - The flow's JavaScript is served from Railway, so **no APK is needed**.
2. **A deleted user is signed out.** `refreshIsActiveClaim` treats a lookup that succeeds and finds
   no row as `isActive = false`, and `auth()` already returns null on that. A lookup that throws is
   still fail-open. This also covers the bearer path.
3. **A pending request reveals nothing to its sender.** `listFriendships` and `sendFriendRequest`
   mask the target (only what was typed comes back) until the request is accepted. The addressee
   still sees the sender.
   - The surface consequence, that an outgoing row reads "Unknown" and has Accept/Decline buttons
     that could never work, is filed as **LA-181** (Lane B).

- **Verified:**
  - Unit tests for the cookie, the begin route and the bridge decision.
  - A real-Postgres test for the masking, including the unmask on accept.
  - An updated refresh test.
  - `pnpm dev` with a throwaway `AUTH_SECRET`:
    - `begin` sets the cookie and redirects;
    - the bridge refuses a missing or mismatched cookie and renders for a match;
    - a JWT for a user with no row → 401 on `/api/friends`, and a live user → 200.
- **Not exercised:** the full sign-in on the APK through Google. A DV check is owed after merge:
  sign out, then sign in with Google on the S25, and confirm the app receives its session.
