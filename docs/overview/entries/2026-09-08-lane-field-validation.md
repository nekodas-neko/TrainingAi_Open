# 2026-09-08 — a lane written as a word now fails at the point of writing (LB-59)

**Branch:** `test/workout-review-session` · **Lane:** A · tooling + docs, no product code.

## The defect

`LANE_FIELD_RE` needs a word boundary after the letter, so `**Lane:** O` classifies and
**`**Lane:** Orchestrator` does not** — the `O` is followed by `r`. An unmatched field returns
`null`, which the caller reads as *"unstated, so the path rule answers it"*, and the entry then
prints in **both** implementer lanes' READY lists. PS-38 sat at the top of Lane B's for a day on
exactly that, and a Lane B session picked up work that was nobody's.

## What shipped

`laneFieldProblem(line)` in `scripts/lib/lane.js`, wired into `check-backlog-pointers.js`. It fails
**exactly when the reader cannot read the value** — the same regex, called from the same file — so
the check and the reader can never disagree about what counts as valid. That is the whole design:
a separately-specified allow-list would be a second opinion about a field that already has one.

Only the **field** form is judged. Three quarters of the queue names its lane bare (`— Lane A`,
`**Lane B**`) and prose mentions one constantly; both are read loosely on purpose and neither is a
declaration. Anchoring at the bullet is what makes the exemptions free — a doc example and a
struck-through line each put a character before the field name.

**The failure mode is unchanged, deliberately.** An unreadable lane still prints in both lists; a
version that *hid* such an entry once took 96 of 203 out of both lanes at once. What is new is a
signal at the point of writing, where the mistake is cheap.

`check-backlog-pointers.js` also stops carrying its own private copy of the lane pattern and imports
`LANE_LOOSE_RE` — a second reader of one field is free to disagree with the first.

## Found while doing it

**BF-106 wrote `Lane: none`** — an owner action against production, so genuinely in neither
implementer lane. It has been reading as unstated ever since. Now `Lane: O`, which is what `O`
exists for (OR-103: work in neither implementer lane); `Gate: owner` parks it either way, so nothing
about its readiness changes.

## Notes

- Four mutations were run. Three were caught. **The fourth was not, and it was mine:** an explicit
  `~~` guard, copied from `decoratedField`, that no test could distinguish from its absence —
  because a struck-through bullet is written `- ~~**Lane:** X~~` and the anchor already rejects it.
  Worse than dead: it would have let a *half*-struck live value (`- **Lane:** ~~O~~ B`) through
  unflagged. Removed, with the half-struck case pinned instead.
- Verified end-to-end by reintroducing `Lane: Orchestrator` into the real backlog and watching the
  check fail on it.
- Not fixed here, and pre-existing: **Lane B's READY list is empty** — everything is parked or
  unclassified. Confirmed against `origin/main` before this change, so it is not a side effect.
  That is Lane B's or the Orchestrator's to work, not Lane A's to reshuffle.
