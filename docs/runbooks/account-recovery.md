# Runbook: Account Recovery

TrainingAI is a single-user app with two sign-in paths: email/password
(credentials) and Google OAuth2. This runbook covers the lockout scenario —
the password is forgotten **and** the Google account grant is unavailable
(revoked, lost access to that Google account, etc.) — so neither normal
sign-in path works.

There is deliberately **no self-service web password-reset flow**. Building
one would require email delivery infrastructure (a reset-link sender) that
doesn't otherwise exist in this single-user app, and adding that surface
area would weaken security (a new unauthenticated entry point) for a
scenario that happens rarely and can be handled directly against the
database instead.

## Recovery path: `scripts/reset-password.js`

Run this from a Railway shell (or locally, pointed at the dev DB) with
direct database access:

```bash
# Railway shell (recommended — has DATABASE_URL already set):
node scripts/reset-password.js you@example.com 'new-strong-password'

# Locally, against the dev DB:
DATABASE_URL='postgresql://postgres:postgres@localhost:5433/trainingai_dev' \
  node scripts/reset-password.js test@local.dev 'new-strong-password'
```

The script:
1. Looks up the user by `email`.
2. Hashes the new password with the same `bcrypt` cost factor (12) the app
   itself uses (`app/api/user/password/route.ts`), so the resulting hash is
   indistinguishable from one set through the normal in-app password-change
   flow.
3. Updates `users.password_hash` directly and reports the affected user's
   id — no email delivery, no token, no new API surface.

After running it, sign in via the normal email/password form
(`/sign-in`) with the new password.

## If Google OAuth is also unavailable

This script doesn't touch the Google OAuth grant at all — it only sets a
credentials-login password. If the credentials login is disabled or the
account has no `password_hash` set (Google-only accounts never get one),
this same script still works: it writes a `password_hash` for the account,
which enables credentials login going forward even if it wasn't used
before.

## Verifying the reset

```bash
# From a Railway shell or locally with DATABASE_URL set:
psql "$DATABASE_URL" -c "SELECT id, email, password_hash IS NOT NULL AS has_password FROM users WHERE email = 'you@example.com';"
```

Confirms the row exists and `has_password` is `true` before attempting to
sign in.
