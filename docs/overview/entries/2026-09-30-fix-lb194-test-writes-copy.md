# 2026-09-30 — LB-194: no test writes into app source any more, and one that tries fails at the write

**Branch:** `fix/lb194-test-writes-copy` · **Lane A** · test harness only; no product surface.

## What was wrong

`check-comment-blindness.test.ts` appended its fixture to the real `components/workout/set-card.tsx`
and `app/api/user/goals/route.ts`, restoring them in `finally`. For each case a tracked file differed
from HEAD, inside a ~9-minute suite. Lane B's `git add -A` committed the fixture twice in one session,
and the restore then made the file read as an unrelated edit.

## What changed

- **The test writes a copy.** Each case puts a copy of the real file, with or without the appended line,
  in a gitignored `__check_fixture__/` folder beside it. It compares three runs made WITH the copy, so
  the copy's own pre-existing findings cancel out. All 11 positive controls still fire, so every
  checker scans the copy.
- **`vitest.source-write-guard.ts`**, installed from `vitest.setup.ts`, makes any test write, copy,
  rename or delete under `app/`, `components/`, `lib/` or `packages/` throw, except inside
  `__check_fixture__/` or `node_modules`. It uses `syncBuiltinESMExports`, so named imports from
  `node:fs` are covered too. `lb194-source-write-guard.test.ts` pins it, and it fails with the guard
  disabled (checked).

## Verified

The comment-blindness test passes 11 of 11 and the guard test 3 of 3. **A full local unit run with `DATABASE_URL` set** covered 1,194 files and 11,123 tests. The guard fired nowhere, so no other test writes into source. It reported 5 failures in 2 files, all timeouts under full parallel load on Windows: `check-hex-literals` (about 15 s per run here, which this test runs three times) and `q536-merge-redrain-clock-epochs` (a 10 s hook). Both pass run alone, 11/11 and 7/7.
