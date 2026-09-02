## 2026-09-02 — a warning sign in front of a `Gate:` made it invisible, and Lane A's queue head was the casualty (LA-55)

**Branch:** `fix/backlog-decorated-gate-fields` · **Lane:** A · **No version bump** — tooling and
queue hygiene change nothing a user can see.

### What was wrong

**Q-388 was the number-one READY item for Lane A, and its own second sentence says
*"treat this as blocked on a device reading, not on a decision."*** Its first bullet read:

```
- **⚠ Gate: owner — VOID AS WRITTEN, not answered.**
```

`Gate:` is matched by `/^\s*[-*]\s*\*{0,2}Gate:/i` — the field name anchored directly after the
bullet's `**`. The `⚠ ` in between makes the whole field invisible, so `next-item.js` never parked
the entry. `check-backlog-pointers.js` already guards the *inline* form of this mistake and could
not catch this one either: **its own pattern is `\*\*(Gate|Needs|Verify):`, which needs the field
name adjacent to the asterisks — the same assumption that caused the bug.**

The tell that this had been costing something: the outgoing Lane A baton carried the line *"Q-388,
Q-289, Q-290, Q-275, Q-272 — the Tuning calibration block, owner-gated."* That is a human writing
prose to compensate for a tool that is wrong, and it only works until someone trusts the tool.

### The scan was wrong the first time, which is the part worth keeping

The first pass at measuring this hand-copied the field regexes into the scan and dropped a trailing
`\*{0,2}`, which made every ordinary `- **Verify:** device` look like a miss: **53 hits across 51
entries.** Reading the real patterns out of `scripts/lib/*.js` gave **14**, and of those **13 are
correct non-matches** — a line saying *"the `Gate: owner` was removed"* or *"✅ Gate: owner CLEARED"*
should not park anything.

**One entry was actually mis-bucketed.** The other three decorated lines (TN-16, Q-422, BF-94) each
duplicate a well-formed field elsewhere in the same entry, so they were harmless. Worth stating
plainly, because a finding of "51 entries" and a finding of "one entry" call for different work.

### What changed

- **Q-388 gets a real `- **Gate:** device`**, which is what its prose already said. It now parks
  with the reason `Gate: device`, and Lane A's READY head is Q-289.
- **Three commentary lines stopped pretending to be fields.** The first fix made them parse — and
  BF-94 then reported `Needs: BF-84, BF-84, BF-84`, because the parser reads every id on a `Needs:`
  line and the prose tail names it again. They are commentary *about* a gate, not a second
  declaration, so they now lead with the point instead of the field name.
- **`scripts/lib/decorated-field.js`** classifies the shape, wired into the existing guard in
  `check-backlog-pointers.js`. Extracted rather than inlined so the rule is unit-testable.

### The interesting half is what it must not flag

A check that fires on the thirteen legitimate lines is a check somebody turns off. Three decorations
are allowed, and each for a stated reason: a **backtick** (the Protocol section documents these
fields by name, so flagging it would fire on the text that teaches people the format), **✅** (the
gate is recorded as cleared), and a **struck-through** line (superseded, kept for the record).
Everything else before a bare field name is a declaration written where nothing reads it.

**Mutation-tested rather than reasoned about:** the original Q-388 line restored → flagged; `⛔
Needs:`, `🔴 Verify:` → flagged; `✅ Gate:`, `~~⚠ Gate:~~`, `` **`Gate: device`** `` → not flagged.
Eight unit tests in `scripts/__tests__/backlog-decorated-field.test.ts`, most of them negative.

The baseline is **empty**, which is the point — every occurrence was fixed rather than recorded as
debt, so the next one is a regression instead of a row.

### What this does not do

It does not check that a gate's *value* is still true. Q-388's gate is now `device` because the entry
says so; whether that device reading is still owed is the owner's and the device queue's business
(S9). And nothing here re-opens Q-388's actual question — the ring's power budget is unchanged and
the pending APK still has to reach the S25 before the measurement means anything.
