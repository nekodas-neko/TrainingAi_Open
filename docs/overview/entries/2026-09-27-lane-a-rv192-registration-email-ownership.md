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
  were logged around each submit, so this may be dev-only. Also, `/sign-in?registered=1` renders no
  notice. Once this PR merges, every password registration is pending, so a new registrant is told
  nothing until they try to sign in. Filed as its own backlog entry.

## Not exercised

- **No real sign-in was performed.** Google OAuth cannot be driven from this container, so the
  signIn callback's own branch is reasoned from the diff; what is tested is the adapter call it
  makes. The registration flow was not run through `pnpm dev` either — it needs `AUTH_SECRET` and a
  Google client.
- **Nothing on the device or in production.** No existing row is touched by this diff; the password
  clearing happens on a future link, not as a backfill.
