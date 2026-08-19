# 2026-08-19 — three completed entries removed, and a rule line that marked the wrong area broken (Q-552/553/554, Q-480)

**Branch:** `chore/backlog-completed-sweep` · **Lane:** Implementation A

## Q-552, Q-553, Q-554 — done, and lingering

All three were review findings **fixed in the PR that filed them**, each leaving behind a CI check
that now enforces the result: `check-backlog-pointers.js`, `check-known-issue-duplication.js` and
`check-index-doc-paths.js` — steps 45, 47 and 48 of 49. Checked before removing: no open work, no
pending owner or device check, no un-run follow-up on any of them.

**Q-552 was explicitly annotated *"kept as the record of why the procedure changed"***, which is
precisely what this file's own protocol forbids — *"History is not kept in this file"*, and a
completed item *"must never linger in the queue"*. That annotation is why it survived two sweeps.

Removing it loses nothing, verified rather than assumed: the band ledger it created — including the
retroactive **544–551** and Review's **552–601** — is in
[`docs/agents/README.md`](../../agents/README.md) at lines 178–200, which is where the procedure
itself is documented, and the narrative sits in `docs/reviews/2026-08-18-*.md`. **A record kept in
the work queue is read as work**, by five concurrent agents that take items top-down.

100 lines removed; a 12-line note left in their place saying what went and why.

## Q-480 — the rule line pointed at the wrong area

`CLAUDE.md`'s Date Arithmetic section said:

> *"Repo day-window helpers currently **hardcode** `DEFAULT_TZ` — thread the session tz through when
> touching them…"*

They do not. Re-verified against `main` today:

| helper | signature | callers |
|---|---|---|
| `getCalendarData` | `timezone: string = DEFAULT_TZ` | threads the session tz |
| `getRecentTrainedDays` | `timezone: string = DEFAULT_TZ` | threads the session tz |
| `getNextSession` | `timezone = DEFAULT_TZ` | **5 of 5** thread it, including `lib/ai-chat/tools.ts` |

A default every caller overrides is a safety net, not a hardcoded value. The other clause of the same
sentence **is** holding — `grep` finds zero local re-declarations of `DEFAULT_TZ` outside
`packages/shared/src/date-utils.ts` — so it is kept verbatim.

**Why a stale clause costs something:** it marks `lib/data` as a known-broken area, so whoever picks
up **Q-477** (the client-side timezone sweep) starts in the wrong place, finds nothing, and a
reviewer treats a repo call site as suspect when it is the pattern to copy.

The line now states what is true and keeps the instruction, with the reason attached — the default is
what makes forgetting silent.

## Verified

`pnpm check:rules` **Ran 49 of 49**. `check-backlog-pointers` 204 entries, no duplicates, all tagged.
`CLAUDE.md` stays at **1085 against its shrink-only budget of 1085**.

**Not exercised:** documentation only — no code path, no route, no device.
