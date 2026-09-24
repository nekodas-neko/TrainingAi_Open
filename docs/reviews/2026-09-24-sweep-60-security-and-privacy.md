# Review sweep 60: security and privacy

**Date:** 2026-09-24 · **Agent:** Review · **Base:** `main` 9e468632 · **Docs only.**

## How it was run

- One read by me, plus three read-only agents in parallel:
  - authentication, sessions and the admin surface;
  - privacy and data exposure;
  - headers, secrets, CI and dependencies.
- **Nothing was probed on production.** Exploit mechanisms were tested only on the local Postgres
  instance, with throwaway roles and schemas that were dropped afterwards.
- The one production read was a SELECT, and it confirmed that the `claude_ro` view of
  `feedback_submissions` omits the screenshot column.
- **This repository is public**, so the findings below name the field and the fix. They leave out
  exploit steps.

## Findings, most severe first

| ID | Severity | Surface | Summary | Evidence |
|---|---|---|---|---|
| RV-191 | HIGH | feedback → admin panel | The screenshot field is stored unchecked and opened as a URL from the admin panel | source; not executed |
| RV-190 | MEDIUM | `/api/admin/db-query` | Session settings (owner scope, read-only, timeout) can be changed by a query and persist on the pooled connection | reproduced locally |
| RV-192 | MEDIUM | register + Google linking | An invited email can be registered without owning the inbox; Google later links onto that account | source |
| RV-196 | MEDIUM | native plugins | Script in the origin can read or clear the ring key and redirect ingest | source |
| RV-193 | LOW–MED | NextAuth session | The Google refresh token is in the client-readable session JSON (redeeming it also needs the server-only client secret) | source; two agents independently |
| RV-194 | MEDIUM | Sentry | Scrubber misses exception messages carrying query params, breadcrumbs, `extra` | throwaway test confirmed |
| RV-197 | LOW–MED | CSP | `connect-src` allows WebSockets to any host; nothing uses them | source |
| RV-195 | LOW | auth/social | Mobile PKCE challenge not bound to its initiator; a deleted user stays signed in; a pending friend request reveals the target's profile | source |
| RV-198 | LOW | CI | Mutable action tags; keystore and write token on PR runs; no default `permissions:` | source |
| RV-199 | owner | repo / backup | Clinical baseline in the public repo; personal email on commits; `allowBackup` with no rules | source, git log |
| (standing) | LOW | deps | `adm-zip` high advisory now has a fix; still below the Dependabot threshold | `pnpm audit --prod` |

**RV-191 is the one to fix first.** Any signed-in user can reach it. It is also the precondition
that turns RV-193 and RV-196 from theoretical into reachable: all three need script execution in
the app's origin, and the CSP (`'unsafe-inline'`, SEC-H7) does not prevent it.

**Every fix is inert until RV-188 lands.** Production has not deployed since 1.465.26.

## Checked and clean

- **Bearer-secret routes** (db-query, db-snapshot, day-review, health-connect ingest): each uses
  `safeCompare`, rate-limits before comparing, returns the same 401 on a trip, and has a separate
  secret.
- **All 47 admin route files** gate every handler.
- **CSRF:** SameSite=Lax covers every cookie-authenticated mutation.
- **Middleware matcher and public paths.**
- **Social scoping:** only accepted friendships, and only the addressee can accept.
- **PKCE redeem:** single use, 5 minutes, timing-safe.
- **Git history since the public snapshot:** no credentials, keystores or `.env` files. Private
  paths have no leaked history.
- **Workflows:** no `pull_request_target`, and no untrusted interpolation.
- **Security headers:** HSTS, nosniff, X-Frame-Options DENY, Referrer-Policy and Permissions-Policy
  are all present.
- **WebView:** no cleartext, no `allowNavigation`, and the exported components check their action.
- **Rate limiting** converges across replicas.
- **Sentry request and cookie scrubbing; AI prompts** (no email, and age rather than date of birth);
  **export and upload routes**.

## Already known, not re-filed

- SEC-H7: CSP `'unsafe-inline'`, register's 409 enumeration, and the cookie and JWT lifetime
  mismatch.
- OR-138: the owner-scope widening. It now carries a note to build RV-190 first.
- Q-456: the owner's id in migrations.
- Q-479: the `isAdmin` claim class.
- RV-177: two routes without a rate limit.

## Not exercised

- No production probes.
- RV-191, RV-192, RV-193, RV-195 and RV-196 are read from source.
- GitHub's own settings (default token scope, first-time-contributor approval) could not be read
  from here.
- The production Postgres version and extensions were not checked.
- The existing feedback rows were not checked, because the view omits the column.
