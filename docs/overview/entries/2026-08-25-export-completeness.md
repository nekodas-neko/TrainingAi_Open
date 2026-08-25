# The export covered 26 of 82 tables and said nothing about it (Q-288)

**Branch:** `fix/export-completeness` · **Lane A** · no migration · Custom Rules 55 → 56

## Order mattered, and the entry said so

The route's comment claimed it streamed "rather than buffering the whole export in memory". Only the
per-table `ReadableStream` enqueue was ever true — `exportUserData` read each table with a single
buffering `pool.query`. Harmless across 26 small tables, an OOM the moment a bulk one is added. So
**pagination landed before coverage**: adding `oura_heartrate` on top of the old read would have been
strictly worse than the bug it fixed.

Reads now paginate by primary key, reusing `getPrimaryKeyColumns`/`quoteIdent` from the Q-530
snapshot module rather than growing a second copy. A table with no primary key **throws** instead of
falling back to an unpaginated read.

## Exhaustive by construction, not by care

`lib/export/export-map.ts` is the single authority: **84 tables — 61 exported with a scope, 26
excluded with a written reason, 16 soft-delete filtered.** `scripts/check-export-coverage.js` fails
on a `pgTable` in neither record, on one in both, and on a stale entry naming no table. **A new table
cannot be forgotten, only classified** — which is the actual fix. Hand-extending the two arrays would
have reproduced exactly the drift being fixed.

**Not driven from `generate-claude-ro-views.js`**, the entry's first suggestion. Its views scope to
ONE fixed owner via `app.claude_ro_owner`; this export scopes to whoever is asking. Coupling a
per-request export to the security-critical read-only view surface puts both on one blast radius for
no shared behaviour. Its `VIA` predicates are copied across with their reasoning, which is the part
worth reusing.

## The exclusions are written down rather than absent

Credentials (2), shipped catalogue (6), app-internal ops (13), raw BLE frames (3), and 2 rows jointly
about another account. `oura_raw_samples` alone is 58 MB of hex, and everything it encodes reaches the
user through the decoded tables — all of which *are* exported.

**`oura_heartrate` and `rr_intervals` are exported despite their size.** They are readings taken from
the user's body, the least omittable thing in a health takeout, and including them is only safe
because the read paginates now.

A `_manifest` line leads the file with every excluded table and its reason. The entry's defect is
*"nothing signals the omission"*, and a bigger file does not fix that.

## Two things the tests caught that reading had not

1. **The hand-written `SOFT_DELETED` list was wrong in both directions** — two tables invented,
   thirteen missed. A missed one means a takeout that resurrects content the user deleted. The check
   now derives it from `schema.ts` and fails on a mismatch; it caught a regression again minutes
   later when a backup restore silently reverted the fix.
2. **The sync-domain scanner flags any `domain: '…'` literal**, and the export's NDJSON line label
   shares the field name. Excluded by prefix, with the reason written into the test — and worth
   knowing that the pre-existing `domain: "goals"` had been sliding past **on quote style alone**.

## Verification

Five DB-backed tests against real Postgres, **both load-bearing ones proven by mutation**:
stopping after the first page fails the 5,001-row case, and unscoping a two-deep FK predicate fails
four of five including the cross-user leak.

- `pnpm check:rules` — Ran 56 of 56. `tsc --noEmit` clean, `pnpm lint` 0 errors.
- Full suite: 4746 passed, 51 skipped, 2 pre-existing unrelated failures (missing `qrcode`).

## Not exercised

**No full export has been run against production.** `oura_heartrate` + `rr_intervals` are 46 MB of
table and inflate as NDJSON; memory is bounded now, but a **request timeout on the real dataset is
untested**, and that should be run before any portability claim rests on this. Nothing was seen on
device and `pnpm dev` could not be run (missing `@sentry/nextjs`).

`goals` is still a repository call rather than a table, so it sits outside the map and the coverage
check cannot see it.
