# 2026-09-27 — BF-214 ①: the `claude_ro` views are one file, not 59 migrations

**Held for the owner.** He approved deleting the 59 migrations; the merge waits for his yes because
it changes what runs against production on every deploy.

## What changed

- `lib/data/postgres/claude-ro-views.sql` is the whole read-only view schema, generated in place.
  It was `289_claude_ro_views_grid_dimensions.sql`, moved byte for byte. A fresh regeneration against
  a migrated database was confirmed byte-identical before the move.
- `ensureSchema` (`lib/data/postgres/client.ts`) and `scripts/local-db/migrate.js` apply it after
  the migration loop, in a transaction, when `claude-ro-views.sql@<sha256:16>` is not yet in
  `schema_migrations`. `ensureSchema` logs a failure and keeps the previous views, which is how it
  treats a failed migration. `migrate.js` fails the run, which is what CI's Migration Check executes.
- **The 59 twins are deleted:** 287 → 228 migration files, 85,881 lines gone. Production has every
  one of those filenames recorded and never re-reads a recorded file, so nothing re-runs. The 18
  older twins that carried the owner's user id leave the working tree with them.
- `scripts/lib/migration-claims.js` floors the next number at 289. Without it, deleting 289 would
  have handed the number out again, and production already has a different file recorded under it.
- `claude-ro-views-file.test.ts` has four tests: no migration builds the `claude_ro` schema, the two
  appliers record the same marker, the file equals what the generator emits for the migrated schema,
  and the hash gate works (plus a broken file leaves the old views standing and records nothing).

## What the entry had wrong

- *"No CI check that the twin matches the schema"* is half-right. `claude-ro-readonly-role.test.ts`
  runs in CI, because the Tests job's `DATABASE_URL` is TCP, and it fails on a table with no view.
  Nothing checked columns. The regenerate-and-diff test does.
- The entry did not say that ① also removes the reason a column rename was impossible here: every
  historical twin named every column and was replayed.

## Verification

- **Mutation pass: 7 killed, 2 equivalent controls survived, 1 equivalent mutant.** Killed: hash gate
  removed; marker insert removed; `migrate.js` marker width changed; a column dropped from the file;
  a twin reintroduced as `290_…`; the allocator floor dropped. Controls: `=== true` on the gate, and
  `Math.max` argument order. The equivalent mutant was removing `BEGIN`: a multi-statement query is
  already one implicit transaction, so the file is atomic without it. The code comment now says so.
- **Migration Check, simulated:** fresh database → 228 applied, views rebuilt, 100 views; truncate →
  `--replay` clean; a third run rebuilds nothing.
- **First production deploy, simulated:** the ledger was given the 59 old filenames and no marker,
  then `pnpm dev` booted: `0 applied`, views rebuilt once, marker recorded. A second boot left a
  sentinel view untouched, so no rebuild.
- Touched tests and allocator tests pass; the full gate is in the PR.

## Not exercised

Production itself, and a real multi-replica deploy racing on the rebuild. Two replicas would both
`DROP SCHEMA` inside their own transactions; the second blocks on the first's lock and rebuilds
again, which is harmless and matches what a twin migration did.
