# 2026-09-28 — RV-193: the Google refresh token no longer reaches page JavaScript

**Lane A · auth · held for the owner's merge-time yes (RV-221).**

- **Change:**
  - `auth.config.ts`'s session callback no longer copies `token.refreshToken` onto the session. That
    object is what `GET /api/auth/session` returns to any script in the origin.
  - `Session.refreshToken` is removed from `types/next-auth.d.ts`, so a client use would fail to
    compile.
  - The one consumer, `log-calendar-event`, reads the token with the new
    `lib/auth/google-refresh-token.ts` → `googleRefreshTokenFor(headers, userId)`. That is the same
    `getToken` call and `secureCookie` salt as `bearer-session.ts`, and it returns the token only
    when the JWT's `userId` matches the session's.
- **Verified:**
  - Tests: a session-callback guard; a JWT belonging to another user → 401; the calendar and
    RV-177 suites now serve the token from a `getToken` mock.
  - `pnpm dev` with a throwaway `AUTH_SECRET` and locally minted JWTs:
    - `/api/auth/session` carries no token;
    - with a token, the route handed it to Google (`invalid_grant` for the fake), so the
      server-side read works;
    - without one, the route answers 401.
- **Not exercised:** production's `__Secure-` cookie name. It is the same rule `bearer-session.ts`
  already depends on there. **An existing session keeps working:** the token was always in the JWT,
  so no re-login is needed.
