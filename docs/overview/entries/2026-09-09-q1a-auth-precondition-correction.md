# 2026-09-09 — a stale security precondition that inverts when you fix it (Q-1a)

**PR:** `lane-a/q1a-correct-auth-precondition` · **Lane A** · docs only, nothing implemented.

Q-1a (client bearer auth) is startable — no `Gate:`, no `Needs:` — and its "read first" line names the
sharpest of three auth preconditions: that `isActive === false` is enforced **only** in
`middleware.ts:18`, so a client talking to the API directly bypasses the deactivation check.

**That is stale, and the way it is stale is the dangerous kind.**

## What changed, and why "fixed" is the wrong conclusion

LA-58 shipped on 2026-09-04. `middleware.ts`'s matcher excluded `api` as its first term; it now
excludes `api/auth` only, so `/api` requests reach the gate at `middleware.ts:33-38` and a deactivated
session is answered 403.

An implementer who checks the correction against `main`, sees LA-58, and marks the precondition
discharged has read it correctly and concluded wrongly. **The hazard did not go away; it changed
shape, and Q-1a is the exact change that re-opens it.**

The gate is `if (req.auth && req.auth.isActive === false)`. `req.auth` is the **cookie** session — the
comment two lines above says so outright: *"a session-less request falls straight through, so they
still answer their own 401 and signature-authenticated ingest keeps working."* That is deliberate and
correct today, because there is no bearer path at all: grepping `auth.ts` for `Authorization`/`Bearer`
finds nothing. **Nothing bypasses anything right now.**

Q-1a's whole purpose is to build a client that authenticates *without* the cookie. The moment it
lands, a deactivated user holding a valid bearer token reaches every `/api` route with `req.auth`
empty, and the 403 never fires.

## What the entry now says instead

Not "check whether LA-58 fixed it" but: whatever resolves a bearer token must enforce `isActive`
itself, at the point it establishes identity, and a test must pin a deactivated bearer holder getting
403 rather than 200. Enforcement living in middleware and keyed on a cookie cannot cover a client
built not to send one.

## Why this is a docs PR and not the feature

Q-1a is auth, which CLAUDE.md places in the confirm-first carve-out, and it is a substantial build
(bearer client plus an `apiUrl()` indirection across every fetch). Q-44 Phase 3 PR 1 is already parked
awaiting an owner decision; a second large gated branch waiting beside it is not obviously useful.
What *is* useful now is that the entry stops carrying a precondition whose plain reading leads to a
deactivation bypass.

**Third stale factual claim found in a backlog entry today** — after Q-91-followup (which hid a live
bug) and Q-50 (which cited a safety net removed months earlier). All three were found by working the
entry rather than reading it. This one is the first where the staleness was *security*-relevant, and
the first where the correct-looking fix is what makes it dangerous.

**Not exercised:** nothing implemented; no code changed. The claims here are from reading
`middleware.ts` and `auth.ts` on `main` at `a7dd2a00`.
