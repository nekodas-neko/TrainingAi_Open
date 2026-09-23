# 2026-09-23 — LA-129: the conflict was self-inflicted, by `--fix`

**Branch:** `lane-a/la129-fix-does-not-lower-tolerated-slack` · **Lane A** · one script and its
existing test file. No product code, no migration, no user-visible change.

## The entry told me to measure before building, and the measurement killed the premise

LA-129 proposed generating the doc-size baselines in CI to remove a conflict class, and carried a
`⚠ RE-VERIFY` block saying RV-134 had shipped a cheaper half hours earlier and that the tax should
now be *"mostly gone — measure it again before assuming the class still exists"*.

It does not exist. Take current `main`, strike forty lines from the backlog, touch no `.size` file,
and run the plain check:

```
check-doc-index-size: 1 file(s) carry slack within their band — not a failure:
    docs/implementation-backlog.md: 40 lines of slack (band 546) — lower it when you are next
    editing this file anyway.
exit 0
```

**No edit is needed.** RV-134's band already did that.

## So where were today's conflicts coming from? From me

`check-doc-index-size.js --fix` lowered the baseline for **any** non-ok verdict — including slack the
check tolerates. Running `--fix` after every edit is a habit, not a rule (it appears nowhere in
CLAUDE.md), and it meant every PR that struck a backlog entry — nearly every PR — rewrote
`docs/doc-size/docs/implementation-backlog.md.size`. Two concurrent PRs then collided on a one-line
file that neither of them actually needed to change.

This lane paid that three times on one branch inside forty minutes today, each costing a full local
gate, and wrote it up twice as evidence *for* LA-129. It was evidence for a one-line bug in `--fix`.

## What shipped

`--fix` now withholds when the gap is within the file's band, and **says what it withheld** — a
silent withhold would read as the flag doing nothing:

```
check-doc-index-size --fix: left 1 baseline(s) alone — slack within band (LA-129):
  • docs/doc-size/docs/implementation-backlog.md.size: left at 27313 (file is 27273, within its 546-line band).
```

`--tighten` lowers deliberately, which is the compaction sweep's job. Two things deliberately
unchanged, because they are what the ratchet is *for*:

- **growth still raises** the baseline, and
- **slack over the band still lowers** it — there the check genuinely fails, so a `--fix` that
  withheld would leave the gate red and look broken.

Verified all four paths against the real repo before writing the tests.

## Mutation pass

| # | mutation | result |
|---|---|---|
| 1 | withholding removed (the old behaviour) | killed |
| 2 | withholding widened to swallow growth too | killed — 3 tests |
| 3 | `--tighten` ignored | killed |
| C | `limit - lines <= slackBand(limit)` written as `slackBand(limit) >= limit - lines` | **survived** |

The control passed first time, which is worth noting only because the previous three did not: on
TN-60, RV-82 and DV-13 the control failed because the assertion pinned syntax rather than the
contract. This one compares a value.

## LA-129 is rerouted, not deleted

Every cost argument in it was a conflict cost, and that cost is gone. What CI-generation would still
buy is not carrying `docs/doc-size/**` at all — against the ceiling it removes, which **the entry
itself** named as the part worth keeping, and against a design question nobody has answered (how
growth is caught from a derived baseline).

That is no longer an implementer's call, so the entry moves to **`Lane: O`** with the measurement
recorded and an explicit *do not build this on the old justification*. The owner named CI-generation
as "the better long-term answer" and it is his to keep or strike; deleting the entry would have
thrown away his intent, and building it would have been acting on a premise that no longer holds.

## Not done

- **No sweep of the existing slack.** Several tracked files now carry tolerated slack that nothing
  will lower until someone runs `--tighten`. That is the compaction chore, and it is deliberate —
  doing it here would have written to exactly the files this change exists to stop writing to.
- **Failure surfaces not exercised:** none that matter here — this is a build-time script with no
  device or production path. It was run against the real repo in all four states as well as in the
  sandbox.
