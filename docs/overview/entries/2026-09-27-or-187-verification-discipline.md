# Three rules from three of this session's own mistakes

Orchestrator, 2026-09-27. Docs plus one baseline. The owner asked whether anything else was worth
adding to the knowledge bank. These are the three that earned it, all from failures in the last two
days rather than from imagination.

## 1. Verify with the tool that owns the question, never with a grep you wrote

Two wrong claims in two days, **both reported to the owner as fact before being checked**:

- `OR-174` said four surviving branches held live work, reasoning from *a branch name matching a
  queued entry*. Diffed afterwards, **not one held anything** — `main` was 208 lines ahead of one,
  byte-identical to another.
- A regex over the backlog reported **32 entries with no lane**. `parseEntries` said **2**. The scan
  missed the bare form (`— Lane A`) that 75 entries use and `lane.js` reads deliberately.

A grep is a guess at the shape of the data. The parser, the runner or the API is the authority, and
this repo has one for nearly every question worth asking. **Greps find candidates; they do not
count, and they do not conclude.** In `CLAUDE.md` under Communication, beside *never mark an issue
fixed from intent* — the same failure one step earlier.

## 2. Never write a field's token inside prose

The field parsers are **first-match-wins and know nothing about quotes or backticks.** A bullet
reading *"which is exactly what `Lane: T` is for"* **set that entry's lane to `T`**, ahead of its
real `- **Lane: B**` line. Separately, a rewrite left `Gate:` inside a quoted sentence and
`check-backlog-pointers` refused the push as a decorated field.

CI caught the second. The first was caught only because the value was re-read afterwards — which is
now the rule: **after any edit near a field, read the entry back through `parseEntries`.**

## 3. A sweep's action list is a hypothesis, not an instruction

`RV-156` named ~30 Known-Issues rows as ready for the archive. Tested one at a time, **eleven of
eleven failed the rule** — one described a live defect, one covered an entry still in the queue.

The sweep was not careless. It asked *"is this answered somewhere?"*; the archive rule asks *"is
anything still owed?"* Those agree often enough that the gap is invisible until tested. The
owner-gate triage had the same shape from the other side: a good fraction of gated entries said in
their own gate text that they were not decisions. **When a field and its own prose disagree, the
prose is usually right and the field is the bug.**

## The thing that is not a rule, and is the real finding

**`CLAUDE.md` has been raised five times in two days** — 1056 → 1061, across #1712, #1747, #1754,
#1757 and this PR. Every raise was justified on its own. All five were mine.

The file that every session reads before its first useful action is growing about a line per rule,
and **no ratchet stops it, because each raise argues its own case and wins.** `Q-220` measured the
orientation cost and is scoped to `projectOverview.md`; nothing covers `CLAUDE.md` itself. That is
not a rule to add — it is a compaction pass to schedule, and the argument for scheduling it is that
the agent adding the lines is also the one approving them.

## And the growth problem answered itself mid-PR

Writing this hit the runaway limit: `docs/overview/entries/` held **81 loose files against a 60
ceiling**, so the gate refused the push. Folded with `scripts/fold-journal-entries.js --limit=45` —
**81 → 36**, one new `history-2026-09-27-folded-2.md`, citations rewritten in two domain indexes,
six entries held back because an agent baton cites them. `check-doc-links` clean across 865 files.

Worth noting what that says about the `CLAUDE.md` observation above: **the journal has a ratchet and
a script, so its growth self-corrected the moment it mattered. `CLAUDE.md` has a ratchet and no
script**, so each raise is a judgement call made by whoever is adding the line. That asymmetry is
the actual gap, not the line count.
