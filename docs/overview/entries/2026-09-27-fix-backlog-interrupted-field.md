# 2026-09-27 — LB-171: a shipped entry was rank 1 of Lane B's queue, and the field said so

**Branch:** `fix/backlog-interrupted-field` · **Lane:** Implementation B · **Found:** working the queue.

## What happened

`node scripts/next-item.js --lane B` put **`RV-210` at rank 1 of READY**. Its own body says all three
of its fixes shipped and that it stays queued only for a device pass — so an implementer working the
queue top-down takes a finished entry and finds nothing to build. That is precisely the starvation
the `Keep:` field exists to prevent.

The entry had written it as:

```
- **Keep / Done when:** P26 shows no input or submit button covered, …
```

Every field matcher anchors the colon **directly after the name**, so `Keep / Done when:` parses as
nothing at all. Confirmed against `keepFromLines` — the parser that owns the question — rather than
by reading the regex: it returns `null` for that line and a field for `- **Keep:** …`.

This is `decorated-field.js`'s failure seen from the other side. That one catches a marker written
*in front of* a field (`⚠ Gate: owner`). This is words written *between* the name and the colon, and
the existing guard cannot see it for the same reason the bug exists: its own pattern needs `**Keep:`
adjacent.

## Scope, measured

Three entries, five bullets — found by asking the parser which `**Keep`-opening bullets it cannot
read, not by grepping:

- **`RV-210`** — `Keep / Done when:`, at **rank 1 of Lane B**.
- **`BF-191`** — `Keep ①, the owner's:` and `Keep ②, the device check:` (rank 8 of `DV`).
- **`BF-188`** — `Keep ①:` and `Keep ②:` (rank 41 of `O`).

All three now declare a real `Keep:` and carry their enumeration after the colon. `RV-210` has left
READY and prints under KEEP with its residue stated.

## The guard, and the false positive that shaped it

`scripts/lib/interrupted-field.js` + a new failure in `check-backlog-pointers.js`, keyed on the
colon appearing inside the bold span rather than on the extra words — **and suppressed when the real
parser can read the line anyway**, because the em-dash form `**Keep — three things:**` parses fine
and flagging it would be flagging correct entries.

**The first version was wrong, and running it is what showed that.** It flagged `RV-143`'s
`**Needs hardware the agent does not have (~5):**` — which is prose. Every one of these field names
is also an ordinary verb, and the backlog uses them that way with a trailing colon to introduce a
list. The separation: a verb is followed by its object, a **lowercase** word; an interrupted field
carries punctuation or an enumerator first (`/ Done when`, `①, the owner's`). With that, all nine
real shapes classify as intended and the sweep is clean.

Control-run: restoring `RV-210`'s original line fails the check with the exact message.
`scripts/__tests__/backlog-interrupted-field.test.ts` pins both halves, including the five prose
lines that must never trip it — the same shape `backlog-decorated-field.test.ts` uses, and for the
same stated reason: a check that fires on correct entries is a check somebody turns off.

## Not exercised

No product code and no runtime — this is queue tooling and backlog prose. Nothing here reaches the
APK, the device, or any user-visible surface, so there is no device pass to owe and no version bump.
