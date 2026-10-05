# 2026-10-05 — LB-198: `vs_normal_touched`, the second boundary inside question 1

**Branch:** `feat/lb198-vs-normal-touched` · **Lane A** · migration `202610050636`, local SQLite v47.
**Held, not merged:** a migration PR, merged by hand once the device sitting is over (see OR-207).

## Why

`vs_question` (LB-190) marks the wording change. LB-191 then moved a second boundary inside question 1:
the picker seeds "About the same", so an untouched Save stores a neutral the owner may never have
considered, and rows on both sides read the same. It feeds a scoring input, so pooling them
contaminates a calibration.

## What changed

- A nullable `day_checkins.vs_normal_touched` (migration, schema, claude_ro twin, local v47). **NULL
  means unknown** and is what every existing row holds. False would claim an untouched seed that may
  have been a considered tap. A CHECK refuses a flag with no answer, written with explicit
  `IS NULL` / `IS NOT NULL` so it cannot repeat the `NULL IN (1, 2)` mistake of LB-190's first draft.
- `resolveVsAnswer` returns the flag beside the pair for both write paths. A client that does not say
  gets NULL, never false, and a legacy-key outbox mutation is unknown too.
- **The sheet sets it from a real tap and nothing else.** `vsTouched` is flipped only in the picker's
  `onChange`, starts false on a fresh sheet, restores what was stored (null stays null), and is sent only
  beside an answer. Save never infers it, which a source pin enforces.
- `food-logging-complete` keeps the stored flag when it saves an existing row.

## Verified

- `lb198-vs-normal-touched.test.ts` (resolver, and real Postgres: false and true stored, NULL for a
  silent client and for the legacy key, repository read-back, CHECK) and `lb198-local-touched.test.ts`
  (the shipped store round-trips true/false/unknown, a pull carries it, and the sheet pins).
  `migrations.test.ts` covers v47. The Postgres directory (228 files, 1,404 tests), local-store,
  nutrition, check-in and API suites all pass. The claude_ro twin tests pass over TCP with none skipped.
  tsc, test typecheck and `check:rules` (86 of 86) are clean.
- Migration applied to the owner's snapshot: 104 check-ins, 4 answered, 0 flagged (all unknown, as
  designed). `pnpm dev`: `vsNormalTouched` false, true and omitted stored as false, true and NULL, and a
  non-boolean was refused. The row was removed afterwards.

## Not exercised

Local v47 on the APK, and a real tap on the sheet (Known-Issues row extended).
