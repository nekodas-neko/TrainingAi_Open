# 2026-08-18 — Review: does revoking access actually revoke it?

**Agent:** Review 📖 · **Branch:** `claude/review-auth-session-boundaries` · **Docs-only.**
**Filed:** Q-479 · **Review:** [`docs/reviews/2026-08-18-auth-session-boundaries.md`](../../reviews/2026-08-18-auth-session-boundaries.md)

## What this sweep was for

Eleven sweeps had tested cross-user *data* isolation extensively and never tested **privilege
revocation** — whether taking someone's admin away actually takes it away — or whether the
secret-gated routes reject when their secret is absent, which `CLAUDE.md` requires: *"Security checks
fail closed: a missing signature header, missing signing key … is a rejection, not a skip."*

## Q-479 — the two admin checks disagree, and one API route takes the wrong one

`lib/admin.ts` holds both. `requireAdmin(userId, _isAdmin?)` accepts the flag for signature
compatibility and deliberately ignores it, reading the row every call — **61 API routes** use it, and
revocation is immediate on all of them. `isAdminUser(userId, isAdmin?)` returns the passed flag when
given one. Seven of its ten call sites pass the JWT claim; six are page guards, which is UI and
correct. The seventh is `app/api/exercises/route.ts:38`, gating a write into `exercise_library` — the
catalogue every user reads.

The claim refreshes from the database inside the jwt callback but is throttled to once per 24 hours
(`ISACTIVE_RECHECK_MS`), which is a sound decision. What is not sound is the module's docstring:
*"This governs the **UI** only: `requireAdmin` … never trusts this claim."* That is false, and it is
the reason this was easy to miss — a reviewer who reads it stops looking.

Measured with a control: admin revoked in the DB, no re-login, cookie rotation persisted as a browser
does. `POST /api/exercises` returned **201** and created the row; `GET /api/admin/errors` returned
**403** at the same instant on the same cookie.

Severity is moderate-low and I said so in the entry: what a revoked admin gains is rows in a
catalogue, not health data or another user's records. It is filed because it is privilege persistence
with a working proof of concept, the fix is deleting one argument, and the wrong comment scales to
the next admin route someone writes.

## Recorded clean

All 61 `requireAdmin` routes DB-check. The six page guards are genuinely UI and should **not** be
"fixed". `/api/health-connect/ingest` fails closed with its secret unset and on an empty secret
string, runs an IP limiter *before* the constant-time compare, and returns an identical 401 body on
trip — the reference implementation for the fail-closed rule. Both bearer paths (`day-review`,
`db-query`) reject on partial configuration, matching the documented "widens transport, never
authority". And the claim-refresh module is careful in the ways that matter: a missing row is not
read as deactivation, a failed lookup does not advance the timestamp, a DB blip cannot sign everyone
out.

## The method note is worth more than the finding

**My first run of this test reported that revocation worked, and it was wrong.** The probes used
`curl -b cookies.txt` without `-c`, so every response's rotated session cookie was discarded and each
request re-sent a token carrying no `isActiveCheckedAt`. The throttle never engaged, the database was
re-read on every request, and the JWT-trusting route dutifully returned 403 — a clean result produced
entirely by the harness.

**A session-staleness test is meaningless unless the client persists cookie rotation.** Any finding
about a stale claim, a refresh throttle or a token lifetime has to be run with a cookie jar that is
written back, or it measures the opposite of what it claims to.

## Not verified

Local `pnpm dev` only. Not on the APK (its WebView keeps cookies, so it behaves like the corrected
harness, not the first one) and not against production. `ISACTIVE_RECHECK_MS` is read from source,
not observed over a real 24-hour window.
