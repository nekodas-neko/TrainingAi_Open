# 2026-09-16 — Lane A · a prose dependency at the top of READY, and a baton six PRs stale

**Branch:** `lane-a/tn31-needs-field-and-baton` · docs-only · no version bump

## TN-31 was the top of READY and was never startable

Picking it up, its own text said: *"which run type this maps to depends on TN-30's outcome. **Sequence
TN-30 first**, or the new session type gets built against an anchor that then moves."*

That is a `Needs:` written as a sentence, and `next-item.js` cannot see a sentence. TN-30 is itself
parked on `Needs: TN-25`, so the real chain is **TN-25 → TN-30 → TN-31** — three deep, with the
blocked entry sitting at position 1. It now carries `Needs: TN-30`; READY drops 14 → 13.

The entry also carried **two conflicting `Lane:` declarations** — a `**Lane:** A` field on line 2 and
a `**Lane: B**` bullet four lines later. The tooling reads the first; a human reads the last. Both
are now one declaration that states the split (engine half `packages/shared/src/running/**`, surface
half the components) and keeps Lane A per *"both → Lane A, engine half first"*.

**The general form, which the backlog README half-anticipates:** a queue position is not a work
assignment, and the file does not show which mechanism is holding an entry back. Three mechanisms can
park one, and only two of them are visible to the runner. **Read the entry for a prose dependency
before starting it — and convert it to a field in the same PR rather than just obeying it**, or the
next session pays the same cost.

## The baton was six PRs stale

`docs/agents/state/implementation-lane-a.md` still described the state before this session's six
merges. Rewritten, not appended — a baton that is half last week's is worse than none, because it
gets trusted.

What it gained is not a changelog. It is the three things that would otherwise be re-learned at cost:

- **A column rename is not available in this repo** (LA-114), with the mechanism: Migration Check
  replays every migration against the final schema, and the `claude_ro` view migrations each
  regenerate the full view set, so every one names every column.
- **A migration is not tested until it has been applied twice to the same database**, with the
  throwaway-DB recipe that reproduces CI locally. This session pushed a migration that `pnpm test`
  and `check:rules` both passed, because the local DB already had it applied once.
- **The four-entries table:** four entries this session had true measurements and wrong conclusions,
  each with its reusable form. That table is why the session re-verified before implementing, four
  times, and was right to each time.

Cut to pay for it: the old per-entry "why it is not startable" table, stale on arrival and answered
better by the runner.

## Verification

Docs-only; no code changed. `check:rules` **75 of 75**, `check-backlog-pointers` OK (53 `Needs:`, up
one), `check-doc-index-size` OK. TN-31 confirmed parked by re-running the runner rather than by
reading the diff.

**Not exercised:** nothing was run. The claim that TN-31 was unstartable is read from TN-30's own
`Needs: TN-25`, which the runner prints.
