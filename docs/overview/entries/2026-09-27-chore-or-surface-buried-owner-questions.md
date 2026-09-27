# 2026-09-27 — BF-202 second pass: thirteen buried questions surfaced, and one first-pass error caught

**Branch:** `chore/or-surface-buried-owner-questions` · Orchestrator

The first pass found twelve live owner decisions sitting inside `Lane: A`/`B` entry bodies, where
the routing field cannot see them. This makes each one visible.

## `Ask:`, not a new entry each

Thirteen `Ask:` fields added rather than thirteen new `Lane: O` entries. `Ask:` promotes an entry to
WAITING **without moving it**, where `Gate: owner` would PARK it — the inversion `CLAUDE.md` already
warns about and which this sweep found twice in other entries. The buildable half of each entry
keeps its lane and stays startable.

Covering: `BF-144` (the whole `destructive-migration` group with `LA-71`/`LB-42`), `Q-540`, `Q-297`,
`Q-251`, `TN-72` (with `TN-74`), `TN-67`, `RV-166`, `PS-51`, `BF-145`, `BF-96` (with `BF-139`),
`LA-89`, `LB-38`, `BF-168`. Queue-wide `Ask: owner` went **16 → 28**.

## The second pass caught the first pass being wrong

`LA-121` was re-laned to `T` this morning on the strength of its own sentence — *"a scoring
decision, so not an implementer's"*. **The owner answered that on 2026-09-22**: do not port the
temperature ladder, let `tempZ` stand. Both `LA-121` and `LA-122` item 2 record the answer. The
re-lane parked startable dead-code removal behind a Tuning proposal that was not owed. Reverted.

**The rule it yields: a sentence saying a decision is the owner's does not mean it is still open.**
The first pass's own group ① said exactly that about five other entries, and then the sweep did it
anyway on a sixth. The check that would have caught it is reconciling against **`LA-122`**, the
ledger where Lane A's owner decisions and their answers are recorded — which `BF-202` said to do and
which the first pass did not do until the second.

The other four `T` re-lanes were re-checked against their own text and stand. `Q-420`'s open half
says outright *"picking them is a scoring change — Tuning proposes, the owner signs off."*

## `LA-122` is still partly open

Items **2b** (is a contributor worth 2.8% of readiness's movement worth keeping?), **2c** (the
`.size` conflict tax) and **4** (Q-29 Task 5, a destructive drop of the server raw archive) remain
open on that ledger. Item 4 overlaps `OR-192`'s retention question and the two should be answered
together rather than separately.

**Not exercised:** documentation only. Gates: `Ran 83 of 83` Custom Rules, `check-doc-links`,
`check-backlog-pointers` — all clean by exit code.
