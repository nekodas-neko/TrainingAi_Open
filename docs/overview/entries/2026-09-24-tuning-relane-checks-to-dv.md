# 2026-09-24 — three owed checks moved to the device agent, and the parser that nearly stopped one

**Branch:** `tuning/relane-checks-to-dv` · **Agent:** Tuning · **Docs-only.**

Asked to re-organise the outstanding checks so each sits with the agent that can actually do it. The
answer turned out to be less about the checks and more about a field parser that silently keeps the
wrong value.

## Moved to DV — three runs that only needed a signed-in session, not a person

Each of these was waiting on the owner or on Lane A, and in all three cases what is owed is a
**measurement with an objective pass/fail**, which is the device agent's job description.

| entry | was | why it moves |
|---|---|---|
| **TN-62** — re-derive the stale readiness contributors | Lane A + owner gate | no code change; the deliverable is firing `backfill-derived-scores` and reporting what moved |
| **TN-1** — chronic stress refuses inside the granular layer | owner gate | the admin console reads it, and `scripts/device/README.md` names *"what the admin consoles read"* as in reach |
| **BF-13** — the baseline EMA seeds at zero | Lane A | the code shipped; only the run remains |

**The thing that made this possible is boring and worth stating:** both admin routes authenticate
through `auth()` + `requireAdmin` with **no bearer-token path**, so no sandboxed agent can fire them —
and `session.evaluate()` in the device harness runs *in the page*, which is signed in. That is the whole
distinction. It is not that the device is nearer the data.

**TN-62 is a production write and the owner authorised the device agent to press it (2026-09-24).**
Recorded on the entry as a deliberate decision, explicitly not generalisable: a data-dropping or
non-reversible write is still confirm-first. It also carries DV-13's hazard, because the shape matches
the console that left production unresponsive for ~8 minutes — **~370 queries per call against a
`max: 10` pool, one page at a time, dry-run first, never concurrent.**

## Kept where they were, with reasons

- **TN-2** — I claimed its gate was stale. **Withdrawn in place.** It is owed a `.constants.json` set,
  which is a real unsatisfied dependency, so the gate is honest and inert — a different thing from
  stale. TN-55 supersedes the work behind it anyway.
- **TN-58** — the two-week pass test came back to Tuning; it is one read-only query.
- Anything that is a judgement about **looks or whether something feels right** stays with the owner
  even though the phone is where he will look at it. That is the rule the re-laning was checked against,
  not an exception to it.

## TN-63 — the defect that ate TN-1's re-laning first

`laneFromLines` is **first-match-wins**, which `scripts/lib/lane.js` documents as the Q-529 failure. Add
a new field to re-lane an entry, leave the old one standing lower down, and the parser keeps the stale
one. Nothing in `next-item.js` says the entry was ambiguous.

Measured across every heading in the backlog:

- **34 entries** carry more than one lane field.
- **8 disagree** about the value — `LB-94`, `TN-32`, `OR-106`, `BF-111`, `Q-395`, `TN-19`, `Q-420`,
  `PS-7`. Three of those put an implementer letter second, so they are being served to the wrong bucket.
- The other 26 agree, which is harmless today and is exactly how the 8 were made.

**It bit twice in this session.** TN-1 kept an A-lane field on its `Branch:` line, so adding the DV one
changed nothing until the old one was **deleted rather than edited**. Then the note I wrote explaining
the trap re-created it, because the prose contained the literal token and the parser matched inside the
explanation. Filed as **TN-63 (Lane O)**: a check counting field-shaped lines per heading, Custom Rules
77 → 78. Its known cost is that an entry explaining this can no longer quote a field value inline.

## Not exercised

Nothing runs; documentation and queue edits only. **Not established:** whether the device agent's
`session.evaluate()` path actually reaches these two admin routes in practice — the README says the
consoles are in reach and the auth model says it should follow, but nobody has fired one from the
harness, so the first DV attempt on TN-62 is also the test of that assumption. The `vs_yesterday`
reading on TN-58 is two days old and deliberately **not** called a fail. `pnpm check:rules` result and
the entry count are below.
