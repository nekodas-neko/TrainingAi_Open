# Session journal — batch folded 2026-09-29

Entries folded out of `docs/overview/entries/` by `scripts/fold-journal-entries.js`,
oldest-first. **Unlike earlier sweeps, entries cited by a durable doc were folded too** — every
citation was repointed here, at the `<a id="…">` anchor named after the entry's old filename.

<a id="2026-09-25-rv191-image-data-uri-validation"></a>

# RV-191 — the screenshot is validated by its bytes, and the exploit it was filed for does not reproduce

**Branch:** `fix/rv191-feedback-screenshot-validation` · **Lane A + B** · `[platform][app-shell]`

## The severity was wrong, and executing it is what showed that

RV-191 is filed as **SECURITY, HIGH**, ahead of RV-190, on the grounds that an admin who clicks a
feedback thumbnail "runs code with the admin's session in the app's origin" — and it says outright
that this was **"reasoned from source and not executed"**.

It has now been executed, on the Chromium in this container:

| leg of the stated path | measured |
|---|---|
| `window.open('data:text/html,<script>…')` | **did not navigate** — the opened window stayed `about:blank`, and the script never ran |
| SVG inside `<img src="data:image/svg+xml;base64,…">` | **script did not run** — `<img>` renders SVG script-inert |

Both legs are blocked by the browser, so the admin-RCE does not reproduce and this is **not** the
"script-execution precondition for RV-193 and RV-196" that its priority line claims. The entry has
been amended rather than deleted, because the *validation gap* it describes is real.

**Not measured on the Samsung WebView**, which is the canonical runtime. It follows the same Blink
policy, but that is inference; nothing here ran on the device.

## What was actually wrong, and the fix the entry did not ask for

`POST /api/feedback` checked `typeof screenshotData === 'string'` and a 500 KB cap. Any 500 KB
string reached a column the admin panel renders as an image.

The entry says to fix it by reusing the avatar route's MIME check. **That check was weaker than what
this codebase already knew.** `/api/user/avatar` validated the **declared** type — the one whoever
sends the data URI writes — so `data:image/png;base64,<SVG>` passed it. `sniffImageMime` has existed
since DV-18 for exactly this reason, and its own docstring says so: *"the bytes are the only thing
worth asking"*.

So the shared `parseImageDataUri` (`packages/shared/src/http/request-guards.ts`) decodes the payload,
sniffs the leading bytes, and requires the bytes and the declaration to **agree** — a real JPEG
labelled `image/png` is still a lie, and the admin UI renders the label. **`/api/user/avatar` was
fixed in the same PR**, under the sibling-surface rule: it had the weakness the entry proposed
copying.

`app/admin/admin-content.tsx` no longer calls `window.open(storedValue)`. The thumbnail zooms in
place, behind a real `<button>` with `aria-pressed`, so nothing navigates to a user-supplied value
and the control is reachable from the keyboard.

**The size rule is deliberately unchanged**: still measured on the stored string, not the decoded
bytes, because the string is what goes in the column and what `MAX_BODY_BYTES` keeps headroom over.
Moving it to decoded bytes would have quietly raised the allowance by 1.33×.

## Verification

Two existing suites had to change, and both changes are the point rather than collateral:

- `user-account-routes.test.ts` drove the avatar route with `data:image/png;base64,AAAA` under every
  declared type. That fixture only ever passed **because** the route trusted the declaration. It
  carries real PNG/JPEG/WebP headers now, plus two new cases: SVG labelled PNG, and a real JPEG
  labelled PNG.
- `feedback-calendar-scale-routes.test.ts` used `'d'.repeat(400_000)` as a screenshot. Its
  **oversize half passed unchanged**, which is the evidence that the size semantics really were left
  alone; only the "and it is stored" half needed a real image.

Gates (real exit codes): `lint` 0 · `tsc` 0 · full suite green.

## Not exercised

- **The existing production rows.** There is no `claude_ro.feedback` view **at all** — the entry says
  the view "omits `screenshot_data`", but the whole table is default-denied, checked against
  `information_schema` on 2026-09-25. Nothing in this container can read them, so whether any
  stored row is a non-image is unknown and stays owed. No stored row is touched by this diff, and
  any delete is the owner's call.
- **The admin screen was not rendered.** The zoom change is reasoned from the diff and typechecked,
  not opened in a browser or on the device.
- **The Samsung WebView**, as above.

<a id="2026-09-26-rv190-db-query-session-state"></a>

# RV-190 — the read-only endpoint's protections were session defaults, and they leaked between requests

**Branch:** `lane-a/rv190-db-query-session-state` · **Lane A** · `[platform]`

`/api/admin/db-query` is read-only because of a Postgres role — that was the claim, written into
`readonly-client.ts`'s own docstring: *"That role — not anything in this file — is what makes the
endpoint read-only."*

The GRANTs are real. The other three protections are **session defaults** set with `ALTER ROLE`, and
a submitted query can `SET` its way out of all three: the owner scope `app.claude_ro_owner`,
`default_transaction_read_only`, and `statement_timeout`. Each query ran in autocommit on a
two-connection pool that is never reset, so an override did not end with the request — it rode the
pooled connection into the next one. Re-pointing the owner scope means **a later, honest query reads
another user's rows.**

Reproduced on the local database. **Nothing was probed on production**, which is also how the entry
found it.

## The fix, and the part of it that actually works

Every query on that pool now goes through `runScoped` — `RESET ALL`, then `BEGIN TRANSACTION READ
ONLY`, `SET LOCAL` for the timeout and (optionally) the owner, the query, `ROLLBACK`, `RESET ALL`.
Both `db-query` call sites and `db-snapshot`'s count query use it; no raw `pool.query` on the
read-only pool is left.

**The mutation pass changed what this entry claims.** Of six mutations, only one failed a test:
removing the `RESET ALL` **on the way in**. Dropping `READ ONLY` from the transaction, swapping
`ROLLBACK` for `COMMIT`, dropping the outbound `RESET ALL`, and using `SET` instead of `SET LOCAL`
all passed everything.

That is not a gap in the tests so much as a fact about the mechanism, and it is worth stating
plainly rather than dressing up: **with the role correctly provisioned, `default_transaction_read_only
= on` already makes every transaction read-only**, so the explicit `READ ONLY` keyword changes
nothing observable. It earns its place the way this file's connection-level `statement_timeout`
already does — it holds if the role is ever mis-provisioned. The docstring now says which part is
load-bearing and which is belt, and says outright that the belt is not covered by the suite.

## What the reproduction caught that the happy-path tests could not

The first version of the three regression tests passed immediately — and proved nothing. They only
called `runScoped`, which did not exist before the fix, so they could never have run against the
broken path.

Adding a case that drives the **old** shape (a plain `pool.query` in autocommit) fixed that, and it
immediately failed on its second assertion: after a leak, `runScoped` returned the **leaked** owner.
The reset was in the `finally`, so it protected the *next* caller and not itself on a connection
that was already dirty. `RESET ALL` moved to the way in as well. That is the one mutation the suite
now kills, and it exists because the reproduction was written rather than assumed.

The route tests needed the same treatment from the other side: they mocked `getReadonlyPool` as
`{ query }`, which `runScoped` does not call. The fake pool is now `{}` with `runScoped` as a spy —
so a route that goes back to `pool.query` fails with *"query is not a function"* instead of passing
quietly. Verified by reverting the route: 8 of 17 cases fail.

## Verification

29 cases in `claude-ro-readonly-role.test.ts` (over TCP; both claude_ro suites run, 32 tests, none
skipped) plus 52 in the two route suites.

| mutation | killed |
|---|---|
| drop `RESET ALL` on the way in | 1 of 29 |
| route reverts to `pool.query` | 8 of 17 |
| `BEGIN` without `READ ONLY` | **0 — belt, see above** |
| `COMMIT` instead of `ROLLBACK` | **0 — belt** |
| drop `RESET ALL` on the way out | **0 — belt** |
| `SET` instead of `SET LOCAL` | **0 — belt** |
| **control:** name the timeout via a local const | **0 — survived, as intended** |

Gates: `lint` 0 · `tsc` 0 · `typecheck:tests` 0 · `check:rules` 0 · pointers 0 · full suite
**9,974 passed**.

## Not exercised

- **Production.** Nothing was probed there, deliberately, and the fix is not verified against the
  real `claude_readonly` role as provisioned on Railway — only against the one the test harness
  creates locally.
- **The `ownerId` parameter has no caller yet.** It exists for OR-138, whose entry said to build
  this first; that entry is updated to point at it.
- The route was not driven through `pnpm dev`; it needs `CLAUDE_DB_READONLY_URL`, which this
  container does not have.

<a id="2026-09-27-lane-a-rv192-registration-email-ownership"></a>

# RV-192 — an invite is not proof you can read the inbox

**Branch:** `lane-a/rv192-registration-email-ownership` · **Lane A** · **auth — owner confirms
before merge.** Two statements in the adapter; no migration, no product code beyond them.

## The path, and it is short

`createEmailUser` defaulted `isActive` to `isInvited(email)`. So anyone who knew an address the
owner had invited could register it with a password and land in an **active** account for it.
Nothing asked them to prove they could read that inbox. When the real invitee later signed in with
Google, the signIn callback linked Google onto that same row and left `password_hash` in place — so
the first person's password kept working on an account the invitee was now using.

Both halves verified against `main` before touching anything: `adapter.ts:774` (`isActive ?? await
this.isInvited(email)`) and `auth.ts:103` (`linkOAuthAccount`, `oauthSub` only).

## What shipped, and what deliberately did not

1. A password account starts **inactive**. The owner activates it.
2. `linkOAuthAccount` clears `password_hash` as it links.

**Google sign-in still honours the invite**, through `upsertUser`, and that is not an oversight —
Google has verified the address, so there the invite is being matched against a proven owner. The
asymmetry between the two paths is the fix.

**Real email verification — which is how the entry words fix 1 — is NOT done.** There is no
mail-sending path in this repository at all: no nodemailer, Resend, SES or anything else. Building
it is a provider, a secret, a token table and a screen. It is also the wrong first question, because
the entry's own alternative may answer it for free: every current user signs in with Google, so
dropping password registration would close this without building any of it. That is a product call
and it is the owner's.

## Why clearing a password is safe here

The branch runs only on the **first** Google sign-in for a row with no `oauthSub`, and the person
triggering it is signing in with Google as it runs — they are not locked out of anything. The
owner's account already carries an `oauthSub`, so it cannot fire for him. And `auth.ts:57` already
returns null on a falsy hash, so a cleared password is a refusal rather than an empty one; there is
a test for that line specifically, because the whole fix would be worse than useless if a null
column meant "no password required".

## How this survived a test named for it

`lib/__tests__/register-inactive.test.ts` is titled *"accounts must start inactive/pending"*. What
it asserts is that the **route** passes no `isActive` override — which leaves activation to
`isInvited`, the defect itself. A test named for a property, asserting something weaker. Worth
remembering as a shape: the file was not wrong, it was narrower than its name.

## Verification

- `lib/data/postgres/__tests__/rv192-registration-email-ownership.test.ts` — **4 passed**, against a
  real Postgres. Both changes are single statements in the adapter, so a mocked adapter would only
  restate them.
- **Mutation pass: baseline survives, 4 killed, 1 equivalent control survives.** Killed: restoring
  the `isInvited` default; keeping the password on link; clearing the password but not linking (the
  lock-everyone-out failure, distinguished deliberately from the fix); ignoring an explicit
  `isActive`. Control: `isActive ?? false` → `isActive === true`.
- `tsc` 0 · `lint` 0 · `build` 0 · `check-test-typecheck` at baseline · Custom Rules **83 of 83**.

## Local run on `pnpm dev` (2026-09-27, second session)

Run on Windows against a fresh local Postgres (all migrations applied, seed loaded), through the
real `/register` and `/sign-in` screens in a browser.

- **An invited address registers inactive.** With `invited-…@local.dev` in `invited_emails`,
  `/register` created the row with `is_active = false`. Signing in with it went to `/pending`
  ("Awaiting approval") with no session.
- **An uninvited address** also registered with `is_active = false`.
- **An existing active password account still signs in** and lands on Home.
- Not covered by this run: Google linking clearing the password, which needs a real Google sign-in.
- **Seen on the way, not caused by this diff** (it does not touch `app/register/`): after a
  successful `POST /api/auth/register`, the form's `router.push('/sign-in?registered=1')` did not
  navigate in three dev-mode runs, although calling the router by hand did. Fast Refresh rebuilds
  were logged around each submit, so this may be dev-only.
- **A toast this PR makes untrue.** On `?registered=1`, `app/sign-in/email-sign-in.tsx` says
  *"Sign in below — or wait for approval if not yet invited."* After this PR an invited registrant
  waits for approval too. That file is Lane B's, so the copy change is filed as `LA-162` with
  `Needs: RV-192` rather than widened into this diff.

## Not exercised

- **No real sign-in was performed.** Google OAuth cannot be driven from this container, so the
  signIn callback's own branch is reasoned from the diff; what is tested is the adapter call it
  makes. The registration flow was not run through `pnpm dev` either — it needs `AUTH_SECRET` and a
  Google client.
- **Nothing on the device or in production.** No existing row is touched by this diff; the password
  clearing happens on a future link, not as a backfill.

<a id="2026-09-27-lane-a-rv193-refresh-token-not-in-session"></a>

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

<a id="2026-09-27-lane-a-rv195-deleted-user-stays-signed-in"></a>

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

<a id="2026-09-27-lane-a-rv197-csp-connect-src"></a>

# RV-197 — `connect-src` ended in two schemes that allowed a WebSocket to anywhere

**Branch:** `lane-a/rv197-csp-connect-src` · **Lane A** · **security — owner confirms before merge**,
though this is the cheapest of the security items to approve: one line, reversible in one deploy.

## What it was

```
connect-src 'self' … https://*.tile.thunderforest.com wss: ws:
```

`connect-src` is the directive that would otherwise stop injected script sending data off-origin —
and the blanket at the end of the list undid most of the rest of it. Nothing needed it.

## Both of the entry's claims reproduce, and one check is stronger than the entry's

- No `WebSocket` is constructed anywhere in `app/`, `components/`, `lib/` or `packages/`, and there
  is no ws client in `package.json`.
- `https://generativelanguage.googleapis.com` appeared **nowhere in the repository except that
  line**. Gemini is called through `@ai-sdk/google` on the server; the browser never connects to it.

A source grep cannot see a dependency doing either, so I built the app and grepped the **emitted
client bundles**: zero hits for `generativelanguage`, zero for `WebSocket(`, and zero `ws://`/`wss://`
literals of any kind.

`ws: wss:` is now conditional on `isDev` rather than deleted — the dev server's HMR socket is a real
consumer. If a production feature ever needs one, the answer is to name its host (`wss://host`), not
to restore the scheme.

## The mutation control found a test that was too tight

`dev and production differ only in the eval allowance` compared the two strings literally. Extended
to cover the ws schemes, it then failed when they were merely **reordered** — a change that changes
nothing. It strips them by pattern now, and still catches what it exists to catch: a third
difference between dev and production that nobody decided on.

That fell out of the equivalent control, which is exactly what an equivalent control is for.

## Verification

- `lib/security/__tests__` + `lib/media/__tests__/no-data-url-fetch.test.ts` — **21 passed**.
- **Mutation pass: baseline survives, 4 killed, 1 equivalent control survives.** Killed: restoring
  the schemes unconditionally; restoring the Gemini host; dropping ws from dev too; removing a real
  image host from `connect-src` only (the service-worker refetch rule). Control: swapping the order
  of the two ws schemes — which killed the test until the test was loosened, and survives now.
- `tsc` 0 · `lint` 0 · `build` 0 · Custom Rules **83 of 83** · full suite below.

## Local run (2026-09-27, second session)

- **`pnpm dev`:** signed in and loaded Sign-in, Home, Health and Nutrition with the console
  filtered for `Content Security Policy`/`Refused`: **no violations**. The dev header's
  `connect-src` still ends in `ws: wss:` (hot reload needs them) and has no
  `generativelanguage.googleapis.com`, as intended.
- **Client code opens no WebSocket and calls no Gemini host directly.** A repo-wide search for
  `new WebSocket`, `EventSource(` and the Gemini hostname finds only `scripts/device/cdp.js`, a
  Node-side DevTools script outside the page.
- **The production header is still not read off the wire.** `next build` succeeded locally, but
  `next start` refuses to boot: the storage keys in the local `.env.local` are rejected by the
  bucket (`SignatureDoesNotMatch (403)`), the same failure the cloud container hit. That refusal is
  the instrumentation hook failing closed on purpose, so the fix is fresh keys, not a code change.
  (On Windows the `build` script's `NODE_OPTIONS=…` prefix does not run under `cmd`, so its two
  steps were run directly.)

## Not exercised

- **The header was never read off the wire.** `pnpm start` cannot boot in this container — the
  instrumentation hook needs S3 credentials for the vendored model constants — so what is verified
  is `buildCsp(false)`'s output and the bundles, not a live response.
- **Nothing on the device.** A header change reaches the WebView through a normal Railway deploy;
  no APK. If something unforeseen did want a WebSocket in production, the symptom would be a
  console CSP violation and that feature failing — visible, not silent.

<a id="2026-09-27-native-security-batch"></a>

# OR-159 + RV-196 — two native security fixes in one APK cycle

**Branch:** `lane-a/native-security-batch` · **Lane A** · `Batch: native-security`.
**⚠ Owner confirmation before merge** (RV-196 carries that gate; OR-159 is security-adjacent).

## Why these two together

Both are `android/**`, both need a new APK, and both entries say in their own words not to ship
native work alone — RV-196: *"Batch it with the next native change rather than cutting an APK for
it alone"*. One cycle, two fixes.

## Why they were not skipped

These sat at the head of Lane A's READY list for days, passed over as "auth/security — owner's".
That reading is wrong, and re-reading the rule is what unblocked them. `CLAUDE.md` says
confirmation is required **before merging** an auth/security change, not before building one. The
effect of treating them as unbuildable was that the top of the queue was permanently inert while
work below it shipped.

## OR-159 — the session cookie is out of backup

`android:allowBackup="true"` with no rules meant Auto Backup took `app_webview/Cookies`, a live
credential: restored onto another device it is a signed-in session. Now excluded via
`backup_rules.xml` (API 23-30) and `data_extraction_rules.xml` (API 31+) — both, because minSdk is
26 and targetSdk 36.

**Scoped to the cookie, as the entry insists.** The ring key is in `shared_prefs/oura_ble.xml` and
is a separate decision (OR-160), left exactly as it was.

**Amended 2026-09-29, before merge:**
- **The ring key is now excluded too.** The owner closed OR-160 on 2026-09-26: exclude it, because he
  holds his own copy.
- **`setKey` now asks before overwriting an existing key.** Replacing the key destroys the old one
  exactly as `clearKey` does, and it was the one destructive door left open. Storing a first key
  needs no tap.

These were added to this PR rather than a new one. A later session rebuilt RV-196 from scratch
without noticing this PR, and folding its two genuine additions in here was the way to avoid a
duplicate.

**One call of mine, flagged rather than buried:** `device-transfer` is excluded as well as
`cloud-backup`. The approval was for keeping the cookie off a restore onto another device, and a
direct phone-to-phone transfer lands it on another device exactly as a cloud restore does. The
cost is re-signing in after switching phones. Easy to drop if that is not wanted.

## RV-196 — the ring key's three doors

1. **`setIngestUrl`** accepted any absolute URL on all three plugins, persisted it, and made the
   foreground service post raw frames there — a redirect that survives restarts. It now goes
   through a new pure `IngestUrlPolicy`: the app's own origin over https, plus loopback, nothing
   else.
   - It **parses with `java.net.URI` rather than prefix-matching**, and refuses userinfo.
     `https://trainingai-production.up.railway.app@evil.example.com` has host `evil.example.com`
     and reads as the app's origin both to a human and to the obvious prefix check. That case is
     the reason the policy is not three lines.
   - **Loopback is allowed on purpose** — it cannot move data off the device, and the emulator and
     local harnesses need it.
2. **`revealKey` and `clearKey`** now need a native `AlertDialog` tap. A system dialog is drawn
   outside the WebView, so a script in the origin can open it and cannot answer it. Both callers
   are explicit buttons in the ring debug console, so the cost is one deliberate extra tap; nothing
   calls either automatically, which I checked before adding it.

The Kotlin comment that said "every caller is already app JavaScript" was right, and that is
precisely the problem: it makes the CSP the only boundary, and the CSP allows `'unsafe-inline'`.

## Verification, and its limits

- **`IngestUrlPolicy` has 9 JVM tests**, which CI runs via `android.yml` — covering the app origin,
  an arbitrary host, the prefix near-miss, userinfo smuggling, plaintext to the app host, loopback,
  non-http schemes, empty/null, and normalisation.
- XML well-formedness checked for all three files; `tsc` clean; Custom Rules **80 of 80**.
- **Kotlin cannot be compiled in this container** (no Android SDK, Gradle download proxy-blocked),
  so the compile and the APK build come from `android.yml` on the PR. That workflow is not a
  required check, so **its result must be read rather than assumed** before this merges.

**Not exercised — and this is the part that matters here.** Nothing was run on the device. Not the
dialog, not ingest after the allowlist, not a restore. Three specific things are owed on the next
APK, and both entries keep a `Keep:` line saying so:

1. The confirm dialog appears for reveal/clear and is answerable.
2. Ring, scale and strap ingest still reach the server — if the app shell ever passes an origin
   the allowlist does not cover, uploads stop silently.
3. Sign-in survives a normal launch. The backup exclusion is currently **unobservable**: the local
   store is 31.2 MB against Auto Backup's 25 MB quota, so nothing is backed up at all until D4's
   pruning lands.

## Shipped user-visible

v1.477.3 with three changelog lines. The version bump is deliberate here — unlike most changes,
this one only reaches the device through a new APK.

<a id="2026-09-28-bugfix-bf-213-1608-new-convention"></a>

# 2026-09-28 — inbound sweep: #1608 adopted BF-214's conventions on its own

**Agent:** BugFix intake, second firing of the daily inbound GitHub watch (OR-185). **Docs only.**

## The sweep

- **Open issues: 0.**
- **Open PRs: 10, of which 2 are not ours** — `#1607` and `#1608`, both `jsboiss`. Both already
  carry entries (`BF-212`, `BF-213`), so nothing was unfiled.

## `#1608` moved, and the entry was stale again

Head went `0bb5a87e` → `5d680b16`. What changed is the part `BF-213` had predicted would need doing:

- The migration is now **`202609280817_apple_health_samples.sql`** — BF-214 ②'s `YYYYMMDDHHMM_<what>`
  form, not a sequence number.
- The `claude_ro` views are an **in-place edit of `lib/data/postgres/claude-ro-views.sql`**, not a
  numbered twin migration — BF-214 ①.

So the numbered scheme is gone from this PR entirely and **there is no number left to collide on**.
The entry's line saying its `291_claude_ro_views_…` twin "must be deleted once BF-214 merges" was
satisfied by the author without being asked.

**The green is not stale, checked rather than assumed:** no commit on `main` has touched
`claude-ro-views.sql` or added a migration since his run at 08:43Z, so the one shared file this PR
edits has not moved underneath it. All ten jobs completed and success; `mergeable_state: clean`.

## What I did to the entry, and why

`BF-213` had accumulated **three contradicting layers** — the original 288/289 collision, the
09-27 correction to 290/291, and the BF-214 prediction — describing two states that no longer
exist. Rewrote the body to lead with current state and compress the history into one bullet.

**The lesson is procedural, not technical:** an entry describing an inbound PR describes a moving
object, and re-reading it costs one call. This entry has now been wrong twice, both times because
the contributor fixed the thing before we re-read it.

## One claim I corrected before committing

I first wrote that Review should read "the ingest route's Zod schema next to it". **There is no
ingest route in this PR** — 4 files, storage only, and the author says so plainly. Rewritten to put
that check on the follow-up PR that adds the route.

## `#1607` unchanged

Head still `6f6fd763`, `updated_at` still 2026-09-27. `BF-212` already records it. No change.

## Not exercised

Docs only. **Nothing merged, closed, pushed or commented on either inbound PR** — the ceiling there
is review, comment, approve, and no comment was posted.

<a id="2026-09-28-bugfix-bf-217-missing-progression-styles"></a>

# 2026-09-28 — `Full` still would not take, and the reason was nine missing progression styles

**Agent:** BugFix intake. **Docs only** — no product code.

## What the owner reported

*"I still cant change this to full?"* — on the Pull pre-workout screen for Tuesday 29 September,
with the AI Prescription card reading *"Full is on, but these weights are unchanged."* The same
screenshot carried a `⚠ Style not found` on Face Pull.

## What it actually was — two separate things

**① The BF-198 fix is live and does not reach a prescription already stored.** Production is on
`1.481.1`; the fix (`d4466c55`) merged at 07:17 +10:00 the same morning and is in the deployed
tree. His Pull prescription was generated **2026-09-23T09:54:51Z** and does not expire until
**2026-09-30T09:54:51Z**, so it outlives the session he was about to train. It is the only stored
whole-session deload: 5 of 5 deloaded, 0 with `preDeload`.

There is a one-tap workaround, which BF-198 did not record because nobody had traced the refit
path: changing the duration preset **cannot** be served from the stored plan on a whole-session
deload — `refitPrescriptionToBudget` needs a baseline, whole-session deloads carry none, so it
returns `no_baseline` and the route falls through to full generation
(`prescribe/route.ts:95`, `refit-prescription.ts:57`). On the fixed code that rebuild writes
`preDeload`.

**② Nine exercises in his live program have no progression style — filed as BF-217.** Promoted out
of BF-200's Keep ①, which recorded it as one exercise. The active program `Bankai` carries **9 of
25 with `style_id` NULL**; every other program carries zero except the dead `Main`. **`Lower` has
lost all five.** The losses date to 09-09, 09-10, 09-12 (×4) and 09-13 from the last
`exercise_logs` row that still carried a style — four instalments, not one event, which is what
points at a save path.

The knock-on is what makes this more than cosmetic: BF-198's fix draws its revert numbers from
`buildRulesPrescription`, which **skips** a style-less exercise and **returns null when every
exercise is one** (`generate-prescription.ts:169`, `:177`). So Pull revives 4 of 5 on
regeneration and **`Lower` revives nothing** — its `Full` toggle is dead on the fixed code for the
same reason it was dead on the broken one.

## A measurement trap worth keeping

`session_exercises.updated_at` reads `2026-09-28T05:17:31.544Z` on **all 25 rows, to the
millisecond**. A program save rewrites every session-exercise row, so the column dates the last
save and never the loss. Anyone bisecting this from the table will conclude it happened today.

## Shipped

- **BF-217** filed at the top of Lane A READY.
- **BF-198** Keep gains ③: the stored-prescription residue, its expiry date, the preset-switch
  workaround, and the two style-less consequences.
- **BF-200** Keep ① widened from one exercise to the 9-of-25 measurement with the dating table.

## Not exercised

No device run and no code change. The workaround is derived from the route and refit source, not
observed on the phone — the owner tapping a duration preset on Pull is what would confirm it.

<a id="2026-09-28-checkin-announce-and-correct"></a>

# 2026-09-28 — TN-82: the check-in announces its answer, and he corrects it in one tap

**Lane B.** Branch `feat/checkin-announce-and-correct`. v1.480.0.

## What shipped

The morning sheet stops **asking**. Both scales are gone; in their place it states what it filled
and why, and his only interaction is to disagree.

- **`components/checkin/sleep-announcement.tsx`** (new) — the announcement, the five one-tap
  correction chips, and the explicit acknowledgement.
- **`components/checkin/save-sleep-value.ts`** (new) — the one place deciding what gets written and
  whether it counts as his.
- **`components/health/sleep/sleep-verdict-copy.ts`** — `verdictToStoredFeel()`.
- **`components/morning-checkin-sheet.tsx`** — two `ScaleSelector`s out, announcement in, first.

The announcement surface itself already existed: **TN-85 shipped it on Home**, and this reuses its
`verdictCopy()` and its `sleep-verdict:<date>` cache key and TTL rather than introducing a second.

**Why asking had to go, in one line:** 82 morning sheets across three months, and in each month
exactly *one* field collected a handful of answers — always the newly added or newly moved one,
always decaying to zero. `perceived_recovery` has **0 touched answers in 102 check-ins**.

## The three decisions worth not re-litigating

**1. Saving the sheet is NOT an acknowledgement.** The plan wants three states — no response,
acknowledged, corrected — and says a prominent announcement is "prominent enough to be dismissed
deliberately". Treating the **Save** tap as that dismissal would have been the obvious reading and is
wrong: he has saved 82 of 82 sheets while touching a scale in 3, so Save is the reflex, not assent.
Reading it as agreement would manufacture exactly the data the plan forbids — *"data that looks like
agreement and is actually absence"*. Acknowledgement therefore needs an explicit tap on the
announcement, offered only on the prominent one; a quiet line's silence stays recorded as unknown.

**2. The announcement leads the sheet.** `vs_yesterday` was placed first because *"a question placed
after two the owner skips inherits their fate"*. The two it was escaping are gone, and the
announcement is now the thing he is meant to read — the plan's named failure mode (§3) is him not
reading it, so burying it under a question that collected 2 of 82 would be that failure by
construction.

**3. Recovery is written `null`, not a neutral.** It is no longer asked and has no verdict to
announce in its place — there is no recovery model. Null is the honest value for a question not put.

## ⚠ Removing the scales removed an invariant nothing named

`dayCheckinHasAnswers` (Q-465) rejects a check-in body with no answer in it: a **400** on the web
route, and in `pushMutations` a **poison pill with no retry**, which drops the check-in permanently.
Its own header explains why it has never fired in real use —

> *"Both live writers always send at least two numeric scales, because their state initialises from
> `NEUTRAL_SCALES` rather than from null."*

**That is the property this change deletes.** And it cannot be answered by simply not writing a row:
the sheet's auto-open (`session-select-content.tsx`) re-prompts until a row exists for the day, so a
skipped save makes the sheet reappear forever.

So `saveSleepValue` always returns a number — the correction, else the announced verdict, else the
neutral fallback for a day with no verdict (baseline still filling, or the ring has not drained). All
three are untouched unless he corrected, so `answeredMorningScales` nulls every one that is not his.
The unit test calls `dayCheckinHasAnswers` directly on the result rather than describing the rule.

## Verified

- **`components/checkin/__tests__/save-sleep-value.test.ts`** — 7 tests: the hard constraint (only a
  correction is touched), the numeric invariant against the real `dayCheckinHasAnswers`, invisibility
  to readers via the real `answeredMorningScales`, and the verdict ordering asserted as an ordering
  rather than as literals, so an inversion that still type-checks fails.
- **`e2e/tn82-checkin-announce-and-correct.spec.ts`** — 5 tests at 384 px dark, asserting the **POST
  body**: the two scales are absent, the reason is stated with its numbers, an untouched save writes
  `sleepQualityFeel: 4, touched: false` with `perceivedRecovery: null`, and one tap on *Great* writes
  `1, touched: true`.
- **Control-run five ways, each mutation asserted as applied.** Unit: auto-fill sets `touched: true`
  → *"an announcement he never answered must not read as a self-report"*; the fallback returns null →
  the `dayCheckinHasAnswers` assertion fails; the mapping inverted → the ordering fails. E2E: the
  sheet reverted to `main` → *"the sleep scale is still being asked"*; auto-fill touched →
  *"an auto-fill flagged itself as HIS answer — this is TN-57"*.
- Rendered at 384 px dark: *"Slept 5h10, 1h20 short of your usual. Marked this a poor night."*, five
  chips, *That's right*.
- `npx tsc --noEmit` clean · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors · full
  `pnpm test` green · `pnpm build` clean.

## The bug the e2e caught that no review would have

The verdict fetch was placed in the sheet's existing init effect, which lists `loaded` in its deps
and **ends by setting it** — so it tears itself down and re-runs once per open, and its cleanup flips
the `cancelled` flag the first run's callbacks close over. Harmless for state set synchronously,
fatal for a network read: the fetch resolved, found `cancelled` true, and dropped the answer. **The
sheet then showed no announcement at all, which is indistinguishable from a night with nothing to
say.** It now has its own effect keyed on `[open, tz]`.

## Not exercised

**Not device-verified, and the sheet is the canonical daily surface.** The local store is on its
write path and `getLocalStore` returns null in the web sandbox, so every run above took the **API
fallback** — the local-first save, and therefore the offline correction, has not executed once. A
Known-Issues row records what a device pass owes. The copy is `TN-84`'s (`Lane: O`) and is not
settled: this ships `verdictCopy()`'s existing wording, which is what the owner approved the *shape*
of, not the sentence.

<a id="2026-09-28-docs-bf77-shared-library-plan"></a>

# 2026-09-28 — BF-77: the shared food library, planned

**Lane A · docs-only planning PR.** The owner asked on 2026-09-20 for *"the most efficient way to
share a food library"*, and on 2026-09-25 chose to have an agent run the session.

- **Plan:** `docs/superpowers/plans/2026-09-28-shared-food-library.md`. **Recommended design:** browse
  an opted-in friend's saved meals and copy one, or all of them.
  - It reuses `friendships`, the unchanged `saveSharedMealToLibrary` and `savedMealToIngredients`.
  - The opt-in is a `users.preferences` flag (jsonb), so there is **no migration** and no new sync
    domain.
- **Why not a group library:** it would couple two users' data, which BF-57 and BF-58 each declined,
  and an edit would rewrite a meal someone else already logged.
- **Why not a share code:** it only solves remote sharing of one meal, the smallest of the four gaps.
- **Corrected a stale claim.** The backlog said the label still encodes the owner-only token. It
  encodes the full recipe for every style that carries one, so BF-57's surface had already shipped.
- **Queue:** BF-77 is rewritten as the engine entry (Lane A), and BF-77a is the surface entry
  (Lane B, `Needs: BF-77`).
- **Not built:** nothing. The "updated since you copied" badge (plan §5) is deliberately left unfiled
  until the owner asks.

<a id="2026-09-28-docs-rv166-walk-completion-feeds-run-planner"></a>

# 2026-09-28 — RV-166 stopped before it shipped a planner bug; the engine half filed as LB-179

**Lane B.** Branch `docs/rv166-walk-completion-feeds-run-planner`. Docs only — no code, no version bump.

## What happened

`RV-166` was next in the Lane B queue, approved by the owner on 2026-09-27 with a mockup, and fully
specified. Re-verifying it against `main` before building — which is the standing rule and is the only
reason this was caught — turned up two things the entry did not have.

## 1. The root cause, which the entry never identified

`RV-166`'s title is *"no prescribed run has ever been marked done"*. The mechanical reason is **two
lines**: `components/activity/done-activity-screen.tsx:285` and `:322`, both
`if (activityType === 'run' && prescribedRunId)`. The owner logs walks, so `linkPrescribedRun` never
fires.

Everything the completion needs already exists — the `prescribed_runs.status`/`activityLogId` columns,
the `prescribed_run` outbox domain, the local-store write, and `PATCH /api/running-plan/runs/[id]`. So
this was never missing plumbing. It is a type guard, which makes the remaining build the card, not the
mechanism.

## 2. The reason it is not a two-line fix — and this is the finding

`prescribed_runs.status` is read by **the planner**, not only by display, and nothing records *how* a
row was satisfied. Three readers, all found by sweeping for readers rather than by reading the entry:

| Reader | What a walk does to it |
|---|---|
| `assemble-plan-context.ts:81` | `HARD_RUN_TYPES.has(r.runType)` feeds `hoursSinceLastHardRun`, its own comment calling it *"real no-back-to-back-quality protection"*. A treadmill walk completing a prescribed tempo tells the gate a quality session happened and **suppresses the next one**. |
| `assemble-plan-context.ts:97` | `runsThisWeek` — the 80/20 sequence and weekly frequency. A walk advances the framework toward an interval day. |
| `run-type-stats/route.ts:35` | Pulls `distanceKm`/`avgPaceSecPerKm`/`avgHr` off the linked log, filed under the **prescribed** `runType`. A ~12 min/km walk lands in "easy run" pace stats. |

**The decisive detail is a comment already in the file.** `assemble-plan-context.ts:97` reads *"Only
COMPLETED runs count toward the week's 80/20 sequence — a never-run pending row … must not advance the
framework toward an interval day (E2-7)"*. This repo has already been bitten by a non-run advancing the
framework and fixed it. `RV-166` as approved walks a walk straight through the same guard by a
different door. The first reader is worse than a wrong statistic: it changes what the app tells him
to do.

The entry and the mockup both warn *"this changes stored numbers … quantify how far before merging"*.
Neither names a reader, and neither mentions the planner. That warning was about adherence and streaks.

## What shipped

Docs only, in the queue:

- **`LB-179`, `Lane: A`** — the engine half, placed at **position 10** for Lane A (below every
  security item above it, inside `next-item.js`'s ten-row default view, because an entry that blocks an
  approved build is no use at rank 25 where it first landed).
- **`RV-166`** gains the root cause and `Needs: LB-179`, so it now parks for Lane B rather than looking
  startable. Verified with `next-item.js`, not by reading: RV-166 moved to PARKED, LB-179 prints at 10.

## The recommendation on LB-179, and why

**Record how the prescription was satisfied on the row (`completedAs: 'run' | 'walk'`) rather than
re-deriving it per reader.** The completing client knows the activity type at the moment it links the
row; every reader otherwise joins back to the activity log for a fact that was known when it was
written. `assembleInputs` **does not fetch activity logs at all** — its `Promise.all` takes prescribed
runs, loads, workouts, sleep and Oura — so deriving means adding a query to a hot path and repeating it
in three readers now and every reader later. It also matches the convention `RV-166` itself cites:
`observed-hr.ts`'s `source: 'observed' | 'estimated'`.

The alternative is written into the entry with what it is genuinely better at: deriving from
`log.activityType` ships today with no migration, and for `run-type-stats` — which already loads the
logs — it is a one-line filter. It loses on the two planner readers, which is where the defect is.

It needs a migration and a local SQLite version, so it is **Lane A's alone** per the standing rule, and
that is why this is a hand-off rather than something I built.

## Deliberately not done

- **No backfill**, and the entry says so: every existing `completed` row was necessarily a run, because
  the link only ever fired for `activityType === 'run'`. `null` means *satisfied before this was
  tracked* and reads as a run.
- **The card is not built.** `RV-166`'s *Today's cardio* card, the zone-stated criterion, the
  `Walk it` route sheet and the `estimated` marking all remain its own work, once `LB-179` lands.
- **The "how many days move" figure is not measured.** `RV-166` still owes it before merging; nothing
  here answers it.

**Not exercised:** no code changed, so nothing was run beyond the doc gates and the queue tools. The
three readers were established by reading source and their own comments, not by observing a walk
complete a prescription on a device — that observation is `RV-166`'s to make once it is buildable.

<a id="2026-09-28-e2e-back-over-the-cap"></a>

# 2026-09-28 — LB-166: E2E is back over its cap, and this lane spent the margin

**Lane B.** Branch `docs/e2e-over-cap-again`. Docs only — no code, no version bump.

## The measurement

Two consecutive E2E runs hit the 45-minute job limit:

| run | head | duration | result |
|---|---|---:|---|
| `36456542521` | #1926 | **46m41s** | `cancelled` |
| `36458784138` | #1927 | **45m17s** | `cancelled` |

Against the three censuses taken earlier the same day — **35.5 / 36.3 / 36.6 min** — that is a
**~9–10 minute regression inside one day**.

## ⛔ Why it is worse than a slow job

**A run killed at the cap uploads no artifact.** Run `36458784138` has **zero**. The cancel lands
before the upload step, so the `playwright-report` that holds the retained **first attempt** of every
flaky test — the method `LB-178` now depends on entirely, and the thing that root-caused `tn53` and
found `LB-184` — does not exist for a capped run.

So E2E has gone from *advisory* to **no signal**: no pass/fail worth reading, and no evidence to read
afterwards. The census that would measure `LB-184`'s effect cannot be taken until this is fixed.

## Where the time went, and it is mostly mine

This lane added **four spec files** on 2026-09-28: `lb163-log-tiles-three-column` (1 test),
`la136-home-sleep-feel-line` (2), `tn82-checkin-announce-and-correct` (3),
`rv119-home-banner-strip` (1). Seven tests, each driving a full Home load, measured locally at
roughly **1.2–1.6 min per file**. That accounts for most of the regression.

**Each is justified on its own entry, and that is the point.** Nothing weighs them together. The
suite has no budget line, so no single decision was wrong and the ceiling was crossed anyway.

`LB-178` dates the margin precisely: *"at 36.3 min the suite finished UNDER the 45-minute cap, where
it had been hitting it. Six specs that each burned a timeout before failing were most of the
difference, so clearing `LA-176` bought back roughly the margin the cap was eating."* That margin was
about nine minutes wide, and it is gone.

## The recommendation on the entry

**Shard E2E the way `Tests` is already sharded** — four jobs and a rollup — rather than raising the
cap, which buys a few more months of the same. Sharding also makes a capped run *impossible* rather
than merely less likely, which is what protects the artifact.

Whichever is chosen, **a per-PR check on total E2E wall-clock belongs with it**, or this recurs
silently: the tell is a `cancelled` that ran ~45 minutes, and that is indistinguishable from the
harmless superseded-push kind without reading the duration.

## Not exercised

**Nothing is fixed here.** `LB-166` is parked on `LB-149`, and the fix is a CI-workflow change; this
records the measurement so the entry is worked from figures rather than from the 2026-09-27 ones,
which no longer describe the suite. The attribution to this session's four specs is **arithmetic on
local timings**, not a measured per-spec breakdown on CI — a capped run publishes no report to break
it down with, which is the same problem one level up.

<a id="2026-09-28-error-boundary-retries-chunk-load"></a>

# 2026-09-28 — LB-184: a chunk that did not arrive is retried, not shown as a crash

**Lane B.** Branch `fix/error-boundary-retries-chunk-load`. v1.481.1.

## Where this came from

`LB-178`'s third cause, found by reading the retained first attempt of a failing E2E run: Home had
crashed to the root error boundary with

> Failed to load chunk `/_next/static/chunks/components_activity_exercise-detected-card_tsx_….js`
> … (ecmascript, next/dynamic entry, async loader)

The spec's assertions never ran and it reported *"the sheet never auto-opened"*, which reads as a
broken feature.

## Why this candidate rather than the other two

Three fixes were available: drop `next/dynamic` for that card, build the app for E2E instead of
running `next dev`, or teach the boundary to retry. **The third is the only one that is also a
user-facing fix.** On the device a transient chunk fetch — a patchy moment on mobile data — put the
owner on an error screen until he tapped *Try again*. And the boundary already half-agreed with
this: its own comment calls an **offline** chunk failure *"expected"* and it auto-recovers on the
`online` event. Online, it dead-ended.

Building for E2E is still the structural answer to `next dev` compiling on demand, and it is
`.github/` rather than this lane's, so it stays open on `LB-178`.

## What it does

- **`lib/chunk-load-error.ts`** — `isChunkLoadError()`. Its own module because the strings come from
  three producers (webpack/Turbopack, Next's `next/dynamic` async loader, the native ESM loader) and
  because the decision it drives makes a false positive expensive.
- **`app/error.tsx`** — retries once, after 400 ms, **only while online**.

**The guard is module-level, and that is load-bearing.** `reset()` re-renders the errored segment,
so a failing retry remounts the boundary — a `useState` or `useRef` guard would be reset along with
it and the page would reload forever.

**The first failure is deliberately not reported.** A chunk that arrives on the second attempt is
noise; one that does not comes straight back through the boundary with the retry already spent, and
is reported then — once, and only when it is real.

**The match is deliberately narrow.** A false positive silently reloads a screen that was genuinely
broken, which hides a defect and is strictly worse than the dead end being removed.

## Verified

- **`lib/__tests__/chunk-load-error.test.ts`** — 5 tests. The **verbatim** message from the CI
  screenshot is asserted, alongside the other three producers' forms, and six near-misses that must
  NOT match (`Failed to fetch`, a hydration mismatch, a bare `chunk`, an ordinary TypeError). Two
  more pin the boundary's wiring: the guard is module-level, and the retry never fires offline.
- **Control-run three ways, each mutation asserted as applied:** loosening the match to any `chunk`
  → the near-miss case fails; the guard demoted to a `const` that is never set → the module-level
  assertion fails; dropping the `!isOffline` condition → the offline assertion fails.
- `tsc` clean · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors · full `pnpm test` green ·
  `pnpm build` clean.

## Not exercised

**The retry itself was never observed firing.** Provoking a real chunk-load failure needs either a
dev server mid-compile or a throttled network, and neither is arrangeable in the harness — so the
classifier is tested by calling it and the wiring by reading it, not by watching a screen recover.
**Whether this reduces the E2E churn is measurable and unmeasured**: the next census is the test.
Not device-verified, and the device case — a transient fetch failure on mobile data — is exactly the
one no sandbox can produce.

<a id="2026-09-28-health-says-couldnt-load-not-no-data"></a>

# 2026-09-28 — LB-176: Health stops describing the account when it means the request

**Lane B.** Branch `fix/health-says-couldnt-load-not-no-data`. v1.478.4.

## What shipped

Cold at 412 px with every `GET /api/*` failing, the Health screen made a dozen statements about the
owner's account that were really statements about failed requests. All of them now say which happened.

| Site | Was | Now, when the read failed |
|---|---|---|
| `Dist`, `Burned`, `BMI`, `Balance` (`health-sections.tsx`) | "No data" | "Couldn't load" |
| `Resting HR`, `HRV`, `SpO₂` (`rhr-hrv-spo2-card.tsx`) | "No data" | "Couldn't load" |
| weight sparkline | "Not enough data" | "Couldn't load" |
| Weight Trend | "Log body weight to see trend" | "Couldn't load your weight trend" |
| `hr-day-card.tsx` + `heart-rate/page.tsx` | "No HR captured yet today — the ring records periodically while worn." | "Couldn't load today's heart rate." |
| `activity-history-card.tsx` | "No activities this week" | "Couldn't load this week's activities" |
| `nutrition-activity-trends-card.tsx` | "No nutrition/activity trends yet." | "Couldn't load your nutrition and activity trends." |
| `training-load-card.tsx` | "Not enough data yet" | "Couldn't load your training load" |
| **energy budget** | **"Set up your energy budget — Add your height, age and sex in Profile"** | "Couldn't load your energy budget" |
| `goals-progress-card.tsx` | *card vanished* | "Couldn't load your goals" |

Seven reads gained an `onError` (`body-metadata`, `training-load`, `sleep-performance-correlation`,
`progress-summary`, `user-goals`, `oura-hr-day` ×2, `activity-logs`, `health-trends-summary`), and
`useEnergyBalanceToday` now forwards an optional `opts` so its caller can hear a failure at all.

## The copy was already settled — I did not invent it

The entry asked to "settle the copy once". It turned out the repo had already settled it:
`movement-balance-card.tsx` and `weekly-stats-hub.tsx` have said **"Couldn't load your …"** through
`EmptyState` since before this entry existed. So cards use `EmptyState` with that sentence, and the
2-column metric cells use the same sentence trimmed to the one `text-xs` line they already had —
`EmptyState` is `py-8` centred and far too tall for a tile. One local `CellEmpty` helper decides it.

## The worst case, and why it was worse than the entry said

`energyBalance` is `null` while loading, on a failed read, **and** for an account with nothing stored,
and the branch sent all three to `EnergyBudgetPrompt` — *"Add your height, age and sex in Profile"*. So
a request that did not land told the owner to redo something he did months ago, **and a cold load
flashed the same instruction before the payload arrived**, which the entry did not mention.

Worth recording for whoever touches it next: **a genuinely incomplete profile never reaches that
prompt.** The service always returns `missingProfileFields`, and a non-empty one routes to
`CalorieBalanceBar`, which names the fields actually missing instead of guessing three. That makes the
prompt's remaining branch hard to reach — but "unreachable" is not proven, so it stays rather than being
deleted on an assumption.

## Two corrections to my own entry

- **`trends-section.tsx` was never broken.** It already prints "Couldn't load this trend." for a null
  payload, and its "Not enough data yet" fires only when the payload itself says insufficient. The
  entry listed it; reading it removed it.
- **`sleepVsPerformance` is a vanish, not a lie.** `health-sections.tsx` rendered it only when
  `sleepCorr` was non-null, so a failed read removed the card entirely rather than mislabelling it —
  RV-150's class, not this one. Fixed anyway, since it is the same rule's other half.

## The size check refused it, and the extractions were owed anyway

`check-component-size` failed: `health-sections.tsx` went from 773 to 833 against an 800-line limit —
it was already within 27 lines of the ceiling. Three things came out, each to where it belonged rather
than trimmed to squeeze under:

- **`components/health/cell-empty.tsx`** — the shared copy decision. A rule about what every metric
  cell says has no business inline in one screen's switch.
- **`components/health/body-cards/weight-trend-card.tsx`** — a ~55-line self-contained card.
  `rhr-hrv-spo2-card.tsx` came out of the same file for the same reason, so the folder and the
  precedent already existed.
- **Two long notes moved onto the components they describe** — the energy-budget reachability analysis
  to `energy-budget-prompt.tsx` (where someone changing that copy will actually read it) and the
  vanish note to `sleep-vs-performance-card.tsx`.

**Final: 755 lines — 18 FEWER than before this fix**, while adding it. I re-ran the e2e after the
extractions specifically because the card's JSX was moved by script rather than by hand.

## Verified

- New unit guard `app/health/__tests__/lb176-failed-reads-say-so.test.ts`, 13 cases,
  **control-run five ways with each mutation asserted as applied**: dropping the `body-metadata`
  `onError`, dropping the `hr-day` one, putting the prompt back in the null branch, restoring the Goals
  vanish, and stopping the hook forwarding `opts` each fail exactly one case. Restored 13/13.
- **`e2e/rv150-failed-read-says-so.spec.ts` extended with three Health cases and RUN, not just
  written: 7 passed in 1.7m** (`-g Health`, which also picks up the two existing healthy-cold tests).
  That matters because the entry's "Done when" is a rendered observation — *"a cold start with the
  reads failing shows no cell claiming 'No data'"* — so asserting it in a file I had not executed
  would have been marking it fixed from intent. Includes the **healthy-cold control** the entry asked
  for by name: without it, a component that always rendered "Couldn't load" would pass the other two.
  The failure case asserts `toHaveCount(0)` on the literal "No data", so it cannot be satisfied by
  fixing one tile and leaving its neighbour.
  **First attempt failed for an environment reason worth writing down:** `zero-data.setup.ts` errors
  with *"DATABASE_URL must be set"* because this sandbox's shell snapshot unsets it, so the setup
  project fails and the specs never run — reading that as a code failure would have been wrong. Pass
  the TCP URL explicitly (`DATABASE_URL='postgresql://postgres:postgres@localhost:5433/trainingai_dev'`).
- `npx tsc --noEmit` clean · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors · full
  `pnpm test` green · `pnpm build` clean.

**⚠ The guard was wrong four times before it held, and every time `indexOf` had found the wrong
occurrence** — a `readCacheSync` seed sharing a cache key with the fetch under test; a key written with
double quotes where the pattern allowed only single and backticks; a `case "energyBudget"` in
`isSectionVisible` that just `return true`s, ahead of the render arm; and a paren-matching bound applied
to a `{}` block, which walked backwards past the anchor and returned an empty string. Each failed
against *correct* code, which is the tell. **The first match is not the match.**

**Not exercised:** not device-verified. The e2e reproduces the cold-failure case at 412 px in
**Chromium**, not in Samsung's WebView, so the copy has been observed rendering under the real
condition but not on the S25. Nothing offline-first, native, safe-area,
gesture or notification is touched; this changes only what a card prints when its own read failed.

<a id="2026-09-28-home-banner-registry-render-loop"></a>

# 2026-09-28 — RV-119 crashed Home, and the registry's `report` was the cause

**Lane B.** Branch `fix/home-banner-registry-render-loop`. v1.481.2. **A regression shipped earlier
the same day, in v1.481.0.**

## What was broken

Home died on the root error boundary with **"Maximum update depth exceeded"** — an infinite render
loop — when one of the four collapsing banners changed its presence after mount. A weekly recap
going *loading → error* is the reliable way to reach it, which is why a 429 stub reproduced it every
time.

## The mechanism, and why my own guard did not save it

`HomeBannerPresenceProvider` built `report` **inside** the `useMemo` keyed on `present`, so it was a
new function every time presence changed. `useReportBannerPresence`'s effect lists `report` as a
dependency — it must, since a stale `report` would write into a dead provider — so **every presence
change re-ran every banner's effect**, each of which calls `report` again.

The registry already had `if (prev.has(key) === isPresent) return prev`, and I wrote *"no state
write, so no render loop"* beside it. **That comment was wrong.** The bail-out prevents a state
write; it does not prevent the effects being re-scheduled, because the identity change has already
happened before any of them runs. With a banner whose presence legitimately flips, the cycle never
settles.

**The fix is one `useCallback` with an empty dependency list.** `useState`'s setter is stable, so
`report` never needs rebuilding, and the effect then re-runs only on a real change.

## How it was found, and why nothing caught it sooner

Running an **E2E shard locally** for `LB-166`. Shard 1 came back **13 failed**, and the Home specs
in it — `bf205-home-section-drag`, `calorie-progress-bar`, `day-rollover-checkin` ×3,
`dv22-status-bar-scrim` ×2 — were not failing on their own assertions at all. **Home had crashed, so
everything that visits Home failed.** All nine pass again with the fix.

**Three things had to line up for this to ship:**

1. **RV-119's own e2e did not reproduce it.** It drives Home with the banners in a steady state; the
   loop needs a presence *change* after mount.
2. **The sibling sweep missed `card-429-error-state`.** I updated the unit guard that pinned the
   recap banner's file and never looked for an e2e asserting it on screen — which is the spec that,
   once corrected, caught this.
3. **CI could not tell me.** Both E2E runs since RV-119 merged were **cancelled at the 45-minute cap
   and reported nothing** (`LB-166`). The no-signal state hid a crash I introduced, the same day.
   That is a far better argument for sharding than anything written in that entry.

## The spec that found it, and what it now asserts

`card-429-error-state.spec.ts` guards Q-499's rule — a card says it failed rather than silently
vanishing. Under RV-119 that guarantee became two halves, and both are asserted now:

1. **the strip advertises it** (`N ready`, naming *Week in review*), so the failure is visible on
   Home at all; and
2. the message and its retry are **attached**, behind the approved collapse.

**Half 1 is what caught the crash** — with Home on the error boundary there was no strip at all.
`toBeAttached` rather than `toBeVisible` for half 2, because the container is hidden until tapped and
that is the approved information architecture, not a defect. Expanding is deliberately not re-driven
here; `rv119-home-banner-strip.spec.ts` already taps the strip and asserts visibility.

## Verified

- The exact context that reproduced the crash now renders the strip, counts the failed recap, and
  does **not** hit the error boundary.
- `card-429-error-state.spec.ts` — **7 passed**.
- `bf205-home-section-drag`, `calorie-progress-bar`, `day-rollover-checkin` — **9 passed**, having
  all failed in the shard run.
- `npx tsc --noEmit` clean · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors · full
  `pnpm test` green · `pnpm build` clean.

## Not exercised

**No automated guard stops the registry regressing to an unstable `report`** — the protection is the
e2e above, which only fails when a banner's presence actually changes during a run. A stability test
would need a React renderer, which this repo does not use for components. **Not device-verified**,
and the crash was never observed on the device: the harness reproduction is a 429 stub, and whether
real timing reaches it as readily is unknown — it plainly could, since nothing about the loop needs a
failure, only a presence change.

<a id="2026-09-28-home-banner-strip"></a>

# 2026-09-28 — RV-119: Home's banners split by severity, four behind one strip

**Lane B.** Branch `fix/home-banner-stack-collapse`. v1.481.0. Batch `home-ia-merge`, closed.

## What shipped

Built to [`docs/design/2026-09-28-home-banner-stack.html`](../design/2026-09-28-home-banner-stack.html)
option **A**, which the owner picked on 2026-09-28.

- **`components/home/home-banner-stack.tsx`** (new) — the stack, extracted out of
  `session-select-content.tsx`, which also clears the queued file-size task on those lines.
- **`components/home/home-banner-strip.tsx`** (new) — the collapsed row: icon chips, a count, a
  chevron.
- **`components/home/home-banner-presence.tsx`** + **`home-banner-keys.ts`** (new) — the registry.

**Two stay full-width, and the split is by severity rather than by height.** The illness advisory
and the early-deload warning are things he should see *today*; collapsing them beside a weekly recap
is how they get missed. The other four — an activity to review, the goals check-in, the day review,
the weekly recap — are all "ready for you", which is what makes grouping them honest.

**The failure was cumulative, not individual.** Each banner self-hid and each was correct alone; on a
Monday after a detected walk with an early-deload flag he scrolled past five cards to reach the
recommendation, which is the thing he opens Home for.

## The problem the entry does not mention

**Two of the four decide their own visibility and `return null`.** `ExerciseDetectedCard` reads its
own pending sessions; `WeeklyRecapBanner` its own dismissal, and whether a recap exists at all is
decided one level further down, in its child. From outside, all four look parent-controlled — so a
strip that says *"4 ready"* and draws one icon per waiting banner has no way to know what to draw.

Hoisting those reads into the parent would duplicate two non-trivial conditions and give them a
second place to drift. So each banner keeps deciding for itself and **reports**:
`useReportBannerPresence(key, present)`, above its early return because a hook cannot be skipped, and
a no-op outside Home's provider so each component still works anywhere else.

**And the two that *are* parent-controlled never get to report for themselves** — when their
condition is false they are not rendered at all — so the stack reports those. Missing that half
undercounts the strip *silently*: it still renders, just with fewer icons and a smaller number,
which looks exactly like a correct quiet day. I shipped the first version without it.

## The structural call the entry left to me

**The four are hidden, not unmounted, and they keep their own dismiss controls.** The entry lists
losing those as the accepted cost of option A. It is not paid here: expanding shows the real
banners, with the controls they already have. Unmounting would also take them out of the registry
the count comes from, so this is load-bearing twice over.

The strip itself has **no dismiss** — it is an expander, which is what the mockup draws (a chevron,
not an ×). A "dismiss all" would let one tap hide four unrelated things, and two of them
(`goalsCheckin`, `dayReview`) already have their own per-day dismissal.

## Verified

- **`components/home/__tests__/rv119-banner-stack-split.test.ts`** — 5 tests pinning the severity
  split: the illness advisory is not in the stack at all, the early-deload card is in it but *not*
  inside the collapsed container, all four agreed banners are, and they are hidden rather than
  conditionally rendered. It self-checks that it found the container, so it cannot pass by matching
  nothing.
- **`e2e/rv119-home-banner-strip.spec.ts`** — at 384 px: the strip renders, reports a real count,
  the four are hidden while collapsed, tapping expands **in place** (URL unchanged), the expanded
  banners still carry their own controls, and it collapses again.
- **Control-run three ways, each mutation asserted as applied:** the early-deload card moved behind
  the strip → *"it is a today thing, by the owner's split"*; the four conditionally rendered →
  the container self-check fires; the parent reverted to `main` → *"the banner strip never
  rendered"*.
- Rendered at 384 px dark: `1 ready` with the recap's icon, expanding to reveal the banner.
- `tsc` clean · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors · full `pnpm test` green ·
  `pnpm build` clean.

## Two spec mistakes, both found by the screenshot

1. **It pinned the wrong banner.** It drove through "Your day in review is ready" by clearing that
   day's dismissal key; the seeded account's waiting banner is the **weekly recap**. The failure read
   *"expanding did not reveal the banner"* while the screenshot showed the strip working perfectly.
   It now asserts on the container, not on one banner.
2. **`getByRole('button', { name: /ready/ })` matched a BANNER, not the strip** — "Your week in
   review is ready" contains the word. The control run against `main` therefore failed on the wrong
   assertion, which reads as a broken strip rather than an absent one. Pinned by test id.

## Also struck

**`LB-135`** — its job was exporting the lost 2026-09-22 mockup; that artefact is unrecoverable and
the redraw superseded it. The entry was already marked closed and said *"Strike this entry"*, and it
was still in the queue.

## Two findings that came out of CI while this was in progress

**`tn53`'s seed-state fix (#1925) holds on CI** — it is absent from the failures of the E2E run on
its own merge head, which is the confirmation that PR said it was still owed.

**That same run gave `LB-178` a third cause, and it is not in the specs at all.** It failed
`tn82-checkin-announce-and-correct`; the retained screenshot shows Home crashed to its error
boundary with *"Failed to load chunk … `exercise-detected-card` … (next/dynamic entry, async
loader)"*. The assertions never ran, and the spec reported *"the sheet never auto-opened"* — which
reads as a broken feature. `pnpm e2e` runs against `next dev`, which compiles on demand, so a
`next/dynamic` chunk request can fail while it is being built, on whichever spec happens to be on
Home at that moment. **That explains the churn the entry could not**: a failure that lands on
whatever is running produces a different flaky list every time.

**This change moves that dynamic import but does not alter it** — `ExerciseDetectedCard` is now
loaded from `home-banner-stack.tsx` instead of `session-select-content.tsx`, with the same
`dynamic(..., { ssr: false })`. Converting it to a static import is a real decision (the `ssr: false`
is deliberate), so it is recorded on `LB-178` rather than taken as a drive-by here.

## Not exercised

**Not device-verified, and the entry owes a device look explicitly** — the mockup's heights are
drawn to scale relative to one another, **not measured on a device**, and a real screenshot needs all
six banner conditions true at once, which no sandbox can arrange. The harness run had exactly **one**
of the four present, so the multi-icon strip and the four-banner expansion were **never rendered**;
the count logic is covered by the registry, not by a picture of it. No offline-first, native,
safe-area, gesture or notification surface is touched.

<a id="2026-09-28-home-log-tiles-three-column"></a>

# 2026-09-28 — LB-163: Home's Log tiles fill the row, and Log comes off the icon

**Lane B.** Branch `feat/home-log-tiles-three-column`. v1.478.7.

## What shipped

`app/session-select/components/metric-tiles-card.tsx`, built as approved on 2026-09-27 from
[`docs/design/2026-09-27-four-screen-mockups.html`](../design/2026-09-27-four-screen-mockups.html):

- The container is a **fixed three-column grid** (`grid grid-cols-3 gap-2`) instead of a
  `flex … overflow-x-auto` row of `min-w-[76px]` tiles. The tiles sized to content and the row did
  not, which is what left the right third of the row empty at 384 px.
- **`Log` moved out of the absolute layer into the flow**, below the value, as a full-width pill.

**The 44 px tap target is kept, deliberately.** The overlap came from the *positioning* — an
`absolute top-0.5 right-0.5` pill carrying `min-h-11` — not from the size. Shrinking the control would
have traded a layout bug for an accessibility one, and the entry says so; the spec asserts the 44 px
floor so a future "fix" that shrinks it fails.

**Accepted trade, stated on the approved mockup:** a fourth widget wraps to a second line rather than
scrolling sideways. `overflow-x-auto` goes with the flex row.

## Verified

- **`e2e/lb163-log-tiles-three-column.spec.ts` — measured, not screenshotted**, because the entry
  states its acceptance in measurable terms: at 384 px the row fills the width, and `Log` does not
  overlap the icon at any tile count. It asserts a 3-column grid, that the tiles plus their gaps
  account for the container width, and per tile that the `Log` box does not intersect the icon box,
  sits below it, and is ≥ 44 px tall.
- **Control-run both ways, each mutation asserted as applied:** reverting the file to `main` fails on
  *"expected a 3-column grid, got none"*; keeping the grid but restoring only the absolute pill fails
  on *"tile 0: the Log control still overlaps the icon"*. The second control exists because the first
  never reaches the overlap assertion, which is the entry's headline defect.
- Rendered at 384 px dark and compared against the approved mockup: three even columns, icon, value,
  unit, then the `Log` pill — no overlap.
- `npx tsc --noEmit` clean · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors · full
  `pnpm test` green · `pnpm build` clean.

## Two things the spec got wrong first, both of which would have passed while measuring nothing

1. **It skipped itself.** The first run found zero tiles on the seeded account and took the
   `test.skip(count === 0)` branch — reporting green having measured nothing. The tiles are now
   **pinned on** by the spec (`ta_ss_widgets`, plus `ta_home_section_order` and
   `ta_home_hidden_sections`, because `metricTiles` is a Home *section* as well as a set of widgets),
   and the skip is replaced by a hard assertion that tiles rendered.
2. **It measured a skeleton.** Even pinned on, the count was zero — `settleRouteBoundary` returns
   while Home is still painting placeholder blocks. The failure screenshot showed that plainly; the
   spec now waits for the first tile to be visible before measuring. **Reading the screenshot is what
   found it** — the count alone looked like a preference problem for the second time running.

## Not exercised

Not device-verified. The geometry was measured in Chromium at 384 px, which is the width the mockup
was approved at, but it is not a Samsung WebView — and the accepted trade (a fourth widget wrapping)
was not exercised, because the fixture pins three. No offline-first, native, safe-area, gesture or
notification surface is touched.

<a id="2026-09-28-home-sleep-feel-line"></a>

# 2026-09-28 — LA-136: Home shows the sleep rating he actually gave

**Lane B.** Branch `feat/home-sleep-feel-line`. v1.479.0.

## What shipped

The sleep line returns under the mood card, built to
[`docs/design/2026-09-27-four-screen-mockups.html`](../design/2026-09-27-four-screen-mockups.html)
§LA-136 as approved 2026-09-27 — divider, purple moon, his own word, five dots and `N/5` at the
right edge, captioned *"Your rating, not a score"*.

- **`lib/hooks/morning-sleep-feel-scale.ts`** (new) — the pure stored-1–5 → label/dot mapping.
- **`lib/hooks/use-morning-sleep-feel.ts`** (new) — the local-first read.
- `userId` threaded `session-select-content.tsx` → `HomeCardWidget` → `SleepFeelLine`, because a
  local-store read needs the store's owner. A stable string, so the widget's `React.memo` is intact.
- **`components/home/sleep-feel-line.tsx`** (new) and one call site in `home-card-widget.tsx`.

**The cost the entry called non-optional is paid — and the entry understated it.** Home is in the
persistent tab shell and never unmounts, so a hand-rolled `useEffect(() => { cachedFetch(…) }, [])`
paints once and holds that value until the app is killed (Q-402, twelve times in this repo).
Something must ask for a new value when a write clears the old one.

**But the entry prescribed `useCachedValue`, and that would have been the wrong half of the rule.**
`day_checkins` is a **local-first domain**: `morning-checkin-sheet.tsx` writes
`store.upsertDayCheckin` + `queueMutation` before it ever reaches the network. A rating given
offline — and a morning with no signal is the ordinary case for this question — exists on the device
and nowhere else until the outbox drains, so a `useCachedValue` read shows **nothing** until then and
blanks again on restart. That is the inverse of offline-first this repo has a strict rule about, and
it is exactly the Q-488 shape: a write that updates the local store behind a UI that reads the
server. So the read is local-first (`store.getDayCheckin(today, 'morning')`, API as the fallback for
a store that is unavailable or unhydrated), which `useCachedValue` cannot own — hence the documented
escape hatch, **`useInvalidationRefetch`**, plus a synchronous `readCacheSync` seed in an effect for
instant paint.

It subscribes to the **existing** `day-checkin:` prefix that the sheet's own
`invalidateCheckinAffectsPrescription()` clears — so "registration in every write group touching
`day_checkins`" is satisfied by reuse rather than by adding a key to each group, and because that
group is called whether or not the push succeeded, the **offline** save refreshes the line too.
`:morning` is required: `day-checkin:<date>` is already the EVENING payload's key. TTL is
`TTL_SHORT`, its sibling's own expression, so no TTL divergence is introduced.

## ⛔ The thing the entry did not say, and the line would have been wrong without it

**The morning sheet writes a neutral `3` for a scale he never tapped.** `NEUTRAL_SCALES` in
`morning-checkin-sheet.tsx` seeds both scales at 3 and saves them unconditionally, with
`sleepQualityFeelTouched: false` recording that he did not answer. So a raw column read puts

> OK · 3/5 · *Your rating, not a score*

on Home for a value nobody gave — **the fabricated `Sleep: OK` this entry exists to undo, down to
the string.** `answeredMorningScales` is the repo's one place that decides "did they answer?", and
its own header records four earlier readers that took the column directly and were calibrating,
plotting and displaying **78 values nobody gave**. This read goes through it. The e2e control that
removes the gate fails with *"an untouched seed reached Home as a rating"*.

**And the scale is stored inverted while its labels are not** — `1 = slept great … 5 = terrible`
against `MORNING_SCALES.labels` running worst → best in *screen* order. `storedOrderLabels` is the
repo's own reverse of that. Getting it backwards tells him he slept terribly after his best night,
which is worse than showing nothing, and no source-matching guard can tell `6 - stored` from
`stored` — hence a unit test that calls the mapping.

## A stated deviation from the drawing

The mockup labelled 4/5 *"Slept well"*; the shipped line says **"Good"**, the word on the scale he
actually taps. This entry exists because Home told him something he never said — showing a rating
back to him in different words than the one he chose is a smaller version of the same thing. The
caption, which the entry names as part of the approval, is unchanged.

## Verified

- **`lib/hooks/__tests__/morning-sleep-feel.test.ts`** — 6 tests. The direction is asserted by
  **calling** the mapping at every point on the scale and against the sheet's own label array
  (derived, not restated), plus the untouched-seed case through `answeredMorningScales`.
- **`e2e/la136-home-sleep-feel-line.spec.ts`** — 2 tests at 384 px dark: a rating he gave renders his
  word, four filled dots (counted by computed colour), `4/5` and the caption, inside the mood card
  and below its content; an untouched neutral 3 renders **nothing**.
- **Control-run three ways, each mutation asserted as applied:** unwire the component →
  *"the sleep line never rendered for a rating he gave"*; drop the touched gate →
  *"an untouched seed reached Home as a rating"*; flip `6 - stored` → the label and position
  assertions fail. Restored, 4 passed.
- Rendered at 384 px dark and compared against the approved drawing.
- `npx tsc --noEmit` clean · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors · full
  `pnpm test` green · `pnpm build` clean.

## Two things that cost a run each

1. **The e2e locator went strict-mode ambiguous, twice.** *"Exercise Readiness"* labels both the mood
   **widget** and a separate readiness **prompt** banner, and both are clickable — so neither the text
   nor the role separates them. The **element** does: the widget is a `div[role="button"]`, the
   prompt a real `<button>`. Both failures read *"the mood card never painted"* while the card was on
   screen the whole time; the error's own accessible-name dump is what showed it.
2. **The pure mapping could not be unit-tested where it first lived.** Importing the hook pulled the
   `.tsx` timezone provider into the unit project and the file failed to transform. Splitting the
   mapping into its own React-free module fixed it and is the better shape anyway.

## Deliberately not done

The entry's **nutrition-prompt half** is not built — it changes what the model is *told* about him
rather than what a screen shows, and `app/api/**` is Lane A. Filed as **`LB-182`** with the
`answeredMorningScales` requirement stated, so it cannot repeat the untouched-seed bug in a prompt.

## Not exercised

Not device-verified. Rendered in Chromium at 384 px, the width the mockup was approved at, which is
not a Samsung WebView. The morning check-in payload was **stubbed at the route**, so the real
`/api/day-checkin` response shape was not exercised — and **neither was the local-first path, which
is the one that matters most here**: `getLocalStore` returns null in the web sandbox, so every run
above took the API fallback. The offline case this rewrite exists for (rate sleep with no signal,
see it on Home immediately, still there after a restart) is **reasoned from the write path, not
observed** — it needs the APK. The live invalidation (answer the sheet, watch the line update
without leaving the tab) is likewise reasoned from `useInvalidationRefetch`'s subscription. No offline-first, native, safe-area,
gesture or notification surface is touched.

<a id="2026-09-28-lane-a-bf110-native-relayout"></a>

# 2026-09-28 — BF-110: re-measure the WebView on resume, and record which layer is stuck if not

The blank-on-resume telemetry answered its own question weeks ago. Every blank resume held a 667 px
viewport (a WebView's fallback) against the S25's 826, and a recheck 500 ms later read `stuck` on
25 of 25. That is a stuck viewport, not a late one, so the fix is native, and nobody owned it.

`MainActivity.onResume` now asks the WebView to re-measure against its parent immediately and again
at 250 ms. A return from picture-in-picture or recents can settle its window size a frame late, and
a layout pass with an unchanged size does nothing, so it is harmless on a healthy resume. It may
not be enough: if only Chromium's viewport lags a correctly sized view, a relayout cannot reach it.
So `AndroidRenderer.viewHeights()` exposes the WebView's and its parent's heights, and the recheck
breadcrumb appends them. The next blank resume then says either `resized` (fixed) or which layer
to fix next, and the entry's `Verify:` spells out both readings.

Java compiled locally (a typo in the new code fails the build), and the JS tests cover the message
and a bridge that is absent or throws. Verification is the owner's own telemetry after the APK
installs.

<a id="2026-09-28-lane-a-or202-readable-schema-number"></a>

# 2026-09-28 — OR-202: `next-schema-number.js` prints a page, not a wall

A run printed **470 KB**. About 100 stale branches still hold the `claude_ro_views` migrations that
BF-214 ① deleted, and each was listed once per branch; number 274 alone named one file on 44
branches. `summariseClaims` (`scripts/lib/migration-claims.js`) now collapses a (number, file)
claim to one line with `origin/a, origin/b +N more`. It also drops the dead pattern, reporting only
a count of the stale branches, and a collision whose only other claimant is that pattern is no
longer a collision. The same run is now **1.2 KB**.

The real collision that had been hidden now shows on its own line:
`273_exercise_media_review_status.sql (merged) vs 273_vendor_table_rename_phase_3.sql
(origin/lane-a/q44-phase3-pr1-table-rename)`. That branch has no open PR, so under the branch rule
it is sweepable and not a live claim.

The entry's alternative, pruning the stale branches, is not done here. The tool should read cleanly
whether or not they exist. Tests: `or202-claims-summary.test.ts`, with 4 of 4 mutants killed. One
survived at first and needed a case (a live file against a dead one) to kill it.

<a id="2026-09-28-lane-a-ps49-collection-v2-engine"></a>

# 2026-09-28 — PS-49: collection rules v2 computed beside v1

The v2 engine is built and returns alongside v1 rather than replacing it. `GET /api/collection`
keeps `collections` exactly as before and adds `v2`:

- **Tank:** v1's rest-allowance fold on the 5 · 4 · 5 · 3 · 3 ladder, 100 sessions to the big tier.
- **Ranger:** a bank of 5,000 steps per T1, draining 1,000 a day.
- **Health cat:** one point per category logged a day (sleep, food, weight), 3 per T1, draining 1.
- **Rogue:** `null`, pending the owner (PS-48 ②).

**Why beside, not instead.** The plan said to bump the version and re-score. But the surface reads
v1's keys through typed maps, and the re-score is the owner's call (PS-48 ④). Computing v2 alongside
lets the engine merge now and changes nothing he sees. The surface switch is Lane B's, gated on
PS-48.

**The bank reuses the named-cat fold.** Each day's change in `floor(bank / unitsPerT1)` becomes
spawn or decay events on the existing `settle`/`decayOnce`. With 3 → 1 merges that is exactly the
plan's base-3 conversion, and every cat keeps its name and lineage. The collection's third PR had
warned that a replacement fold would lose both.

**The owner's result, measured on his history:** workouts unchanged (T3 4, no T4 yet over 102
trained days); steps T3 5 → T3 2 · T4 1 · T5 1 (a 633k-step bank, 126 T1, matching the plan's ~120
estimate); Health cat T1 1 · T2 1 · T4 2 (58 T1). The table is on PS-48 for when he answers.

Tests: 10 for v2 (the owner's worked examples: 4,000 profit on 5,000 steps, the base-3 stock, the
110-session streak, the drain running on to today). Four mutants killed. 114 existing collection
tests unchanged. Three new one-column reads exclude soft-deleted rows. Rares and lucky procs are
not built; their rates are the plan's, not the owner's.

<a id="2026-09-28-lane-a-q524-steps-goal-one-number"></a>

# 2026-09-28 — Q-524: the user's own step goal is the one number

The owner decided on 2026-08-19 ("we need to use 1 number") and signed off on 2026-08-31 ("manual
wins"). `getDailyGoals` derived 10,000 from the activity level and ignored `users.steps_goal`
(7,000). So the Goals card and the daily digest said a 7,200-step day met the goal, while the
Activity Score and the Activity screen said 72%.

- `GoalProfile.stepsGoal`: when it is set (> 0) it is the goal; otherwise the derived value applies,
  and clearing it is the way back. All four callers pass it: the readiness payload (the Activity
  Score), the day audit, cardio week and health-insight.
- **Moved:** over the owner's last 91 days, the steps contributor rises on 79, by +2.2 points on
  average (median +1.9, max +5.4). That is approximate, assuming all six contributors are present,
  and it applies to scores computed from deploy on. Stored history is unchanged.
- **The provenance column the entry called for is not needed.** The recommend route only suggests,
  and both writers (the sheet and Coach) write only on the owner's accept, which his rule makes
  manual. Recorded on the entry, with the condition under which that stops holding.
- Six mocked-repository tests gained `getUserGoals`. Mutations: ignoring the user goal was caught
  by both new tests, and accepting a zero goal was caught too.
- **Remaining, now `Lane: T`:** deriving the goal from walking energy and measured stride, and
  aligning `DEFAULT_STEP_GOAL`.

A local-environment trap showed up twice today: a suite database carrying another branch's
migration fails tests that have nothing to do with the diff. The rebuild-on-switch rule in
`docs/local-agent-environment.md` (#1850) is what caught it here.

<a id="2026-09-28-lane-a-rv174-prune-deleted-programs"></a>

# 2026-09-28 — RV-174: a deleted program or style now leaves the phone

Programs and progression styles are hard deletes with no `deleted_at`, and the sync delta carries
only rows whose `updated_at` moved. So nothing ever told a device a row was gone, and its read-only
mirror kept them forever. `assembleLocalActiveProgram` takes `find(isActive) ?? programs[0]`, so
after deleting active program A and activating B the mirror could hold two active programs.

## Why a roster rather than a tombstone

A `deleted_at` column is a migration plus a `claude_ro` regeneration, and both wait on BF-214. The
entry's other option, delete by absence, needs the delta to say what EXISTS, which it did not. Both
tables are tiny, so `getSyncDelta` now sends every id on every page, unwindowed and unpaged:
`programRoster` and `progressionStyleRoster`. A roster that stopped at a page boundary would delete
the rows it did not reach.

## What changed

- `lib/data/postgres/adapter.ts` / `repository.ts`: the two rosters on `SyncDelta`, user-scoped.
- `LocalStore.pruneProgramStructure` (`lib/local-store/sqlite-backend.ts`): deletes mirrored programs
  and styles not listed, with sessions, exercises, schedules, schedule days and style sets, and nulls
  a deleted style on the exercises that used it. The server's FK does the same (`ON DELETE SET
  NULL`) without touching the program, so no delta could ever carry it.
- `pullDelta` prunes after `applyDelta`. **An absent roster prunes nothing; an empty one prunes
  everything**, and the two must never be confused. The `programs` domain flag rises only when
  something was removed, so program caches are not invalidated on every sync.
- The mirror is read-only (nothing on the device creates a program), so no pending local row can be
  pruned.

## Verification

- Against a real in-memory SQLite (`node:sqlite`): deleting a program removes every child and leaves
  one active program; a deleted style loses its sets and leaves the exercise style-less; absent means
  no-op; empty means all; matching means no-op.
- `pullDelta`: roster passed through; absent → `undefined`, not `[]`; the flag rises only on a prune.
- DB-backed `getSyncDelta`: the roster names unchanged programs too, and nobody else's rows.
- **Mutation pass: 6 killed, 1 equivalent control survived.** Killed: roster built from changed rows
  only; roster not user-scoped; absent read as empty; flag not raised; deleted style left on the
  exercise; program sessions left behind.
- `sync-delta-connection-demand` and the LB-66 tombstone tests pass unchanged.
- `pnpm dev`: `/api/sync/pull` returned no changed programs and a roster naming the one program and
  one style.

## Not exercised

The device, where the pruning actually runs (`getLocalStore` is null on the web). A Known-Issues row
carries the S25 pass test.

<a id="2026-09-28-lane-a-rv175-offline-log-edits-server"></a>

# 2026-09-28 — RV-175, server half: one write function per log edit, and outbox domains for them

Editing or deleting a logged exercise, or deleting a whole session, was API-first with no outbox
domain. Offline the app toasted "Updated", then "Failed to update", and the change was gone.

## What shipped

- **The writes moved out of the routes into one place each.** `lib/workout/exercise-log-edits.ts`
  holds `editExerciseLog` and `deleteExerciseLog`, moved verbatim from `PATCH`/`DELETE
  /api/workout-entry`, including the PR reconcile and the recap invalidation.
  `lib/workout/delete-session-reconcile.ts` holds `deleteWorkoutSessionAndReconcile`, which carries the PR
  reconcile the sessions route used to do on its own. The routes keep auth, body limits and the HTTP
  answers. The existing route tests (35) pass unchanged.
- **Three outbox domains:** `exercise_log_edit`, `exercise_log_delete`, `workout_session_delete`.
  Each `pushMutations` branch calls the same function its route does. A missed edit goes to `errors`
  (retried, then dead-lettered, like `session_rpe`), since its commonest cause is the log still
  queued behind it. A missed delete is success, like Q-328's activity delete, because a replay finds
  the row already gone.
- **`MutationDomain` now derives from `SYNCED_MUTATION_DOMAINS`.** It was a hand-kept copy, identical
  member for member, and the registry's own comment says every domain type derives from it. The
  typechecker then named the one consumer that needed labels: `sync-health-card.tsx` got three
  strings, the only change in a Lane B file, and required to compile.

## Why the device half is not in this PR

The local write methods the hook would call mark rows `synced`, because they were written to mirror
a server-confirmed write. Used offline, a pull before the push would resurrect a deleted log. The
push-confirm switch has no case for the new domains, and an edit that adds a set has no safe local
insert yet. That is LA-165 (Lane A). The hook swap is LA-166 (Lane B, `Needs: LA-165`). Until then
nothing queues the new domains, so they are inert.

## Verification

- `rv175-offline-log-edits-push.test.ts`, 8 cases through `pushMutations`: an edit rewrites and adds
  sets and recomputes volume; a missing log goes to errors; another user's log is untouched by an
  edit or a delete; a log delete takes an emptied session with it; a replayed delete is not an error;
  a session delete tombstones everything and re-derives the PR it held; malformed payloads are rejected.
- **Mutation pass: 4 killed, 1 control survived.** Killed: edit miss counted as processed; the
  session delete skipping the PR reconcile; the ownership check losing its user scope; a replayed
  delete treated as an error.
- `pnpm dev`, over HTTP: `PATCH` 200 and the sets rewritten; `PATCH` of an unknown id 404; `DELETE`
  of the log 200 with `sessionDeleted: true`; `DELETE /api/workout-sessions` 200; `POST /api/sync/push`
  carrying an edit and a session delete returned `processed: 2, errors: []`, with both writes in the DB.
- `check-push-mutations`: OK.

## A trap met on the way

The composed session delete first lived beside `deleteWorkoutSession` in `delete-session.ts`. The
full suite then failed `workout-write-path-routes.test.ts`, which had passed when run alone before
that change: it mocks `deleteWorkoutSession`, and a call from inside the same module never reaches a
mock of its export. Moving the composition to `delete-session-reconcile.ts`, which imports it, put
the test's contract back unchanged. **Run the suite for the files a refactor touches AFTER the last
edit, not only before it.**

## Not exercised

The device, and anything the owner can see: no client queues these domains until LA-166.

<a id="2026-09-28-lane-a-rv181-close-memo"></a>

# 2026-09-28 — RV-181 closed: the HR-profile memo is not worth a freshness trade

RV-181's aggregate shipped on 2026-09-25. It left one item open: a memo for the 90-day profile,
which was said to hold "the other two thirds" of the saving, and which the entry said to
re-measure first. Measured from production `pg_stat_statements`:

- The merged aggregate has run **294 times** since its deploy, about 3 days, at **232 ms** mean.
  That is roughly 100 calls and **23 s of database time a day**.
- A 16.8-minute window with no workout in it had **zero** calls. The cost exists only around
  workouts, where ring drains invalidate the key.

`use-hr-profile.ts` documents a real reason not to pin the key: live samples land in the window
during a workout. Trading that away for about 23 seconds a day is the wrong way round, so nothing
was built. The entry's other open item was refuted earlier the same day and is recorded in the
entry's own text, now folded here. HRR1 median vs best: 32 of 32 days differ, so reading the
stored column would redraw the chart as a different metric.

**Seen in passing, not filed yet:** in that same window a raw-sample read (`oura_raw_samples`
selecting `body_hex`/`decoded` since a cursor) took **2.1 s per call over 27 calls**, against a
93 ms cumulative mean. The hot window is steady at ~180k rows and the packer ran that morning, so
this is more likely one heavy reader in the window than growth. It needs a second sample before it
is a finding.

<a id="2026-09-28-lane-a-rv181-hrr-column-measured"></a>

# 2026-09-28 — RV-181's HRR half measured and refuted; ring workout HR found thinning (LA-168)

## The column is a different number

RV-181's second open half proposed that `/api/health/trends` read `workout_hr_stats.hrr1_best`
instead of re-deriving HR recovery from raw HR, "after a per-day agreement check against
production". That check was run against the owner's 32 completed sessions in the last 45 days,
using the production rows through the read-only endpoint and the real `preferStrapBuckets` and
`analyseHrRecovery`.

The trend plots each session's **median** set HRR1, and `hrr1_best` is the session's **max**. They
disagree on 32 of 32 days, with the column higher by 3 to 36 bpm/min. Swapping would redraw the
chart as another metric. That half is struck in the backlog with the numbers, and nothing was built.

**Measurement caveat:** `/api/admin/db-query` returns at most 1,000 rows, so 22 of the 32 raw-HR
windows were truncated. The median-against-max result does not depend on those windows, because it
follows from how the two values are defined. The per-session live-against-stored comparisons below
use only the uncapped windows, plus a separate `count(*)` query that no cap touches.

## What it turned up

`readings_count` in the snapshot compared with today's `oura_heartrate` count shows that **ring-only
workouts have lost most of their stored HR since their recap rendered**: 08-21 103 → 12, 09-06
180 → 13, 09-20 164 → 99. Strap sessions are intact. This is filed as LA-168, with the rollup's
`deleteBleHeartrateNotIn` as the lead. The lead is not yet established.

<a id="2026-09-28-lane-a-rv182-close-pkey-kept"></a>

# 2026-09-28 — RV-182 closed: `oura_heartrate_pkey` stays

Parts ① to ③ of RV-182 shipped on 2026-09-25. Those were the no-op backfill, the clock-offset
read, and the HR rollup's delete-then-insert churn. The last line noted `oura_heartrate_pkey` at
7 MB with 0 scans and left the drop for a migration of its own. **Decided against, on evidence.**

- The admin snapshot pages every table by its primary key, and `db-snapshot.ts` has no fallback
  for a table without one (every production table has a PK, its header says). `oura_heartrate` is
  a bulk table, so a `bulk=` snapshot pages 800k rows on exactly this index. The 0-scan reading came
  from a period with no bulk snapshot, so it measured disuse by the one reader that matters, not
  deadness.
- Swapping the PK onto the `(user_id, timestamp)` unique key would keep pagination. It would also
  rebuild a constraint on the largest hot table under lock, and drop the uniqueness of `id`.
- The saving is 7 MB, which is about $0.001 a month at the billed rate.

So the index stays. Reopen only if the table's write cost is measured to matter, not on storage.

<a id="2026-09-28-lane-a-rv184-correction-and-footprint-race"></a>

# 2026-09-28 — RV-184 re-verified and corrected; a racing footprint test fixed

## RV-184: the fix it prescribed would have found nothing

RV-184 said the AI prescription regenerates at workout open on days the completion already generated
one, and prescribed adding three fields to the logged fingerprint. Checked against current `main`:

- Completion no longer generates anything. `packages/shared/src/workout/complete-workout.ts` marks the
  slot `consumed`; the old in-process regenerator is gone, so the next open has to regenerate.
- `excludeSessionId`, the parameter that would name the completion trigger, is passed by no caller.
- `ai_call_log.fingerprint` is stored as a hash, so extra fields cannot make a trigger readable.

The production log agrees with the current design: one call per workout day, and a second for the
same session 35-60 minutes later when the app is reopened after training. The one anomaly is a pair
7 seconds apart on 09-16, inside the 30-second cooldown. The entry now points at that instead, and
records `excludeSessionId` as a dead parameter.

## A racing test

`storage-footprint-real-counts.test.ts` failed once in a full local suite with `expected 211 to be
210`, and passed 6/6 alone. It compared a live `count(*)` of `oura_raw_samples` against a second
reading, and other test files insert into that table at the same time. Both assertions are now `>=`.
**Checked that this still catches the bug it exists for:** restoring the BF-54 estimate
(`n_live_tup`) in `getOuraStorageStats` makes it fail, because a stale estimate is below the real count.

<a id="2026-09-28-lane-a-rv184-cross-replica-prescription-dedup"></a>

# 2026-09-28 — RV-184: one generation per workout open, across replicas

Opening a workout fires two plain prescription generations: `workout-data`'s server-side one and
the client's POST. The 30 s dedup that should collapse them is per process. Production's
2026-09-15 pair shows it failing: identical input (3,089 tokens each), with the second starting
5.4 s after the first had finished. One process would have answered that from its cooldown, so the
two ran on different replicas.

`generatePrescriptionForSession` now reads the stored row, which every replica sees. A plain call
(no preset, no completion exclusion, status pending or auto-applied, standard length) returns a
plan generated under 30 s ago instead of calling the model. Everything else falls through as
before. `rv184-just-generated-guard.test.ts` uses a repository double that throws if generation is
reached: 7 cases, 7 of 7 mutants killed, control green. The 200 neighbouring test files are green.

**Correction to the entry's morning re-verification.** It said completion no longer generates a
prescription. The server doesn't, but the client fires `/prescribe` 2–4 s after each completion,
and production shows it every time. That call sends no `excludeSessionId`, so the plan for the
next session is built as if the lifter had trained 0 hours ago. That trips the emergency deload's
`<36 h` arm whenever three muscles were logged sore. Filed as **LA-177** for Lane B (a one-line
body on a `components/` call).

RV-184 is closed. Its last line, a fingerprint that could name its trigger, was an "if ever
wanted" and would need a schema column; it is not carried forward.

<a id="2026-09-28-lane-a-rv78-next-session-parallel"></a>

# 2026-09-28 — RV-78: `/api/next-session` reads its two follow-ups together

Home's most-refetched route read the stored prescription, then the muscle assignments, one after
the other. Sweep 59 noted they are not independent: the assignments were asked for the list after a
prescription's drop. They now run in one `Promise.all`, with assignments fetched for the unfiltered
list and then trimmed to the exercises that survive the drop, so the response is unchanged.

A test fails if they are serialised again: the prescription read only resolves once the assignments
read has started. The old route fails it, and so does skipping the trim. The card half of the entry
(`weight-response-card.tsx`) was dropped in sweep 59, because it is the no-local-store fallback and
does not flash on the APK.

Not measured: the saving. On this dataset it is likely a few milliseconds.

<a id="2026-09-28-lane-a-snapshot-bytea"></a>

# 2026-09-28 — the local snapshot loader corrupted every packed raw frame

`scripts/local-db/snapshot.js` bound each NDJSON value as it arrived. A `bytea` column comes over as
`{"type":"Buffer","data":[…]}`, so the loader stored that JSON's text as the bytes. Every
`oura_raw_packed.blob` in a local snapshot, 1,580 of them, was unreadable
(`frame-pack: unsupported format version 0x7b`, `{`). Any local work over historical raw data read
nothing from the cold tier, without an error. TN-56's replay found it on its first real-data run.

The loader now finds each table's `bytea` columns and rebuilds a `Buffer` (Postgres's `\x…` text
form is accepted too). The conversion is a pure exported `restoreValue` with its own test, and the
script runs `main` only when executed directly. The snapshot database was reloaded with the fix:
1,580 blobs, none starting with `{`.

<a id="2026-09-28-lane-a-snapshot-cascade-truncate"></a>

# 2026-09-28 — the snapshot loader emptied child tables and reported a clean restore

The first complete snapshot load (after #1837 fixed the server side) printed "all counts match", but
the database held 120 sessions and **0** sets, 0 nights and 0 Body Battery days. Each table was
truncated with `CASCADE` just before its own insert, which emptied every table referencing it,
including ones loaded earlier in the alphabet: `workout_sessions` cascaded through `exercise_logs`
to `set_logs`, and `users` cascaded to most of the rest. The count check compared the manifest
against the insert counter, never against the table.

The loader now truncates every table in one statement before loading, and verifies each against
`count(*)`. **Control:** putting back the per-table truncate now fails the check (`activity_logs:
loaded 0, manifest said 62` …), rolls back, and leaves the database as it was (1,317 sets intact).

`docs/local-agent-environment.md` §④ now describes two lane databases. `trainingai_lane_a` is seeded
and used by the suite, and `trainingai_lane_a_snapshot` holds real data. A snapshot load truncates
everything and the suite writes fixtures, so the two cannot share one. The section also notes that
vitest needs `DATABASE_URL` exported.

<a id="2026-09-28-lane-a-tn32-zone-copy"></a>

# 2026-09-28 — TN-32: run copy states the zones the engine actually uses

The Norwegian 4×4 rationale promised "85–95% max HR". The engine prescribes zones 4–5 on Karvonen
bands, which is 80–100% of heart-rate reserve and about 20 bpm higher for the owner. The copy now
says what the engine does, and the two framework code comments that quoted %HRmax say reserve. The
second zone-name table in `session-picker.ts` is now derived from `HR_ZONE_META`. A test fails on
any framework rationale that quotes a %-of-max figure; reverting the copy fails it. The Heart Rate
page's profile-free grading and red 60–100 bpm are Lane B's, and the entry is re-laned there. No
threshold moved.

<a id="2026-09-28-lane-a-tn46-dose-context"></a>

# 2026-09-28 — TN-46: a flagged day names the recent dose, and dose-vs-vitals has a read

The owner wanted to "correlate change in vitals with reta" and delegated the design. The engine
half is built; the overlay chart is Lane B's.

**What shipped.**
- `packages/shared/src/health/dose-context.ts` finds doses in a 5-day window and phrases them
  ("Retatrutide 1 mg, 3 days ago").
- `repo.listDoseEvents` reads `supplement_logs.amount`/`unit` for vial-dosed supplements.
- The readiness payload's illness advisory, which the notification reuses, names the latest dose
  and says it may be the medication rather than illness. It also carries `recentDoses`.
- `GET /api/health/dose-vitals` returns doses beside each night's resting HR, HRV and the
  baseline stored for that night.
- **Annotate, never correct:** no score reads any of it.

**Decisions and traps, kept here because the rewritten backlog entry no longer carries them:**
- **The dose is the log's `amount`, never `supplements.dose`.** That field is the vial strength
  (10 mg against administered 0.5–1 mg). The entry's first draft made that 20× mistake.
- **No baseline snapshot was needed.** `oura_daily_summary` stores the baseline per night, so the
  row before the first dose (2026-09-06: RHR 52.875, HRV 56.125) is the pre-intervention
  reference, and nothing prunes that table.
- **Resting HR is the night's LOW, not its mean.** The stored baseline tracks the lows (09-06: low
  51.7, mean 59.9, baseline 52.9). A chart of means would sit ~7 bpm above its own reference
  every night. Found by checking the series against the entry's own table before shipping.
- **Lag:** the response peaked 2–4 days after a dose and had largely washed out by day 5, hence the
  window. A same-day correlation finds nothing on data that plainly shows an effect.
- **Magnitude, corrected on 2026-09-20 and kept at the corrected size.** Over 28 pre-dose nights
  against 14 on the drug, resting HR moved **+3.9 bpm** (52.3 → 56.2; 1.2× the owner's own
  nightly sd) and HRV **−14.2 ms, −24%** (58.8 → 44.6). The 65 bpm / 19 ms readings were a two-day
  excursion, not the sustained shift. This is a record of what the app holds, not medical advice.
- **Vial-dosed only**, so daily oral supplements do not annotate every day. If an oral medication
  ever needs it, add an explicit per-supplement flag rather than widening the filter.
- **Do not re-tune any threshold against the dosing period.**

**Verification:**
- The pure module has 6 tests.
- The route test runs on real Postgres: vial-only, no deleted logs, low-not-mean, stored baseline
  ÷ 8. Removing each filter or switching to the mean fails it.
- 16 readiness-related test files pass. The payload's dose read is wrapped, so even a synchronous
  throw costs only the context.
- The full suite is green apart from the known comment-blindness interaction.

<a id="2026-09-28-lane-a-tn72-body-battery-rederive"></a>

# 2026-09-28 — TN-72: a Body Battery re-derive, and the day's computation in one place

The owner approved re-deriving the 84 stored Body Battery days under v6 (TN-72, 2026-09-27). Nothing
could do it: `body_battery_daily` is written only by the live route, for today.

- **Extracted** the route's per-day computation to `lib/health/body-battery-day.ts`
  (`computeBodyBatteryDay`). The route now calls it for today up to now, with behaviour unchanged,
  and its tests pass as before (54/54 across the Body Battery suites). The anchor rule moved with
  it to `lib/health/body-battery-anchor.ts`. `BodyBatteryResponse` is re-exported from the route,
  so no client import changes.
- **Added** `POST /api/admin/rederive-body-battery`. It is admin-only, dry-run by default, handles
  31 days a call, runs sequentially, and walks each finished day midnight to midnight. It keeps
  the anchor each day froze, skips today and days with no stored row, and reports how many days
  move and by how much.

**Mutation pass:** a walk run to "now" instead of the day's end, a re-chosen anchor, no skip for
missing rows, no dry-run gate, and no skip for today were all killed. The control (a 32-day ceiling)
survived.

**Not done:** the production run. It needs an admin session, so it is recorded on TN-72 as a Keep
with the snapshot-first procedure. The stress term uses today's daytime-HRV model for every
re-derived day, because a per-day model is not stored.

<a id="2026-09-28-lane-a-tn75-baseline-window-answered"></a>

# 2026-09-28 — TN-75's last question answered: the 09-07 → 09-12 gap is the baseline round

TN-75 left one question: why five September sessions logged one set per exercise with no
`planned_pct`. Production shows exactly one workout for each of the five sessions, the first after
the 09-02 → 09-06 deload, with a single set per exercise at up to 20 reps. That is the baseline AMRAP
round. `session-data.ts:215-216` gives the baseline phase one set and no progression style, so there
was never a plan to record. The deploy history the entry asked for was not needed.

TN-75 now carries two remaining items. The first is Skull Crusher's missing style, which is BF-200's
residue and is fixed by assigning a style in Config. The second is a baseline marker on
`workout_sessions`, so a set with no plan can be told apart from one never planned. That is a
migration and waits behind BF-214. The bodyweight-plan product question is split out as LA-169 for
the Orchestrator, with a recommendation.

<a id="2026-09-28-lane-a-tn79-partial-day-gate"></a>

# 2026-09-28 — TN-79: the training-load gate only ever judged an unfinished day

LA-161's diagnostic columns got their first value on 09-28: grid 471, valid 343, written at 08:46
Brisbane. That is a partial day, since about 526 minutes had passed, and the MET floor is 720. The
route re-persists on every call and is only asked about today, so each day's stored
`insufficient_met` is the verdict of the last evaluation made during that day. Nothing evaluates a
finished day. The earlier replay that "cleared both floors" read days after they had ended, which
is where TN-79's contradiction came from.

The two `scorer_no_output` days (09-25, 09-26) can only be reached with both floors clear, so the
09-24 NaN-validator root cause is live again. The sandbox test that set it aside ran without the
model constants and could not have shown anything.

Filed LA-170 for the buildable half (evaluate a day after it ends). It needs an evaluated-at
column, so it waits behind BF-214's migration numbering. Still to confirm: one evening read
showing a grid ≥ 720 on the same day.

<a id="2026-09-28-logged-work-offline-outbox"></a>

# LA-166 — the last three writes that failed instead of queueing

**Branch:** `fix/logged-work-offline-outbox` · **Lane B** · `lib/hooks/use-day-entry-mutations.ts`.

Editing a logged exercise, deleting one, and deleting a whole session all `fetch`ed first and
mirrored into the local store only after a 2xx. Offline that means a toast saying **"Updated"**,
then one saying **"Failed to update"**, and nothing queued — the change is gone. `handleDeleteActivity`
in the same hook has done this correctly since Q-328; these three are the last of its siblings.

## What shipped

Each handler now writes locally in **pending** mode and queues its domain, exactly as the activity
delete does:

| handler | local write | domain | payload |
|---|---|---|---|
| `handleEditSave` | `updateExerciseLogLocally(…, { pending: true })` | `exercise_log_edit` | `exerciseLogId`, `weights`, `reps` |
| `handleDeleteExercise` | `deleteExerciseLogLocally(…, { pending: true })` | `exercise_log_delete` | `exerciseLogId` |
| `handleDeleteSession` | `deleteWorkoutSessionLocally(…, { pending: true })` | `workout_session_delete` | `workoutSessionId` |

`pending`, not the default `synced`: a synced row is one a pull may clobber before the push lands,
and `applyDelta` reaps a synced tombstone — so a delete left synced would undo itself. The row moves
to synced on push confirmation. LA-165 added the flag and the three push handlers; this is the client
half of RV-175 that uses them.

The toast now fires after the **local** write rather than after the network, which is the
saves-feel-instant rule and, offline, the only point at which anything is known.

## One deliberate difference from the online path

Deleting a session's last exercise leaves the empty session shell on that device until the next pull
reaps it. Online, the response carries `sessionDeleted` and the shell is tombstoned with it; offline
nothing can know that, and the server's own `deleteExerciseLog` cascades when the push lands.
**Queuing a second `workout_session_delete` to close that window would double-delete whenever the
guess is wrong**, which is worse than a shell that self-heals. Written into the code rather than left
for someone to rediscover.

A smaller consistency fix came out of the guard: only one of the three carried the `Web fallback`
comment that fences the local path from the network path. The test asserts the local half contains
no `fetch(`, and it needs that marker to find the boundary — so the other two gained it.

## Verification

`tsc` clean · Custom Rules **83 of 83** · lint 0 errors, 828 warnings · **10,668** unit tests passed
· build clean.

**Control-run:** 12 of the 13 new cases fail against `origin/main`. The thirteenth pins the Zod
schemas in Lane A's files and passes either way, which is correct — it is there to catch a payload
key drifting from the schema that parses it, not to test this diff.

**Not exercised — the offline path itself, at all.** `getLocalStore` returns null on the web, so
every run in this sandbox takes the fetch fallback, and the repo has no React hook renderer to drive
the handlers directly. The guards are source-level (asserted as calls, not mentions — the reference
test records why) plus Lane A's engine tests. A Known-Issues row states the aeroplane-mode pass test.

<a id="2026-09-28-more-seasons-ttl-gate-and-title-invalidation"></a>

# 2026-09-28 — RV-183: one of two More keys takes the TTL gate, and proving it found a live cache bug

**Lane B.** Branch `fix/more-seasons-ttl-gate-and-title-invalidation`. No version bump — nothing
user-visible changes today (see *Why no bump*).

## What shipped

- **`app/more/more-content.tsx`** — `more-seasons` now carries `freshWithinTtl: true`, with the written
  RV-67 proof at the call site. A More re-show inside the 30-minute TTL costs **one GET instead of two**.
- **`components/more/title-picker-sheet.tsx`** — equipping a title now calls `invalidateUserProfile()`.
  This is a live cache-group omission, found while proving the above.
- **`app/__tests__/rv183-more-seasons-ttl.test.ts`** — 5 cases, following the shape of the existing
  `rv67-nutrition-targets-ttl.test.ts` precedent.

## The proof for `more-seasons`

`RV-183` warned that the RV-67 purity check *"has disqualified every other candidate here"*, so the
expected outcome was a close. This one passes:

- **Purity.** `listSeasonsWithResults` (`lib/data/postgres/slices/social.ts:105`) is two plain selects —
  every `seasons` row, then this user's `season_results` — mapped straight to the payload. No `now()`,
  no derivation, nothing that decays with the clock. That is exactly what disqualified the others:
  `body-battery` drains with the clock, `readiness-score` is fed by server-side rollup writes, and
  `more-user-profile` carries a `countWorkoutSessions()` derivation.
- **Writers: none exist.** No insert, update or delete against either table anywhere in `lib/`, `app/`
  or `scripts/`, and `/api/seasons` is GET-only. So the "every writer's group holds the key" half of the
  proof is **vacuous rather than unproven** — a materially different thing, and the reason this
  qualifies where nothing else on the screen does.
- **A cleared entry still fetches.** `cachedFetchCore` short-circuits only when a cached value exists
  *and* is fresh (`lib/sqlite/cache.ts:373-386`), so a future group that starts clearing this key needs
  no change here.
- **Residual risk, stated rather than hidden:** a season result written server-side appears up to 30
  minutes late. `pullDelta` does not carry seasons either, so that delay is already the status quo for
  anything short of a cold start.

The guard fails on the **appearance of a writer** rather than waiting for the stale symptom — which is
the only useful shape when the proof rests on there being no writers to forget.

## The live bug this turned up

`handleEquip` PATCHes `/api/user/equipped-title`, which writes `users.equipped_title` — part of
`/api/user/profile`'s payload — then called `onEquip(titleId)` and nothing else. **It never cleared
`more-user-profile`.**

Today that is masked: `cachedFetch` always revalidates, so the next re-show corrects it. But
`/more/details` reads the same key through `useCachedValue`, so its seed was already serving the old
title until its own revalidate landed, and the moment any read path took `freshWithinTtl` this became
**30 minutes of a wrong title**. It is the exact class CLAUDE.md's cache-group rule exists for — a write
that affects a key, not registered in a group that clears it — and it was a real omission independent of
any optimisation.

## Why `more-user-profile` did NOT get the flag

Its payload is `{ user, hasPassword, workoutCount }`, and `workoutCount` is `countWorkoutSessions()` — a
derivation, so every workout completion is a writer of the key, and no group a completion calls clears
it (`invalidateWorkoutSummaries()` does not contain it; only `invalidateUserProfile()` and
`invalidateGoalRecommendations()` do).

**That field has zero consumers anywhere in the repo.** So the fix is to delete it, not to widen the
proof — filed as **`LB-180`, Lane: A** (the route is theirs). It sits at Lane A position 11, one row
below `next-item.js`'s default cut, which is deliberate: `LB-179` at 10 is the consequential one, and
LB-180 blocks only a one-GET optimisation. `RV-183` now carries `Needs: LB-180` and parks.

## Why no bump

Nothing observable changes. The seasons flag removes a request; the title fix prevents a staleness that
revalidation currently hides. Per the standing rule, no user-visible change means no version or
changelog entry.

## An existing tripwire fired, and satisfying it was the point

`lib/supplements/__tests__/rv183-local-first-reminders.test.ts` asserted that **neither** More fetch
passed `freshWithinTtl`, with the stated reason that *"CLAUDE.md wants a written invalidation proof
before that happens"*. The full suite caught it: 1 failed, 931 passed.

That is a tripwire doing its job on exactly the change it was watching for. The proof now exists, so the
condition was **satisfied rather than bypassed**, and the test narrows to the half still unproven —
`more-user-profile` must keep revalidating until `LB-180` lands — rather than being deleted. Bounded by
the next call, and that file's `code()` helper already strips comments, so the slice reads code and not
prose. Control-run: flagging `more-user-profile` fails it.

## Verified

- 5/5, **control-run five ways with each mutation asserted as applied**: removing the seasons flag,
  flagging `more-user-profile`, dropping the equip invalidation, making the payload clock-dependent, and
  adding an aggregate to it each fail exactly one case. Restored 5/5.
- **Two rounds of the guard were wrong before this held, both caught by controls, not by review.**
  First, a fixed 260-character window after the profile key did not reach its `opts` — four lines of
  RV-150 comment sit in between — so a control that flagged that very key passed. Bounding the slice by
  the *next call* fixed that and broke the baseline, because my own proof comment names
  `freshWithinTtl` several times and fell inside the region. The answer was `stripComments`, which the
  sibling `workout-completion-surface.test.ts` already uses for this reason.
- `npx tsc --noEmit` clean · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors · full
  `pnpm test` green · `pnpm build` clean.

**Not exercised:** not run on the device, and **the seasons tables were not read in production** — the
proof is about who can write them, which is a source property, but it means I cannot say whether the
owner has any season rows at all. If the tables are empty the saved GET returns an empty array either
way, and the optimisation is still real but smaller than it sounds. The 30-minute staleness window was
not observed, only derived from `TTL_MEDIUM`. No offline-first, native, safe-area, gesture or
notification surface is touched.
