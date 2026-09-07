# One normalisation, and a limit the per-email one cannot provide (PS-25)

**Branch:** `fix/ps25-login-rate-limit-key` · **Lane:** A · **Domain:** platform
**Version:** 1.436.12

The login limiter keyed on `email.toLowerCase()`; the lookup two lines below used
`email.toLowerCase().trim()`. Two derivations of "the same address", so ` user@x` and `user@x ` were
fresh 20-attempt buckets against one account and padded guessing was unbounded. Case was folded —
which is the control that makes this a bug rather than a missing feature. Somebody knew the address
needed normalising and wrote it twice.

The fix is one normalisation feeding both, plus the per-IP limit the sibling endpoints have.

## Two limits, because they catch different things

The per-email limit bounds a brute force against one account. It cannot see **spraying** — one
source trying fifty accounts once each never fills any single bucket. `login-ip:` at 50 per 15
minutes bounds that.

Deliberately loose. A household or CGNAT egress shares this key, so a tight number locks out real
users to slow an attacker who can simply use more addresses. It is checked **before** the per-email
limit so a spray is stopped without first spending a victim's bucket, and `clientIp` counts in from
the right (Q-493) — keying on the leftmost `X-Forwarded-For` entry lets the caller choose its own
bucket, which is the same defect one layer down.

## Measured live, with the control that matters

Real credentials sign-ins against local Postgres. Bucket filled to 20, then the **correct** password
through five spellings:

| address as submitted | result |
|---|---|
| `ps25probe@example.com` | refused |
| ` ps25probe@example.com` | refused |
| `ps25probe@example.com ` | refused |
| `  PS25Probe@Example.com  ` | refused |
| `\tps25probe@example.com\n` | refused |

`rate_limits` afterwards held exactly **one** email key at its cap of 20 — every spelling folded
into it. Control: the same account signs in normally on a fresh bucket.

## The control failed first, and the documented remedy is what caused it

The first control run refused a correct password on a cleared bucket, which read exactly like a
broken fix. `docs/local-dev-database.md` said to `DELETE FROM rate_limits` before believing a failure
of this shape — and that is not enough against a running server. The limiter is two-tier: the table
is the shared store, but a synchronous in-memory L1 holds the counts **inside the process**, and the
DB count only reaches it after a background flush. The same request signed in immediately after a
`pnpm dev` restart.

Corrected in that file rather than noted here, because that is where the next session will look.
A remedy that does not work is worse than no remedy: it converts "my fix is broken" into a
conclusion instead of a question.

## The sibling finding, deliberately not shipped here

Three lookups on the Google path pass the raw provider value — `getUserByEmail(user.email!)`,
`isInvited(user.email!)`, `upsertUser({ email: user.email! })` — while registration *writes*
`.toLowerCase().trim()` and `getUserByEmail` compares with a plain `eq`. That is a duplicate account
and a silently missed invite, waiting on Google to return an address whose case differs. It has never
fired because Google lowercases, which is a property of someone else's service.

Filed as **LA-61**, owner-gated, and the reason it is not a one-word fix here is the reason it needs
a gate: **normalising the input can only lose matches** on rows already stored non-normalised, and
this endpoint cannot count those — `claude_ro` is row-scoped to the owner. Normalising the
*comparison* (`lower(email) = lower($1)`) can only gain them, but it wants a functional index, and a
unique one would fail to create if two rows already differ only by case. A migration that can refuse
to apply is not a queue-pass decision.

## Verification

- `tsc --noEmit` clean · full suite green · `pnpm check:rules` 68 of 68 · lint 0 errors
- New `lib/auth/__tests__/login-rate-limit-key.test.ts` — 6 cases asserting the **keys** the limiter
  is called with, because that is the defect. A test asserting only "the 21st attempt fails" passes
  on the broken version too, as long as it never pads the address.
- Mutation-verified twice: restoring the untrimmed key fails exactly the padding test; removing the
  per-IP limit fails exactly the three that assert it.
- One test fixture was wrong and the code was right — I had `clientIp` picking the wrong end of the
  chain. Its own tests settled it, which is the argument for reading them rather than the name.

**Not exercised:** nothing native or device-specific — this is the server-side credentials path. The
Google OAuth path is unchanged. No production data was read; the probe user was created and deleted
locally.
