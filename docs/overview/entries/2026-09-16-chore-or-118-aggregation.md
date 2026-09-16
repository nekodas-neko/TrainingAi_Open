# 2026-09-16 — seventeen entries, four asks — and a build hiding in a `Keep:`

**Branch:** `chore/or-118-splits-and-batches` · backlog only. No product code.

## The unblock: Lane B's READY was two, and one of its builds was filed as "not new work"

**Q-305's `Keep:` said the push:pull card section *"is Lane B's and is now unblocked"*** — the shared
grouping it waited on shipped as **LB-103 on 2026-09-13**. That sentence sat under a heading reading
*"shipped; only the stated residue is owed. **Not new work**"*, and the Keep carried an **inline
`Gate: device`**, which parks the whole entry because `keep.js` reads a gate from anywhere in the
block. So an unblocked Lane B build was in PARKED for three days while Lane B's READY list was two
items long.

Split out as **OR-118**. Lane B's READY: **2 → 3**.

**This is the second time an inline gate inside a `Keep:` has done this** — BF-46 was the first, in
August. The shape is worth naming: a gate written as prose inside a residue is invisible as a gate
and total in its effect.

**And I made the mirror-image mistake writing the split, then caught it:** OR-118 first carried
`Verify: device`, which means SHIPPED, so it filed unbuilt work under *"a look is owed, nothing is
blocked"*. Corrected to a plain **Verification** line. The field goes on when the code lands.

## Four asks instead of seventeen

Grouped on **what the owner has to be sitting in front of**, not on subject:

| grouping | entries | the one thing |
|---|---|---|
| `back-gesture-sitting` | BF-166, LB-107, LA-109, BF-100 | the Android system back gesture, which Playwright cannot fire |
| `admin-console-sitting` | Q-316/317/318/544/531, BF-10, LB-5 | `/admin` → Devices **in the APK** |
| `history-row-policy` | Q-298, Q-527, LA-21 | "a fix is forward-only — edit the history or leave it?" |
| `destructive-migration` | BF-144, LA-71, LB-42 | three migrations that remove data |

**The history-row grouping is the one that pays.** Three entries have been sitting unasked for weeks
because each felt too small to raise on its own — 10 rows, 1 row, 7 rows. Asked once it is a minute.
**And it has a decided precedent that should be offered with it: BF-81, 2026-09-01, the owner chose
no recompute** on 38 rows, told all three options and their costs. The reasoning generalises — a
partial re-derivation leaves a mixed-provenance column *harder* to reason about than a uniformly-old
one. Recommendation recorded: leave all three.

**`owner-admin-sitting` and `admin-console-sitting` are the same visit.** There is one device and one
person, so the entries wanting a *look* and the entries wanting the owner to *run* something are the
same screen on the same phone. Ten entries, one login.

## Two rules written down, because both were nearly broken here

- **An ask-grouping is not a `Batch:` when its members are migrations.** `CLAUDE.md` forbids batching
  a migration — its revert is a corrective migration. `destructive-migration` and `history-row-policy`
  are presented together and shipped strictly one at a time.
- **A `Batch:` cannot span lanes**, and `check-backlog-pointers` caught me trying: Q-533 is Lane A and
  the admin batch is Lane B. A batch ships as one PR, a PR is one lane's work. **The sitting is
  shared, the PRs are not** — a distinction the field cannot express, so it is prose on the entry.

## Result

Queue **340**. Lane B READY **2 → 3**. Seventeen entries reachable through four asks.

`check-backlog-pointers` clean on 340 · `pnpm check:rules` **Ran 75 of 75**.

**Surfaces not exercised:** none apply — backlog only.
