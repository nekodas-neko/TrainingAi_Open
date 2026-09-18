# 2026-09-18 — RV-57 is finished, and its last open question is answered

**Lane B.** Branch `docs/rv57-remove-shipped-entry`. Docs-only.

## Why this exists: I left a shipped entry in the queue

RV-57's code merged in **#1299** and the entry stayed in `READY`. It surfaced on the end-of-session
re-scan, printing as the top item of a lane I was about to report as device-blocked.

**This is the third time today**, and the pattern is worth naming rather than just fixing: LB-116 and
BF-172 were both cut to their residue in earlier PRs of this same session, and the baton already
carries the lesson. Shipping the code and clearing the queue are two acts, and the second is the one
that gets dropped, because the PR feels finished when CI goes green. **The re-scan is what catches
it** — `next-item.js` after the merge, not before it.

## The question the entry was still carrying, now settled

RV-57's last bullet read: *"Not established: whether `getRecentTrainedDays(userId, 365, tz)` returns
365 or 366 calendar keys — the off-by-one at the far edge is unverified in either direction, and
importing the constant does not settle it."* Correct: the import did not settle it. Reading both
sides does.

**Supplier** (`lib/data/postgres/adapter.ts:1197`) queries
`startedAt >= todayMidnight − 365 days` and `startedAt < todayMidnight + 1 day`. That window spans
`ago = 0 … 365` inclusive — **366 calendar days**.

**Consumer** (`app/session-select/session-select-content.tsx`) credits `ago = 0` separately, then
walks `for (let ago = 1; ago < STREAK_LOOKBACK_DAYS; ago++)` — `ago = 1 … 364`. Together that is
`ago = 0 … 364` — **365 calendar days**.

**So they differ by one, and the direction is the safe one.** There is no `ago` the loop asks for
that the payload does not contain. That matters because it is precisely BF-176 inverted: there the
loop walked 365 while the route sent 90, so every lookup past the window read as a *rest day* rather
than as missing data, and the streak became a property of the window edge — the owner's count went
90 → 89 on a day he trained. Here the payload is the larger of the two, so no absent key can be
misread as rest.

**Deliberately not changed.** The only observable consequence is that an unbroken streak of 365 days
reports 365 rather than 366. Widening the loop to `<=` would make a constant named
`STREAK_LOOKBACK_DAYS = 365` drive a 366-day walk, trading a harmless cap for exactly the kind of
off-by-one ambiguity the constant exists to remove — and the case it would fix requires a year
without three consecutive rest days.

Nothing is owed, so the entry is removed rather than kept.
