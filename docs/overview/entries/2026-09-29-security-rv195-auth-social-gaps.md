# 2026-09-29 — RV-195 ① and ③: mobile sign-in bound to its tab, pending friend requests masked

**Lane A · auth · held for the owner's merge-time yes (RV-221).**

1. **The mobile sign-in challenge is bound to its tab.**
   - `components/google-sign-in.tsx` now opens `/mobile-signin/begin`, a new route. It stores the
     PKCE challenge in a 10-minute httpOnly `ta_mobile_challenge` cookie (SameSite Lax, which
     survives the return from Google) and continues to `/mobile-signin`.
   - `/auth-mobile-bridge` mints through `lib/mobile-auth-bridge.ts` → `mintMobileBridgeToken`, which
     refuses a challenge the cookie does not hold.
   - The flow's JavaScript is served from Railway, so **no APK is needed**.
2. **Item ② (a deleted user stays signed in) is NOT here.** It is #1784, from an earlier Lane A
   session, and this PR was narrowed to avoid duplicating it.
3. **A pending request reveals nothing to its sender.** `listFriendships` and `sendFriendRequest`
   mask the target (only what was typed comes back) until the request is accepted. The addressee
   still sees the sender.
   - The surface consequence, that an outgoing row reads "Unknown" and has Accept/Decline buttons
     that could never work, is filed as **LA-181** (Lane B).

- **Verified:**
  - Unit tests for the cookie, the begin route and the bridge decision.
  - A real-Postgres test for the masking, including the unmask on accept.
  - `pnpm dev` with a throwaway `AUTH_SECRET`:
    - `begin` sets the cookie and redirects;
    - the bridge refuses a missing or mismatched cookie and renders for a match;
- **Not exercised:** the full sign-in on the APK through Google. A DV check is owed after merge:
  sign out, then sign in with Google on the S25, and confirm the app receives its session.
