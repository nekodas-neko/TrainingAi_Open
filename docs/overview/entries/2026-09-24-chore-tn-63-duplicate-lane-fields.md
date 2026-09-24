# TN-63 — two lane fields under one heading, and the queue routing that ate

**PR:** `chore/tn-63-duplicate-lane-fields` · **Lane:** O · docs + one check, no product code.

## What was wrong

`laneFromLines` (`scripts/lib/lane.js`) is first-match-wins, deliberately — it is what stops an
entry's prose outranking its own tag. The cost is that a re-laning done by *adding* a field, without
removing the old one, is routed by the stale value. Nothing in `next-item.js` output says the entry
was ambiguous.

## Measured, not quoted

TN-63 recorded **34 duplicates, 8 disagreeing** earlier the same day. Re-measured before the sweep:
**28 and 6** — two had resolved in between. The six: `LB-94`, `TN-32`, `BF-111`, `Q-395`, `TN-19`,
`PS-7`.

**`TN-19` was actively misrouted.** Its first field read *"surface only:
components/body-battery-card.tsx"*; its second says the defect is in the model and that the card
**must not be touched for this**. The parser was serving the first. That is the one case where the
later field was the correct one, which is why the entry's own advice — *the later field is usually
the newer intent, but the text is the authority* — was followed by reading all six rather than
applying a rule.

The other five resolved to the earlier field, four of them by CLAUDE.md's path rule (both halves →
Lane A, engine first).

## The 22 that agreed

Left alone they are the fuel: a duplicate is how a disagreeing pair gets made. Swept by keeping the
**first** field and demoting later ones to prose, which is behaviour-neutral by construction —
verified by snapshotting `laneFromLines` for all 480 entries before and after: **0 changed**.

One needed care: `LA-21`'s second lane line also carried `**Branch:**`, so demoting the bullet would
have destroyed another field. Only the `Lane:` fragment was removed.

## The check

`check-backlog-pointers.js` now fails on more than one lane FIELD under a heading. It counts
bullet-anchored lines — the same shape `laneFieldProblem` uses — so a prose mention of the token
does not match. That mattered: the note explaining this trap has to quote it.

**Custom Rules stays at 78.** TN-63 predicted 77 → 78; the check went inside an existing script
rather than becoming a new step, and the job had already reached 78 earlier the same day.

Mutation-checked: adding a second `Lane:` bullet to `LA-21` fails the check and names it; removing
it returns to green.

## Not exercised

Docs and a check only — no product code, no device path, no runtime behaviour.
