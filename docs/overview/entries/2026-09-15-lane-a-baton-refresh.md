# The Lane A baton said six items were startable; five of them were not

**Lane A · branch `lane-a/baton-refresh` · docs only.**

## What was wrong

`docs/agents/state/implementation-lane-a.md` carried a `Now` section dated 2026-09-13 reading:

> *"Startable, top first: BF-164, PS-41, PS-42, LA-76, Q-52, Q-28."*

Checked against `main`: **BF-164 and PS-42 have shipped** and are out of the queue entirely (#1201,
#1204); **PS-41 carries `Gate: owner`**; **Q-52 is PARKED on `Needs: LA-110`**, which is itself
unanswered; **Q-28's own entry says not to build on the measured number**. One of the six, LA-76,
is still queued — and it is waiting on an owner decision its own entry says to ask first.

The baton's own warning line is what makes this worth a PR. It says a stale *"nothing startable"*
reads exactly like a true one. The inverse is worse: a successor reading this would have picked
BF-164 off the top, found nothing to do, and had no way to tell whether the entry or the baton was
lying. The container is ephemeral, so this file is what a successor gets.

## What the refresh contains

A full rewrite, never an append — the standing rule, and the reason is visible here: half of this
file was accurate and half was three days wrong, and appending would have left both.

The `Now` section is now a table of all nine READY entries with **why each is not startable**, so the
next session can disagree with a specific reason rather than re-deriving nine of them. Also folded
in: the six open owner decisions; that PR #124 is merged (BF-9's entry claimed otherwise); the
merge-verification rule that a body-only edit has no heading diff (the PS-41 gate loss, recovered in
#1207); and two new gotchas earned today — prove a behaviour-preserving refactor by *running* both
versions rather than reading them, and re-read a plan against its source entry before building from
it.

## The teardown race named the same file again, which the doc said would matter

Gating this hit the vitest teardown race for the **eighth** time, naming
`lib/__tests__/hr-read-routes.test.ts` — the file `docs/local-dev-database.md` explicitly said would
matter if it recurred. It now accounts for **5 of 8** sightings while three other files account for
one each.

That does not restore the single-file theory the 2026-09-11 amendment retracted on one miss, and it
is recorded so as not to overclaim: the honest summary is *mostly one file, but not only*. What it
changes is where a file-based trace would start — the fire-and-forget `upsertWorkoutHrStats` shape is
a lead again rather than a discarded one. Nothing about the operational rule moves: re-run settles
it, and the re-run was clean, eight for eight.

## A small thing worth not repeating

The rewrite first claimed its own line count, which went wrong twice in ten minutes because every
subsequent edit invalidated it. The number is gone rather than corrected a third time — `wc -l` is
the check, and a figure that re-breaks on every edit is a liability in a file whose whole job is
being true.

## Failure surfaces NOT exercised

Docs only; nothing runs. `pnpm ci:local` green — **Ran 75 of 75 Custom Rules steps**, 919 files /
8,717 tests.
