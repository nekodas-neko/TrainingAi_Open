# 2026-09-27 — `docs/agents/state/implementation-lane-b.md` 55 → 56

Raised by one line, deliberately, and the reasoning matters more than the number.

**Three lessons were evicted from this baton in three consecutive sessions** to stay at 55 — the
line-through sibling rule (pinned by a test, so the knowledge survived), `public/cats/` being build
output (its failing test names the cause, so that survived too), and narrative folded into adjacent
bullets twice. That is the ratchet doing its job: it forced real compaction rather than growth.

This raise is the point where it stopped doing its job. The line added is the `LB-171` lesson — a
**shipped** entry headed Lane B's READY list because its residue was written `**Keep / Done when:**`
and the parser could not see it. A session that starts by trusting the queue's rank order and does
not know this loses the time it takes to read a finished entry and work out why there is nothing in
it. There was no remaining eviction candidate whose knowledge is preserved elsewhere, so the
alternative was dropping a live lesson to make room for a live lesson.

**The preference is unchanged: compact before growing.** One line, once, after three sessions of
cutting — not a new default.
