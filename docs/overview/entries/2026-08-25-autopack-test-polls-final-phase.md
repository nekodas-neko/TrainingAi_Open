# 2026-08-25 — the autopack test asserted a phase it never waited for (BF-18)

**Branch:** `fix/autopack-test-polls-final-phase` · **Lane A** · one test file. No product change.

`Tests` went red on PR #438 — a **docs-only** change whose entire diff was markdown — with
`AssertionError: expected 8 to be +0` at `oura-autopack-ingest.test.ts:82`. The file passed locally
3/3 in under ten seconds. A required check that fails at random on work that cannot have caused it is
worse than a check that fails honestly: it teaches everyone to re-run rather than to read.

## The assertion was checking the wrong moment

The packer runs three phases per bucket and **deliberately not in one transaction** — seal, then
insert-and-verify-by-reading-back, then delete the hot rows by primary key. Its module docstring
explains why, and that design is not the thing to change.

The test waited for phase 2's row to appear and then asserted phase 3's effect with no wait at all:

```js
expect(await until(async () => (await packedRows()) === 1)).toBe(true)   // polls for the packed row
expect(await coldHotRows()).toBe(0)                                      // asserts the delete, unpolled
```

`8` is the eight cold frames still in the hot tier because the delete had not committed yet. Line 81
passing is what proves the diagnosis rather than merely suggesting it: the packed row existed, so
packing had started and only its last phase was outstanding. The assertion allowed that phase exactly
zero milliseconds, which holds on an idle machine and does not on a CI runner sharing one Postgres
with ~380 other test files.

## Reproduced, not inferred

BF-18 records that the failure needs a loaded runner, and a sandbox is not one. Injecting an 800 ms
lag between phase 2 and phase 3 of the packer stands in for that load, and the result is exact:

- **original assertion, with the lag** → `AssertionError: expected 8 to be +0` at
  `oura-autopack-ingest.test.ts:82:33` — the same message and the same line as CI
- **fixed assertion, same lag** → 3 passed

The lag was removed afterwards; `oura-raw-pack.ts` is untouched by this branch.

## The fix

Poll for the packer's finished state instead of its first observable one:

```js
expect(await until(async () =>
  (await packedRows()) === 1 && (await coldHotRows()) === 0)).toBe(true)
```

with a comment saying the phases commit separately, so the next assertion added here polls too. The
`until()` budget is unchanged at 5,000 ms and the file stays in the `unit` project — raising the
budget or moving it to the 60 s `rollup` project would have hidden the defect rather than fixed it,
which is what BF-18 explicitly rules out.

## The sibling sweep, and what it did not find

The entry asks for one, on the grounds that any test polling one phase of a multi-phase write has the
same shape. Three results, all negative in a useful way:

- **`oura-autopack-ingest.test.ts` is the only file in the repository with an `until()`-style poll.**
  The poll-one-phase-assert-another shape exists nowhere else.
- **Three fixed-sleep-then-assert sites** — `migration-test-lock.test.ts:36`, and lines 111 and 127 of
  this same file. All three are **negative** assertions: *the throttle held*, *the packer refused*,
  *the second lock was not acquired*. A too-short sleep there can only produce a false **pass**, never
  the random red this entry is about, and lengthening the sleeps would cost suite time without making
  any of them more truthful. Left alone deliberately.
- **Four other test files call `insertOuraRawSamples`** and so also trigger the fire-and-forget packer
  (`adapter.ts:5118`). None of them sets `recorded_at` in the past, so no bucket they create is
  sealed, the packer finds nothing to pack, and it cannot disturb their assertions.

## Verified

- `oura-autopack-ingest.test.ts` — **3 passed**, run four times.
- The reproduction above, which is the part that matters: the unfixed assertion fails under an
  injected phase-3 lag and the fixed one does not.
- Full suite green. `pnpm check:rules` **Ran 56 of 56**. `pnpm lint` 0 errors.

## Not exercised

Nothing on the device — this is a test file. **The failure was not reproduced on a real loaded CI
runner**, only under the injected lag that stands in for one; that is a model of the cause, and the
match on message and line number is the evidence for it. The genuine confirmation is the absence of
this failure over the next weeks of PRs, which no single run can supply.
