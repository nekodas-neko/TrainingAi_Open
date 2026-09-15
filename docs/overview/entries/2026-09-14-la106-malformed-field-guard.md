# 2026-09-14 — a field the readers cannot parse is now a CI failure (LA-106)

**Branch:** `lane-a/la106-malformed-field-guard` · **Lane:** A · Entry **LA-106**, filed by Lane A
on 2026-09-14 while starting BF-158.

## The defect

Every field in `docs/implementation-backlog.md` is read by a regex of one shape — the name, wrapped
in at most `**`, then the colon:

```
/^\s*[-*]\s*\*{0,2}Needs:\*{0,2}\s*(.+)$/i        next-item.js:73
/^\s*[-*]\s*\*{0,2}Gate:\*{0,2}\s*([a-z]+)/i      next-item.js:76
```

Asterisks and nothing else. BF-160 wrote ``- **`Needs:` BF-158**`` with a **backtick**, the
dependency did not parse, and **BF-160 printed as READY #1 while BF-158 — the entry it needs — sat
at #2**. Nothing anywhere reported it; the field was simply invisible.

**The `Gate:` case is the one that matters and had not happened yet.** The same shape governs it, so
``- **`Gate: owner`**`` would park nothing, and an agent would be handed owner-gated work at the top
of its queue with no sign anything was wrong. `Needs:` mis-orders a list; `Gate:` crosses a line the
owner drew.

## What shipped

A section in `scripts/check-backlog-pointers.js` that fails on a line a human plainly meant as a
field — bullet, any run of emphasis characters, the name, the colon — which the canonical regex then
does not match.

**Not a widened parser.** LA-106 was explicit that teaching the readers to accept backticks rewards
the ambiguity, and it is right: that leaves two spellings of every field for the next reader to
disagree about. A malformed field should be loud, not tolerated.

**Seven field names, not the four the entry listed.** `Lane`, `Needs`, `Gate`, `Batch`, `Reference`,
`Verify` and `Keep` share the shape, so they share the failure, and the extra three cost one array
element each. `Batch:` is worth calling out — a batched entry that silently loses its batch ships
alone, which is the opposite of what the field is for.

**The baseline is EMPTY.** Zero malformed fields exist today — BF-160 carried the last one and that
entry left the queue hours ago — so this ships as a regression guard rather than a debt row, the
same footing as `check-aest-midnight-timezone.js`.

## Verification

**Mutation pass, real exit codes captured:**

| mutant | exit |
|---|---|
| ``- **`Needs:` BF-158`` — BF-160's exact shape | **1** — flagged |
| ``- **`Gate: owner`**`` — the case the entry says matters most | **1** — flagged |
| `- _Batch:_ some-slug` — a name the entry did not list | **1** — flagged |
| control: `- Needs: BF-158`, no emphasis at all | **0** — survived |

The control is a *valid alternative form* rather than an equivalent mutant, and that is the property
worth testing: `\*{0,2}` allows zero asterisks, so the readers do parse it, and a check that flagged
it would be over-catching.

`node scripts/next-item.js --lane A --all` and `--lane B --all` are **byte-identical** before and
after, which is the entry's own second verification step: nothing about how a well-formed entry
sorts has moved.

## Not covered

The check reads lines inside entries, so a malformed field written *above* the first `###` heading
is invisible to it. Nothing lives there today and the file's shape makes it unlikely, but it is a
gap rather than an impossibility.
