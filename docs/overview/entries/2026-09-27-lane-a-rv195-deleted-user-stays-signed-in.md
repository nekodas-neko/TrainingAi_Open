# RV-195 ② — a deleted account stayed signed in, and the comment said that was correct

**Branch:** `lane-a/rv195-auth-and-social-gaps` · **Lane A** · **auth — owner confirms before merge.**

RV-195 is three items and says "one PR". It is not one PR, and the other two are the interesting
part of this entry.

## ② — one line, and the code argued against it

`lib/auth/is-active-refresh.ts` re-reads `isActive` from the row once a day. On a missing row it
returned the token untouched, with a comment: *"A missing row is not evidence of deactivation."* So
a deleted account kept `isActive: true` in its JWT until the token expired — up to seven days of a
user who no longer exists being served.

What makes the inversion safe was already in the file. A database outage **throws**, and the `catch`
below leaves the claim alone so a blip never signs anyone out. Reaching the `!user` branch means the
query *ran* and answered "no such user" — `getUserById` returns null only for a non-matching id.
The two cases the comment conflated are separated by the language, not by that line.

`token.isActive = false` now, and `auth()`'s PS-24 wrapper already returns null for it.
`isActiveCheckedAt` is deliberately **not** advanced: there is nothing to re-check, and leaving it
means a row restored by hand takes effect on the next request rather than in a day.

## ① cannot be built where the entry says, and the alternative costs an APK

The entry: *"`/mobile-signin` sets a short-lived httpOnly cookie holding the challenge."*

`app/mobile-signin/page.tsx` is a **client** component — `"use client"`, calling `signIn()` in an
effect. It cannot set an httpOnly cookie, and Next 15 forbids `cookies().set()` during a page
render, so converting it to a server component does not help either.

- **(a) A route handler** that sets the cookie and redirects works — and changes the URL the Android
  app opens, which is Kotlin, which is **a new APK**. The entry costs it at one line.
- **(b) The client page POSTs to a small route** before `signIn`, keeping the URL and needing no
  APK. **Whether it defends anything is the open question:** a Chrome Custom Tab shares Chrome's
  cookie jar, so an attacker who can get a URL opened in that browser sets the cookie to their own
  challenge and the binding holds — for them.

That is a threat-model question, not a coding one, so it is written down rather than guessed at.

## ③ is not symmetric, and the typed string is not stored

*"Until the request is accepted, return only what the requester typed."* Two problems:

1. **Redaction must be viewer-aware.** The addressee has to see who is asking or they cannot decide.
   Only the **requester's** view of a pending row should be redacted, and `rowToFriendship` does not
   know the viewer.
2. **There is nothing to return.** `sendFriendRequest` holds `emailOrCode` and can echo it;
   `listFriendships` has no such column, so an outgoing pending request would render **blank** where
   a name is today. Storing the typed identifier is a column — and a migration ships alone and is
   never batched.

So ③ is a migration, a viewer-aware mapper, and a Lane B decision about what a pending outgoing row
shows. Recorded on the entry; not attempted here.

## Verification

- `lib/auth/__tests__` — **42 passed**. The existing missing-row test is **inverted in place**,
  keeping its intent; its sibling pinning the outage fail-open is untouched and is what stops the
  inversion going too far.
- **Mutation pass: baseline survives, 3 killed, 1 equivalent control survives.** Killed: restoring
  the old `return token`; deactivating from the `catch` too (the fail-open lost); advancing
  `isActiveCheckedAt` on a missing row. Control: `!user` → `user == null`.
- `tsc` 0 · `lint` 0 · `build` 0 · Custom Rules **83 of 83** · full suite below.

## Local run on `pnpm dev` (2026-09-27, second session)

Run on Windows against a fresh local Postgres (all migrations applied, seed loaded), in a real
browser, so the session cookie rotated the way it does on a phone.

- **A deleted account loses access on the next request.** Signed in through `/sign-in` as a
  throwaway account, `GET /api/friends` → **200**; `DELETE FROM users` for that row; the same
  cookie's next `GET /api/friends` → **401**. That closes the "Not exercised" point below about no
  account ever being deleted, for the local database.
- **The run is only valid if nothing calls `/api/auth/session` in between.** A first attempt read
  **200** after the delete, and the cause was the harness: it had called `/api/auth/session`,
  which re-issues the cookie with `isActiveCheckedAt` stamped, and from then on
  `refreshIsActiveClaim`'s one-day throttle skips the lookup. Proven by setting
  `ISACTIVE_RECHECK_MS` to `0` in the working tree: the same session went to 401 at once (then
  reverted). The app itself has no caller of that endpoint (PS-24 records why that matters), so the
  clean run above is the one that describes the product.

## Not exercised

- **No account was actually deleted anywhere.** The lookup is injected, so the test drives the
  contract rather than a real `DELETE FROM users`; what a deleted row does to the 55 cascading
  foreign keys is a separate matter and unchanged by this.
- **Nothing on the device**, and nothing in production.
