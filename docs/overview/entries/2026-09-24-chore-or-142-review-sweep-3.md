# 2026-09-24 — reviewing device sweep 3: the bookkeeping is clean, the filing is not

Orchestrator. Docs-only. Branch `chore/or-142-review-sweep-3`.

The owner asked for a review of the finished device sweep. Sweep 3 (#1491) is the latest; there is
no sweep 4.

## The sweep's own bookkeeping is exact

Every claim was checked against the queue rather than read off the summary:

| claim | result |
|---|---|
| closed: `RV-128` `RV-129` `BF-95` `BF-161` `OR-118` | all five absent from the queue ✓ |
| filed: `DV-16` `DV-17` `DV-18` | all three present, all `Lane: B` ✓ |
| kept: `BF-12` `BF-49` `BF-147` `Q-300` `RV-125` `DV-8` `DV-12` `BF-22` `BF-61` `Q-305` | all ten present ✓ |

Both observations that could have been dropped — `Q-305`'s colour-only rows and `BF-61`'s
swipe-to-Yesterday side effect — are written on their entries. **No orphaned findings.** For a sweep
this size that is a good result, and it is worth saying plainly before the rest.

## What the review found instead: five entries filed as finished while failing

The defect is not in the sweep. It is in what happens to an entry *after* a device check fails.

An entry ships a fix, carries `Keep:`/`Verify: device` meaning *shipped, a look is owed*, the device
runs that look and it **FAILS** — and nothing clears the field. The failure is recorded faithfully in
the text while the entry keeps printing to its lane under **"shipped; only the stated residue is
owed. Not new work."**

| entry | state |
|---|---|
| `BF-61` | failed 2 of 2 in sweep 3; titled *"fixed; device check owed"*; **`BF-94` blocked on it** |
| `BF-139` | shipped 09-12, failed on device 09-13, nothing since, still titled *"fixed"* |
| `BF-96` | same, its batch partner — owner: *"Day is cut off"* |
| `RV-103` | sweep 2 ran the exact check its `Keep:` asked for, and it failed |
| `TN-53` | same — HR recovery still plots 0-value points |

All five are corrected: fields removed, titles fixed, acceptance criteria written. **Lane B's READY
list gained five real defects that were invisible to it.**

**`BF-61` also gained a third acceptance clause.** Sweep 3 found that after the swallowed tap the
next rightward swipe moved Nutrition to **Yesterday**, 2 of 2. It is downstream of the same cause,
so one fix may clear both — but the old acceptance text would have **passed with the day still
jumping**, which is the more alarming half for the user.

**`BF-96` had a second, quieter problem:** three bullets reading `- **Keep — …**` that meant *keep
this knowledge*, not the residue field. The parser read the first as the field. That is `TN-59`'s
class — a prose sentence starting with a field's name.

## Deliberately not built

The durable fix is a check: an entry recording a device failure must not also carry
`Keep:`/`Verify:`. Filed as **`OR-139`** rather than written here, because it needs a baseline —
**`BF-98` is a legitimate counter-example**: it failed on 09-13, was fixed, and sweep 2 **passed** it,
so its later `Verify:` is correct. The text alone cannot order those events, so the check is
shrink-only with `BF-98` baselined. Building that carefully is worth more than building it tonight.

## The handoff warning, which is not ours to remove

The owner asked for the context-pressure warning to be taken out of the repo docs so every agent
stops getting it. **It is not in the repo.** Checked: no `Stop` hook in `.claude/settings.json`, none
in `settings.local.json`, none at user level; the only hooks are the repo's `SessionStart` and a
user-level git check. The phrase *"invoke the handoff skill"* appears in no config — only in an old
folded journal.

It is **Claude Code's own** context warning, printed at ~90% and ~95% of the window, and it cannot be
edited away from here. What *can* be fixed is agents obeying it: CLAUDE.md already says to rely on
automatic compaction, but the harness explicitly instructs a handoff, and an agent will follow the
louder voice. So CLAUDE.md now names the warning and says to ignore it, with the reason — handing off
at 90% throws away a warm cache to solve a problem the tool has already solved.

The window itself is a launch flag, `claude --autocompact <auto|100k–1M>`, set when a session starts.
That is the owner's lever, not a repo setting.

## Not done

- **No product code**, no device run.
- `OR-139`'s check is filed, not built.

## Gate

`pnpm ci:local` — exit 0, **Ran 77 of 77** Custom Rules steps, 812 test files passed.
