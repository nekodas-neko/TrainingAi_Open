# 2026-09-20 — TN-51 and TN-54 were filed, merged, and unreachable

**Branch:** `tuning/fix-tn51-needs-parse` · **Agent:** Tuning · **Docs-only.**

The owner's instruction was *"yes file these the other lanes will pick them up"*, about the two
entries blocking his next overnight chest-strap trial. They were filed and merged the same day. They
could not be picked up.

## Two independent reasons, both mine

**TN-51 carried a dependency nobody wrote.** The line read
`- **Needs:** — nothing. **Blocks the HRV half of PS-44.**` and `scripts/next-item.js` records *any*
entry ID appearing after `Needs:`. So the parser read `Needs: PS-44` — the exact reverse of the real
direction, since TN-51 is what blocks PS-44. The prose asserting "nothing blocks this" is what
created the block.

**Both entries carried `Gate: device`, which parks them.** The backlog protocol's own `Gate:` bullet
names this mistake twice (BF-45 2026-08-30, LB-26 the same day, by a session that had read BF-45's
warning). This filing made it a third time, also having read it.

## What is worth keeping: `Verify: device` is not the fix either

That was tried first, on the protocol's wording — *"a device requirement on unbuilt work is a
Verification line, not a gate"*. It is wrong for this shape: `next-item.js` prints `Verify:` under a
heading that reads **shipped**, and `check-backlog-pointers.js` describes it the same way throughout.
These entries are unbuilt. So **neither structured field describes startable native work that will
owe a device check** — `Gate:` says *cannot start*, `Verify:` says *already done*.

Resolution: carry neither, state the owed check as prose (`**Device check owed on merge:** …`), and
let the entry sit in READY where an implementer starts. The protocol bullet now says so, so the next
filer does not re-derive it. Written as prose deliberately — an inline `**Verify:` fails
`check-backlog-pointers.js`'s inline-field guard.

## Also in this diff

- **Both entries moved to the top of the queue.** The owner's *"lets get this sorted before my next
  trial"* is a priority statement and priority here is queue position; an urgency claim in an
  entry's body is decoration. Lane A's READY list now opens TN-54, TN-51.
- **TN-51's inflated physiology figure corrected in place** — it quoted the owner's RHR as up
  *"~13 bpm"*, which was a two-day excursion. The window mean is **+3.9 bpm**. The same overstatement
  is already retracted in three other places; this was the copy that survived.
- `docs/agents/state/tuning.md` — the Cooper test is struck as owed (it is done, and yielded 175; the
  "pinned 178" this baton described was never live — all 101 cached days use 187), the real owner
  actions are named, and a Method section records the filing-reachability trap.

## Not exercised

Nothing runs — this is documentation and queue ordering. `pnpm check:rules` **Ran 75 of 75**, all
passed, including `check-backlog-pointers.js`. Verified by reading `next-item.js --lane A` output
rather than by reading the file, which is the whole lesson.
