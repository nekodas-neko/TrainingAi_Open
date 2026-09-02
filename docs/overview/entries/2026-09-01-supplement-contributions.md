# 2026-09-01 — a day's dose is a sum of contributions (BF-69 stage 1)

**Lane A · branch `lane-a/supplement-contributions` · migrations 254 + 255 · local SQLite v34 · v1.426.0**

Plan: [`docs/superpowers/plans/2026-09-01-dosed-substance-exposure.md`](../../superpowers/plans/2026-09-01-dosed-substance-exposure.md).
Stage 1 of four. Stages 2 and 3 are Lane B's; stage 4 stays gated on data.

## What the entry was actually about

BF-69 reads as *"dosed substances are stored but nothing reads them"* — a missing reader. The
planning session had already found that framing incomplete (there is essentially nothing to read:
**2 supplements, 1 log ever, `amount` NULL**), which is why the trends overlay is stage 4 rather
than stage 1. Building this half surfaced the other thing the framing hides: the storage was not
merely unread, it was **shaped so that a second writer would destroy data**.

`supplement_logs` was `unique (supplement_id, log_date)`. One row per substance per day, with the
upsert's own comment saying *"the row is one act of taking it"* — which was true only while there
was exactly one writer. Add the meal attachment the owner asked for and the same day has two writers,
and under that constraint:

- a meal carrying creatine plus a hand-tick left **one** value, last writer wins;
- the same meal logged twice recorded **one** dose;
- `unlogSupplement` soft-deleted **the day**, with no notion of who had written it — so unticking on
  the supplements page would wipe a dose a meal contributed, and deleting a meal would wipe a
  hand-logged one.

That third one is silent data loss, and it is why the schema had to move before the UI could.

## What shipped

Each act of taking something is now its own row carrying `source` (`'manual' | 'meal'`) and, for a
meal, `source_ref` — the `food_logs` row it came from. The day's amount is `SUM(amount)` over live
contributions, **derived on read**, never stored (the Stored Counters rule: every stored counter in
this project has drifted). `supplements` gained `started_on`/`stopped_on`/`dose_prompt`.

`listSupplements` returns a new `loggedAmount` — the day's total with a contribution count — beside
the unchanged `loggedDose`.

## Three decisions worth not re-deriving

**1. The replacement constraint is partial and manual-only, and the plan argues against something
adjacent to it.** §3 of the plan warns that replacing the whole-day unique with a narrower one would
break the feature, and names `(supplement_id, log_date, source)` — a three-column unique, which
would indeed cap meal contributions at one per day. What shipped is a *partial* index over
`source = 'manual'` alone. Meal rows are outside it entirely and add without limit; the tick stays
idempotent, which matters because a double-tap or an outbox mutation replayed after a retry would
otherwise double the recorded dose. The plan has been corrected in place rather than left to be
re-litigated.

**2. Its predicate deliberately covers soft-deleted rows.** The first version added
`AND deleted_at IS NULL`, which looked more correct and made an existing test fail: an untick
followed by a re-tick left **two** manual rows for one day, where the old code revived one in place.
Chasing that was worth more than the test — with two rows, the pull has to apply the tombstone and
the re-log in the right order or it deletes the live one, and `applyDelta`'s manual branch addresses
a row by its **natural key** (a locally-created log and its server row have different ids; the
server generates its own). Dropping the clause restores the far simpler invariant — **at most one
manual row per substance per day, ever** — and with it, every existing reconciliation behaviour.

**3. `loggedToday` still tracks the manual contribution only.** It first summed all contributions,
which reads as the more honest answer to *"did I take it today"* — and it is wrong for what the field
does. It is the checked state of the supplements page's tick, and that tick writes and removes
exactly the manual row. A meal's dose turning it on leaves a control rendered checked that refuses to
turn off, because DELETE has no manual contribution to remove. `loggedAmount` is what answers the
day-level question. This was caught against the running dev server, not by a test.

## The local migration is the risky part

SQLite cannot drop an inline table constraint, so v34 does what no local migration in this repo has
done: creates a second table, copies every row, drops the original, renames. Every other version in
that file only adds columns — and the two local migrations that have killed this app both did it by
**throwing on retry** and leaving `open()` throwing forever (#27's PRAGMA inside the upgrade
transaction, #85's non-idempotent `ADD COLUMN`).

So v34 is written so that any prefix of it can be re-run to completion: a resurrection stub before
the copy (without it, a retry after a successful `DROP` but a failed `RENAME` reads from a table
that no longer exists), `INSERT OR IGNORE` keyed on the primary key, and a `SELECT` naming only
columns present in both shapes. The two `supplement_logs` `ALTER`s were removed once the rebuild
existed — they were a second, non-idempotent way for the version to fail for nothing.
`RECONCILE_COLUMNS` carries all five new columns, and the replacement partial index is in
`RECONCILE_INDEXES` rather than only in the upgrade, because reconcile is the real schema authority
after a partial upgrade and a half-applied v34 would otherwise leave the tick able to double a dose.

**None of that is a device run.** See the `projectOverview.md` Known-Issues row.

## Two guards that reported their own documentation

`check-reconcile.js` failed on `supplement_logs_new`, the rebuild's scratch table — correctly, by its
own rule, and wrongly in substance: the table is gone before `reconcileSchema()` ever runs, so
registering it would make reconcile recreate a table nothing reads. It now carries a named
`TRANSIENT_TABLES` exemption which itself asserts that a listed table is actually dropped or renamed
away, so the exemption cannot hide a real gap. Named individually rather than matched by a suffix
convention, because a pattern-based escape hatch is how a data-loss guarantee gets widened by
accident.

The new chain test's PRAGMA check matched the migration's own comment saying *"No PRAGMAs here"*. It
strips comment lines now. That is the third time in this repository a source-scanning guard has found
its own documentation first.

## Verification

- Full suite green twice consecutively: **6,217 passed, 59 skipped, 737 files**. An earlier run
  showed one transient failure that did not reproduce and could not be identified on re-run — a
  `pnpm dev` server was being killed as that run started, which CLAUDE.md names as a contention
  cause. Recorded rather than claimed clean.
- `pnpm check:rules` — **Ran 67 of 67**, all passing.
- Twelve new assertions across two files: `supplement-contributions.test.ts` (server behaviour,
  against a real Postgres) and `supplement-contribution-chain.test.ts` (the offline chain, at
  source, because `getLocalStore` returns null under vitest's node environment).
- **Mutation-tested**: removing the `source = 'manual'` scope from `unlogSupplement` turns
  *"unticking removes only the manual contribution"* red. The assertion is absolute — one live row,
  and it is the meal's — so a mutation cannot move both sides of it.
- **Exercised against `pnpm dev`** with a real credentials session: create with a slash-form
  `startedOn` (normalised to dashes before it reaches the `date` column), PATCH `stoppedOn`,
  double-tick → one manual row, a meal contribution added alongside → day reads 5 mg over 2
  contributions, untick → meal survives at 3 mg with `loggedToday` false, re-tick → revives the
  manual row in place, `startedOn: "not-a-date"` → 400.

**Not exercised:** native SQLite and the v34 rebuild (Capacitor plugin, APK only), safe-area,
Samsung WebView rendering, drifted production data. The meal write path does not exist yet — the
tests insert a `source = 'meal'` row directly, which is the schema half this PR is proving, not the
stage-3 writer.

## What is next

Stage 2, Lane B: an amount and `dose_prompt` on the supplements page. Until it ships nothing can
write a number, so no series can start — which is the whole reason the overlay is stage 4 and gated
on data rather than on effort.
