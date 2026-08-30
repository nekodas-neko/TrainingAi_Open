# 2026-08-30 — DEXA storage (BF-41 / BF-2), Lane A

**Branch:** `feat/clinical-intake-storage` · **Lane A (Implementation)** · migration **240** +
`claude_ro` regeneration **241** · no version bump (nothing user-visible ships).

## What this is

BF-41's second slice. The entry's sequencing is RMR → DEXA → blood; BF-33 shipped the RMR *engine*
already, its UI is Lane B, so DEXA storage is the next thing Lane A can build. It also unblocks
**BF-2**, which sits at the head of the queue and needs somewhere to put the scan half of its first
calibration pair.

## What shipped

| Piece | Where |
|---|---|
| Tables | `lib/data/postgres/migrations/240_dexa_scans.sql` — `dexa_scans` (~40 columns) + `dexa_scan_regions` |
| Audit views | `241_claude_ro_views_dexa.sql`, regenerated; the child's FK path added to `scripts/generate-claude-ro-views.js` |
| Drizzle | `dexaScans` / `dexaScanRegions` in `lib/data/postgres/schema.ts` |
| Repository | `saveDexaScan` / `getLatestDexaScan` / `listDexaScans` (+ `DexaScanInput`/`DexaScanRow`/`DexaScanRegion`) |
| Route | `app/api/dexa-scans/route.ts` — GET (the series) and POST (a `.strict()` Zod gate) |
| Export | `dexa_scans` / `dexa_scan_regions` classified in `lib/export/export-map.ts` |
| Tests | `lib/data/postgres/__tests__/dexa-scans.test.ts` (16, DB-backed) · `app/api/__tests__/dexa-scans-route.test.ts` (13) |

## Decisions, and why

**The schema was written from the printout, not from a description.** BF-41's own rule, and the
same rule this repo applies to external API field names. The fixture in the DB test is the owner's
actual Hologic Horizon A report from `docs/clinical-baseline-2026-08-27.md` — every number in it is
one the report prints — so the round-trip test can show "keep every field" (BF-43) survived a
migration, a Drizzle schema, an insert, a select and a mapper. `rowToDexaScan` is the one of those
five that fails silently, as "save doesn't persist".

**Typed columns, not JSONB.** `measured_rmr` is the template BF-41 names, and the reason is that
BF-2's calibration and BF-33's FFM comparison both do arithmetic on named columns.

**Grams stay grams and percentiles stay percentiles.** The report prints fat as `20,547.5 g`;
converting on the way in would make the stored number something the printout does not say.
`pct_fat_young_normal` (93) and `pct_fat_age_matched` (89) are **percentiles**, share the 0–100
range with the percentages beside them, and the column names are the only thing that says so.

**Regions are a child table, and two of its rows are aggregates.** A region set is N rows, not N
columns — the same reasoning BF-41 gives for a blood panel's analytes, and it makes a twelfth region
a data change rather than a migration. `subtotal` and `total` arrive in that table too, so anything
summing it must exclude them; the migration and the route both say so where someone would look.

**A re-save replaces the region set rather than merging it.** A re-extraction that reads ten regions
must leave ten, or a scan quietly keeps two rows from a parse nobody confirmed.

**Negative T and Z scores.** A `min(0)` would reject every osteopenic result, which is most of the
ones worth storing; the owner's is −1.6. Bounded at ±15 instead.

**No source document is stored.** BF-41 recommends against it outright: extract, confirm, save the
fields, discard the file. The report carries a name, a date of birth and a patient reference; none
of those has a column, and none should get one.

**`source` is `manual` or `extracted`, with no third value** for a model's unconfirmed output — the
confirm step is what makes it one of those two.

## What the tests are actually for

Mutation-proven, anchors asserted first. Eleven mutations, all killed:

- dropping one field from `rowToDexaScan` · not clearing regions on re-save · dropping the `userId`
  scope from `listDexaScans` · taking the oldest scan instead of the newest;
- on the route: a dash-only date regex, `tScore: min(0)`, removing the duplicate-region check,
  dropping `.strict()`, dropping the slash normalisation, dropping the `no-store` header.

**One survived and changed the tests.** Handing every region row to every scan passed, because the
only batching test listed a user with a single scan — true of the leak it was written for and not of
the mis-attribution. A second test with two scans in one `inArray` read kills it.

**Two checks in the local gate did work here** rather than merely passing: the `claude_ro` generator
**failed closed** on `dexa_scan_regions` (a table that is neither user-scoped nor FK-registered is a
refusal, not an unscoped view), and `check-export-coverage.js` refused both new tables until they
were classified in `lib/export/export-map.ts`.

## Verified

- Full suite **655 files / 5,422 tests** green; `pnpm check:rules` **Ran 62 of 62**; `tsc --noEmit`
  clean; eslint 0 errors.
- `pnpm dev` against the local Postgres: POST with the real report (slashed date) → 200 and the
  dashed date stored; GET returns the series with `Cache-Control: private, no-store`; re-POST of the
  same date leaves one scan; duplicate region → 400; unknown field → 400; malformed date → 400;
  no session → 401; a 30 KB body → 413.

## Not exercised

**No device surface exists to exercise.** There is no UI, no local SQLite table and no outbox
domain for this — the route is reachable only by a client that has not been built. So the
device-verification gate has nothing to run against here, and this is not a change hiding behind
"not verified on device": it is server-only by construction, and the phone reaches it through a
Railway deploy with no APK.

Also not exercised: production data (the local DB is a fresh seed) and extraction (nothing extracts
yet).

## Next for this entry

BF-41 stays queued with a `Keep:` naming three things: DEXA **extraction** (Lane A, `generateObject`
against this route's schema), the **blood panel** tables (BF-1, Lane A), and the **upload / crop /
confirm surface** (Lane B) — which still owes the app's *own* crop-before-upload step even though the
owner hand-scrubbed the reports. Those are two different redactions and conflating them is the
security bug BF-41 names.
