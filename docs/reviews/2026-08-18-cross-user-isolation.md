# Review — cross-user isolation, driven with two real accounts

**Date:** 2026-08-18 · **Agent:** Review 📖 · **Sweep 39** · **Finding:** Q-556 (low)

## Why this lens

The last reachable item on this role's "structurally untested" list was **a second account** — every
ownership check to date had been read in source, never exercised by a different logged-in user. The
local harness already carries a zero-data account with a saved session (`e2e/zero-data.setup.ts`), so
this needed no new infrastructure. Third time in this run that an "unreachable" surface wasn't.

`CLAUDE.md` documents this bug class recurring across three domains, so the probes deliberately
included the shapes that would expose it: deleting A's rows, patching A's row, logging a set **into
A's workout session**, and completing A's workout as B.

## Result — the ownership discipline holds

Ten of eleven probes were rejected, all by the route's own ownership check rather than by an accident
of routing:

| Probe | Result |
|---|---|
| `GET` A's recap / energy / timing | `404 {"error":"Not found"}` ×3 |
| `DELETE` A's workout session | `404 {"error":"Not found"}` |
| `POST` log a set into A's session | `404 {"error":"Workout session not found"}` |
| `POST` complete A's workout | `404 {"error":"Session not found"}` |

**The enumeration control passed too**, which is the part worth having. The same three operations
against a **nonexistent** id return byte-identical responses to the ones against **A's** id — `404
Not found`, `404 Not found`, `404 Session not found`. A route that 404s for a fake id but 403s for
someone else's confirms which ids exist; none of these do.

## Q-556 — one route reports success for a delete that deleted nothing

`DELETE /api/activity-logs` with **A's** log id, as **B**, returns `200 {"success":true}`.

**It is not a leak, and that was checked rather than assumed.** Immediately after, in the database:

```
id 8c4cdaa8…  user_id 29f916c2… (A)  deleted_at NULL     -- row intact, still A's
A's activity_logs: 1                                     -- nothing removed
```

The scoping works and is deliberate — `repository-ownership-scoping.test.ts:326` already asserts
*"deleteActivityLog cannot delete another user's activity"*. The route simply cannot report what
happened: `deleteActivityLog(userId, id): Promise<void>` returns nothing, so the handler `await`s it
and answers `{ success: true }` unconditionally.

**Why it is worth filing anyway, at low severity:**

1. **It is inconsistent with every sibling.** The codebase's posture — verified by the control above —
   is *404 for both a nonexistent id and someone else's*. This route is *200 for both*. Both postures
   are safe against enumeration; they cannot both be the house style, so one is wrong by the
   codebase's own standard.
2. **Offline-first makes a false success expensive.** A queued mutation that receives a 2xx is
   confirmed and dropped from the outbox. A delete that matched zero rows *for a different reason* —
   sync ordering, the row not yet pulled to the server — is indistinguishable from this one, and gets
   confirmed away. **This path was not demonstrated**, and is flagged as the reason the response
   matters rather than as an observed bug.
3. It is the same family as `CLAUDE.md`'s existing rule — *"after a user-scoped UPDATE whose row id
   came from the client, check the affected-row count"* — applied to a DELETE.

**Fix:** return the affected-row count from `deleteActivityLog` and answer 404 when it is zero,
matching the siblings.

## Method — the first run reported eleven clean results and proved almost nothing

Worth recording in full, because the output was *more* convincing than the corrected one.

Eleven probes, eleven non-2xx statuses, no leaks. But **six returned `<!DOCTYPE html>`** — Next's
404 page for a route that does not exist. I had invented paths (`DELETE /api/activity-logs/<id>`)
when the real route takes the id in the **body**. A seventh was rejected by Zod before any ownership
check ran. **Only three of eleven reached the code under test.**

> **A 404 from a route that does not exist is not evidence of access control** — and the tell was not
> in the status column at all. It was in the body: HTML instead of JSON.

The corrected run uses real paths and payloads, **labels unmatched routes explicitly** so they cannot
be miscounted as passes, and adds the enumeration control.

This is the fourth measurement error in this run, and they share a shape: **each produced a plausible
result in the direction I expected.** Zeros looked like offline failure; 38% looked like partial
cache retention; eleven 404s looked like solid isolation.

## Not exercised

- **1 of 11 probes still did not land**: `PATCH /api/activity-logs/<id>/metrics` returned
  `400 Invalid body` — my payload was wrong, so that route's ownership check remains unverified.
- Local seeded database, web build. **Not production** (where `claude_ro` sees only the owner and
  cannot be used for this at all) and **not on device**.
- Two accounts, not N. Nothing here says anything about admin-vs-user boundaries, which
  `requireAdmin` covers separately.
