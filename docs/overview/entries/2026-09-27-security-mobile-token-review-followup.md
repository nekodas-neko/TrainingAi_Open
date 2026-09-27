# 2026-09-27 — security review of inbound PR #1607, and the lifetime mismatch it surfaced

**Branch:** `security/mobile-token-review-followup` · Orchestrator

The owner chose, from the 2026-09-27 decision round, that inbound PR **#1607** (bearer tokens for
native mobile login, from an outside contributor) gets a security review and then he reads it
himself. No agent merges it: it is an auth change and it is not ours, so the ceiling is
review/comment/approve, and approval was deliberately withheld for him.

## The review

[Posted on the PR.](https://github.com/nekodas-neko/TrainingAi_Open/pull/1607#issuecomment-5854224892)
Three findings:

1. **No test for the new branch.** `lib/__tests__/user-account-routes.test.ts:332` already has a
   describe block for this route; `responseType: 'token'` adds none.
2. **No per-token revocation.** A leaked bearer is valid until `exp` — 7 days — and the only kill
   switch is deactivating the account, which revokes every device at once. The cookie path had
   `httpOnly`/`secure`/`sameSite`; a bearer in client storage has none of them.
3. **A pre-existing lifetime mismatch** in the file the PR touches — filed as `OR-193`.

## What the review confirmed, so it is not re-derived

The PR reuses infrastructure rather than adding a second credential path. The token returned is the
**existing NextAuth session JWT**, and `auth()` already resolves it through
`lib/auth/bearer-session.ts` with a per-request `isActive` re-read — so a deactivated account's
bearer stops working without waiting for expiry. `secureCookie: isProduction` matches
`bearer-session.ts:38`; a mismatch there derives a different key and silently rejects every token,
so the agreement is load-bearing rather than cosmetic. PKCE, one-time token consumption and the
10-per-5-minutes rate limit are unchanged, and `responseType` is validated **before**
`consumeMobileAuthToken`, so a bad value does not burn the token.

`BF-212` flagged that `Q-1a` covers the same area. It does — as **reuse**, which is the good case.

## `OR-193` — the cookie outlives its own token by 23 days

`exchange-mobile-token/route.ts` sets the session cookie with `maxAge: 30 * 24 * 60 * 60`. The JWT
inside it has `maxAge: 7 * 24 * 60 * 60` (`auth.config.ts:9`). From day 7 the browser presents a
cookie whose token `getToken` rejects, for another 23 days — a silent sign-out on the mobile path
with the cookie still present. Not a security hole (the expired token is refused, the safe
direction), but the cookie promises what the credential does not keep. The fix is to derive the
cookie's `maxAge` from the session's rather than restate it; raising the JWT to 30 days would be the
wrong direction, since #1607 makes the leaked-bearer window newly relevant.

## `TN-80` was struck, and the strike was reverted at the merge

This PR originally deleted `TN-80` on the reasoning that BugFix's `BF-211`/`BF-212`/`BF-213` had
superseded it. **That was true when written and false by the time it merged.** While this branch was
open, BugFix added a measured census to `TN-80` that exists nowhere else: **seven PRs need the owner,
not three**, two of them **blocked rather than waiting** — `#1749`'s Migration Check reports
`58 failed`, all `column t.active_calories_est does not exist`, and `#1499`'s Build fails the
test-typecheck gate its description reports as clean, because `tsconfig.json` and
`tsconfig.tests.json` are different gates.

The conflict resolution keeps their version whole and adds the review note to it. The entry now
carries an explicit **do not strike** bullet, because the instruction to strike it is still sitting
in its own body and would otherwise be followed by the next session that reads it.

**Five PRs are genuinely waiting on the owner** by that census: `#1755`, `#1672`, `#1671`, `#1608`
and `#1607`.

**Not exercised:** no code changed in this PR, and the reviewed code was read rather than run — the
findings are static. Nothing was verified against a running mobile client.
