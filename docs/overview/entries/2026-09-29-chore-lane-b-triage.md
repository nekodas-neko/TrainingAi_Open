# 2026-09-29 — a `Needs:` field that says "nothing" parked six entries

**Branch:** `chore/lane-b-triage` · tooling and queue hygiene. No product change, no version bump.

Lane B's READY list read **0** — *"nothing startable — everything is parked or unclassified"* — with
46 entries in KEEP owing mostly device passes this lane cannot perform. Triaging that rather than
inventing work is what found the cause, and it was not the queue.

## The bug

`parseEntries` reads a `Needs:` field with
`/^\s*[-*]\s*\*{0,2}Needs:\*{0,2}\s*(.+)$/i` and then extracts **every entry id from the rest of the
line**. So the sentence explaining that a dependency was *removed* put it back:

```
- **Needs:** — nothing. **⚠ This said `LB-149` until 2026-09-28, and the dependency was INVERTED.**
```

The field declares **nothing**. The parser returned `needs: ["LB-149"]`, `next-item.js` parked the
entry, and `LB-166` — shipped and CI-verified — sat in PARKED where it reads as neither work nor done.

**Measured: six entries across four lanes**, each parked by its own clearing note.

| Entry | Lane | Its own words in the line that parked it |
|---|---|---|
| `LB-166` | B | *"This said `LB-149` until 2026-09-28, and the dependency was **INVERTED**"* |
| `BF-220` | B | *"Shares a cause with BF-219 but is **separately buildable** and separately useful"* |
| `BF-138` | B | *"**Read** BF-134, BF-137 and TN-29 **first**"* — a reading order, not a dependency |
| `BF-221` | A | *"this is the code half and is **buildable now**"* |
| `BF-192` | A | *"answered by the owner on 2026-09-24 and are **carried here so this entry is buildable**"* |
| `BF-137` | T | *"**Cross-reference** TN-29, which catches this instance through a different mechanism"* |

Every one says, in that very line, that it is not blocked.

## The fix

`declaresNothing(value)` in `scripts/lib/backlog-entries.js`: when a `Needs:` value opens with
*nothing* or *none*, the id extraction is skipped and the prose after it is treated as a note to a
human, which is what it is.

Same class as `decorated-field.js` (a field invisible behind a warning sign) and the
comment-blindness guard: **a matcher reading a mention as a declaration.** That is three instances of
this class in one session — a path-shaped grep calling a live component dead (OR-115), an e2e
assertion tripping on its own docstring (Q-231), and this.

**The fix is narrow, and `BF-139` is the control.** It carries a real `- **Needs: LB-157**` *and* a
later *"Needs: nothing more"*; it stays parked on LB-157 exactly as it should.
`scripts/__tests__/backlog-needs-nothing.test.ts` (6 tests) pins both directions — a clearing note
reads as no dependency, a real field still reads as one, and an entry with both lines still parks.

⚠ Its first draft used `ZZ-` fixture ids and **parsed to nothing at all**, because a prefix
`scripts/lib/entry-id.js` does not know is dropped **silently** rather than rejected. That is the
failure mode CLAUDE.md warns about for a new role's letter, met first-hand; the fixtures use `PS-`.

## Queue hygiene that the false park was hiding

`LB-166` is **removed**. It shipped on 2026-09-28 (the four-way E2E shard split) and its own entry
already recorded ✅ SHARDED and ✅ VERIFIED ON CI; the protocol step of clearing it was skipped because
PARKED is not where anyone looks for a finished entry. Today's run `36612516981` concluded `success`
with 15 jobs and 0 failures — four shards at roughly 9–11 minutes each against a 25-minute per-shard
timeout, and the whole gate → shards → rollup sequence inside ~14 minutes, against the 45-minute cap
the unsharded suite had been hitting. Its concern is answered.

Lane B's READY list is now **2**: `BF-220` and `BF-138`.

## Not exercised

- **The other lanes' queues.** The fix unparks `BF-221` and `BF-192` (A) and `BF-137` (T) as a side
  effect. That is correct by each entry's own text, but no judgement is offered here on whether those
  are the right next items for those lanes — that is theirs and the Orchestrator's.
- **Whether other fields have the same blindness.** `Gate:` takes a single word (`/([a-z]+)/`) so it
  cannot absorb prose; `Verify:` was not audited. Worth a look, not looked at.
- **No product code changed.** `scripts/` and one test file only.
