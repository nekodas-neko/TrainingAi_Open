# 2026-08-18 — Review sweep 39: cross-user isolation, two real accounts

**Agent:** Review 📖 · **Branch:** `review/cross-user-isolation` · **Docs-only.** Filed **Q-556** (low).

The last reachable item on this role's "structurally untested" list was a **second account** — every
ownership check to date had been read in source, never exercised by a different logged-in user. The
harness already carried a zero-data account with a saved session, so it needed no new infrastructure.
That is the third time in this run that a surface written off as unreachable was not.

**The ownership discipline holds.** Ten of eleven probes were rejected by the route's own check, not
by an accident of routing: reading A's recap, energy and timing; deleting A's workout session;
logging a set **into A's session**; completing A's workout. **The enumeration control passed too**,
which is the part worth having — the same operations against a *nonexistent* id return byte-identical
responses to those against A's id, so no route confirms which ids exist.

**Q-556 is the one exception, and it is not a leak.** `DELETE /api/activity-logs` with A's log id, as
B, returns `200 {"success":true}`. The database immediately afterwards shows the row **intact**,
`deleted_at` NULL, still owned by A, A's count unchanged — checked rather than assumed, because a 2xx
alone cannot distinguish "ignored it safely" from "did it". The scoping is deliberate and already
tested. The route simply cannot report what happened: `deleteActivityLog` returns `void`, so the
handler answers success unconditionally.

It is filed anyway, at low severity, for two reasons. It is **inconsistent with every sibling** — the
house posture, verified by the control in the same run, is 404 for both a nonexistent id and someone
else's, while this route is 200 for both; both are safe against enumeration but they cannot both be
the convention. And **offline-first makes a false success expensive**: a queued mutation that receives
a 2xx is confirmed and dropped from the outbox, so a delete matching zero rows *for a different
reason* — sync ordering, a row not yet on the server — is indistinguishable and gets confirmed away.
That second path was **not demonstrated**; it is why the response matters, not an observed bug.

**The first run of this sweep reported eleven clean results and proved almost nothing.** Eleven
probes, eleven non-2xx statuses, no leaks — a more convincing output than the corrected one. But six
returned `<!DOCTYPE html>`, Next's 404 page for a route that does not exist, because I had invented
paths where the real route takes the id in the body; a seventh was rejected by Zod before any
ownership check ran. Only three of eleven reached the code under test. **A 404 from a route that does
not exist is not evidence of access control** — and the tell was not in the status column at all, it
was in the body: HTML instead of JSON. The corrected run uses real paths, labels unmatched routes so
they cannot be miscounted, and adds the enumeration control.

That is the fourth measurement error of this run, and they share a shape: each produced a plausible
result in the direction I expected. Zeros looked like offline failure; 38% looked like partial cache
retention; eleven 404s looked like solid isolation.

**Not exercised:** one probe (`PATCH /api/activity-logs/<id>/metrics`) returned `400 Invalid body`
because my payload was wrong, so that route's ownership check remains unverified. Local seeded
database and web build — not production (`claude_ro` sees only the owner and cannot be used for this
at all) and not on device. Two accounts, not N, and nothing here touches admin-vs-user boundaries.
