# 2026-09-29 — the inbound PRs merged themselves, and one of them was auth

**Agent:** BugFix intake, third firing of the daily inbound GitHub watch (OR-185). **Docs only.**

## The sweep

- **Open issues: 0.**
- **Open PRs: 7, all ours.** `#1607` and `#1608` are gone — `jsboiss` **merged both himself at
  10:25 on 2026-09-29**.

That is his to do and this entry does not dispute it. What it records is that **the review `BF-212`
said was owed never happened**, and `#1607` is the auth carve-out, with the owner listed as a
requested reviewer who did not review. It is deployed.

## It merged on a stale green

`#1607`'s only CI run is **2026-09-25, six jobs with a single `Tests`** — from before the suite was
sharded into four. Four days and a CI topology change separate that run from the merge. All six
passed; none ran against the tree it landed on. (`#1608`'s green was current, checked 09-28.)

## What the diff actually does

23 lines in `app/api/auth/exchange-mobile-token/route.ts`, and most of it is careful:
`responseType` allowlisted to `cookie`/`token` with a 400 otherwise; the session verified through
`getToken` — decrypt plus an explicit `exp` check — before anything is returned;
`Cache-Control: private, no-store`; the cookie path untouched.

**The one thing needing a decision:** the bearer token *is* the session cookie's value, with the
cookie's lifetime — `accessToken: sessionCookieValue`, `expiresAt: session.exp`, against
`maxAge: 7 * 24 * 60 * 60`. One credential now lives in two containers with very different
properties: a cookie is `httpOnly`, `SameSite`, browser-confined; a bearer token is deliberately
handed to a native app to store and replay, for up to seven days, and being a stateless JWT nothing
revokes it before `exp`.

## The alarming version of that finding is wrong, and I checked before writing it

The session JWT **does** carry the Google refresh token (`auth.config.ts:45`) — the thing `RV-193`
exists to keep out of the session JSON. So this looked like RV-193 reaching a new surface.

**It is not. The JWT is encrypted, not merely signed** — verified against the pinned source,
`@auth/core@0.41.3` `jwt.ts:52-53`: `alg: "dir"`, `enc: "A256CBC-HS512"`, JWE. A client holding the
token cannot read what is inside it. The finding is an opaque session credential in a weaker
container, which is a real but much smaller thing, and the citation is what keeps it that size.

## Queue hygiene

`BF-212` and `BF-213` removed — they routed PRs that have merged, so they were finished entries
sitting in the queue. What is genuinely still owed moved to **`BF-224`**: the post-merge read, plus
the one owner decision (bearer lifetime).

**`TN-80`'s PR register** listed both as awaiting the owner. Those two rows are struck, with what
actually happened. That register has now needed correcting twice; it tracks a moving object and is
only true on the day it is written.

## Not exercised

Docs only. **Nothing merged, closed, pushed or commented on either inbound PR** — and both were
already merged by their author before this sweep ran. No device run, no code change. **Whether any
client is already exchanging with `responseType: 'token'` was not checked** — that decides whether
shortening the expiry is free or breaking, and BF-224 names it.
