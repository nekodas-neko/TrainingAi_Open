# 2026-09-28 — the migration-number guidance named a script that does not exist

**Branch:** `fix/next-schema-number-script-name` · Orchestrator

An outside contributor (`jsboiss`) asked how the migration-numbering problem he raised as issue
#1620 had been resolved, since he could see a PR documenting it and no behaviour change. Checking
the answer found the work had largely shipped — and found a defect in the part he would actually
touch.

## What shipped, so the answer is on the record

- **The manual counter is gone.** `scripts/next-schema-number.js` computes the next free Postgres
  migration number and local SQLite version, **counting numbers claimed by branches that have not
  merged**. It replaced a hand-maintained table in `docs/implementation-backlog.md` that a CI check
  pinned to `max(merged) + 1` — which could only restate the filenames and could never reserve
  ahead of them. That table is what he asked to have removed, and it is removed.
- **The CI gate is now a duplicate check only** (`check-migration-numbers.js`): it fails when two
  migrations claim the same leading number, because `migrate.js` applies in filename sort order and
  `schema_migrations` tracks by filename, so a duplicate makes apply order ambiguous and neither
  file can be renamed once applied. It does **not** enforce an ordering counter.
- **`BF-214` (#1795) removed the bulk of the pain.** `claude_ro` views were re-issued as a full
  numbered migration on every schema change — **59 copies, 92% of the migration corpus** — and two
  landing together silently destroyed each other. They are now one generated file,
  `lib/data/postgres/claude-ro-views.sql`, overwritten in place and taking no number.

## The defect, fixed here

`check-migration-numbers.js` and `scripts/lib/migration-claims.js` told the reader to run
**`node scripts/next-migration-number.js`** — a file that **does not exist**. The script is
`next-schema-number.js`, and it also mislabelled itself in its own no-refs fallback message.

That text is what prints **when the duplicate check fails**, so at the one moment the guidance
matters, it named a missing script. Three references corrected.

## The finding it did not fix — `OR-202`

The tool now runs, and its output is close to unusable: a single run prints lines hundreds of
characters wide, with number `274` reporting the same filename across **44 branches**. Every one is
a phantom — stale branches still carrying the 59 `claude_ro_views_*` migrations `BF-214` deleted.

**A real collision is buried in that noise** (`284: merged 284_sleep_verdicts vs
origin/health-sample-storage: 284_apple_health_samples`). A tool whose true finding cannot be seen
is not doing its job, and this is the one outside contributors are pointed at. Filed as `OR-202`
with a recommendation to collapse identical claims rather than prune other agents' branches.

## What this means for PR #1608, not yet communicated

His PR is **41 lines of real change plus a 1,690-line generated view migration**
(`291_claude_ro_views_apple_health_samples.sql`). That pattern was deleted four days ago, and
`claude-ro-views-file.test.ts` **fails any PR adding a migration that creates the `claude_ro`
schema** — so it will fail CI despite `mergeable_state: clean`, which is a git-level answer and not
a CI one. His numbers 290/291 do not collide; `main` is at 295.

Net effect is in his favour: 1,690 of his 1,759 lines disappear. **Not yet posted** — the owner
asked how this stood before deciding what to tell him.

**Not exercised:** no product code changed; three comment/message strings in scripts.
