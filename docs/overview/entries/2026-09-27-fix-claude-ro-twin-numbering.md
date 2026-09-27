# 2026-09-27 — the migration counter was half the problem; the other half is 92% of the corpus (BF-214)

An outside contributor pushed back on the review comment we left on `#1608`: *"it's impossible to
fix, because by the time I update it, it's already outdated. Which is why I raised the issue."*

He is right, and the advice was unworkable. `main` consumes **2 migration numbers a day**, every day
for the past week. His PR has been open since 25 Sep. Telling him to renumber to 290/291 was telling
him to run a race he cannot win.

## The root cause is not the counter

Measured on `main`: **59 of 287 migrations are `claude_ro` twins — 85,881 of 93,632 lines, 92% of
the entire corpus.** Each is a ~1,688-line full snapshot that drops and rebuilds all 98 views. Only
the newest affects the final schema.

That steady 2/day is **one real change plus one twin**. So the twin doubles number consumption, and
half of every collision he hits is a snapshot file that has no business owning a number. It is also
what makes the collision *silent*: two table migrations both apply and succeed, but two twins sort
by filename and the later one drops the schema the earlier just built.

## Two things the stress-test changed

**Runtime generation was the first draft and is wrong.** The generator is default-deny by
construction — a `DENY` map withholds the password hash, four Oura secrets and three image blobs,
and an unclassifiable table calls `process.exit(1)` rather than emitting an unscoped view. Two
properties depend on the file being checked in: what columns are exposed is reviewable in the diff,
and a classification failure lands where a human sees it rather than on a production boot with the
schema already dropped. So: one checked-in file, regenerated, applied after the migration loop.

**A naive timestamp rename is a trap.** Both appliers sort lexicographically, and
`"202609270534_x.sql" < "289_y.sql"` because `'0' < '8'` — every new migration would run before
every old one. Sorting by the leading integer fixes it, one line per applier.

## Three corrections to our own record

**`#1762` never merged.** It was reported as landed; it is open, conflicted, and has **zero CI runs**
— which is what a conflicted PR always looks like, since GitHub schedules no workflow for one.
Another session had already folded the journal and created the same `history-2026-09-27-folded-2.md`
filename. Its unique content — the seven-PR register and the two red required checks — is rebuilt
here surgically, as an insertion rather than a rewrite, so it cannot conflict the same way.

**`TN-80` on `main` is still the stale "three open PRs" version**, naming `#1592` which merged as
`#1616` before the entry was written, and missing `#1755` entirely.

**A grep of mine nearly published a false conclusion, one day after the rule against exactly that.**
Counting `red|blocked` in TN-80 returned 4 and I read it as "covered". The hits were
"c**red**ential", "fee**d**back", "fea**red**". Reading the entry showed it covers none of it. OR-187
says verify with the tool that owns the question; a count is not a read.

## Not exercised

Docs-only. No product code, nothing run on the device, and no migration touched — `BF-214` is filed,
not built.
