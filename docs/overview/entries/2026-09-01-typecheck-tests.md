# 2026-09-01 · Lane A — test files are typechecked now (LB-37)

Branch `lane-a/typecheck-tests`. No migration, no schema change, no product behaviour.

## Every "TSC_OK" in this repository's history excluded every spec

`tsconfig.json` carried `exclude: ["node_modules", ".claude", "**/__tests__/**"]`. Across ~700 spec
files a test could reference a type that does not exist, call a function with the wrong arity, or
assert against an interface that had since changed shape, and `tsc` said nothing.

That matters more than it sounds because of what the gate is used for. Every session here treats a
clean `tsc` as its first check, and CI's Build job runs the same project — so the sentence *"tsc
clean"*, written in dozens of PR bodies including several of mine this session, carried **no
information about any test file**. A guard that cannot fail.

**Verified before building**, not taken from the entry: appending
`const deliberateTypeError: number = "not a number"` to a spec and running
`npx tsc --noEmit -p tsconfig.json` produced zero errors naming that file.

## 320 across 90 files, and the split is exact

| project | errors |
|---|---|
| `tsconfig.json` (tests excluded) | **0** |
| `tsconfig.tests.json` (exclusion dropped) | **320**, across 90 files |

Every one of the 320 is in a test file — there are no pre-existing non-test errors mixed in, so the
baseline has nothing to argue about. The entry measured **282 across 83** on the same day; it is now
320 across 90, which is itself the argument for a ratchet rather than a sweep.

**A real broken reference, and it is the case the entry was opened on.**
`lib/__tests__/ai-dynamic.test.ts` uses `import('../types/program').MuscleAssignment` twice and
`lib/types/program.ts` does not exist. The spec passes today.

## A ratchet, copying the hex-literal pattern

Every file holding errors is recorded at its current count and may only shrink; a file not listed
must have zero; a row for a file that is now clean must come out, or the list rots into an allowlist
that lets errors back into a file somebody already fixed. Three mutations, three caught:

| mutation | result |
|---|---|
| a type error in a file with no baseline row | *this file had none* |
| push a baselined file one over its number | *9 error(s), baseline 8* |
| a baseline row for a file with no errors | *rows to delete* |

**A run that produces no diagnostics at all is treated as a failed run, not a clean one.** `tsc`
exits non-zero whenever it reports errors — which is the normal case here — so the exit code cannot
distinguish "320 errors as expected" from "tsc fell over". Against a non-empty baseline, zero
diagnostics means the run did not happen.

## Two placement decisions, and the second was nearly wrong

**A second tsconfig rather than editing the first.** `tsconfig.json` is what `next build` reads;
dropping the exclusion there would put 320 errors in front of the Build job — a different and much
larger change than making new specs typecheck. `tsconfig.tests.json` extends it and overrides only
`exclude`, so the two projects cannot disagree about anything else.

**The step is in Build, not Custom Rules — the entry said Custom Rules and that would have failed
CI.** Custom Rules has no `setup-node` and no `pnpm install`: every step there is a dependency-free
`node scripts/*.js`, which is what keeps that job at ~25 seconds. This check needs `tsc`. Build
already installs and already typechecks, so it costs ~27 s there and nothing anywhere else. Found by
reading the workflow rather than by a red run.

Locally it is `pnpm typecheck:tests`, and `ci:local` now includes it — otherwise the local gate would
be quieter than CI, which is the failure this entry is about.
