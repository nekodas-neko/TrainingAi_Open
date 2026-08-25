# 2026-08-25 — a dead repository method is now a CI failure (LA-26)

**Branch:** `feat/check-dead-repo-methods` · **Lane A** · `scripts/` + CI. No product change.

## The class this closes

A method on the `WorkoutRepository` interface that nothing calls is invisible to every guard the
repo has. `tsc` does not flag it — an unused *export* is not an error. Lint does not flag it. The
tests pass, because a test that touches it calls it directly. So it ships, and the only way it has
ever surfaced here is somebody asking why a production table was empty:

- **Q-301** — `saveRunningBaseline`/`getRunningBaseline` and `running_baselines`. The writer landed
  in migration 146 *after* the only `running_plans` row existed, so it never fired; `n_tup_ins` was
  0 for the table's entire life. Table dropped 2026-08-25 (Q-301b).
- **Q-270** — `training_load_ots`: a live producer writing into a table holding zero rows.
- **Q-231** — the "Exercise detected" card kept its reader after losing its only writer, so it has
  been permanently empty since ~2026-08-04 while looking like a working feature.

Three is a class, and the entry that proposed this check was itself written while closing Q-301b.

## What it flags, and the narrowing that makes it useful

`scripts/check-dead-repo-methods.js` fails on a repository-interface method whose **only** references
in the tree are its own declaration and its own implementation.

The obvious rule — *no caller outside `lib/data/`* — was measured first and returns **21**, most of
them legitimate: `upsertOuraSleep` is called by `saveSleepSession`, `markHrSynced` by the Oura slice,
`listExerciseMuscleMap` by the muscle-map cache. Shipping that version would have been noise, and
noise is how a check gets deleted. The narrower rule returns **6**, and every one was confirmed by
hand to have exactly two references.

**Known blind spot, stated in the script rather than discovered later:** `pushMutations` dispatches
by domain string, so a method reached only through that lookup would read as dead. None of the six
is that shape — each was checked — but a future one might be, which is what the baseline is for.

## Verified

- **Both failure modes were mutation-tested against the live tree**: adding a dead method to the
  interface fails with that method named; giving a *baselined* method a caller also fails, because
  the baseline is shrink-only and the ratchet must tighten rather than go slack. Both restored clean.
- **Then made repeatable.** A hand-run mutation proves the check worked *once*; it does not keep
  proving it, and the dangerous failure mode here is silent — a regex or path assumption drifts, the
  check passes forever, and nobody notices it stopped looking. So the detection was factored into an
  exported `findDead(interfaceSrc, texts, implFile)` and pinned by
  `scripts/__tests__/dead-repo-methods.test.ts` (**6 cases**), following the `scripts/lib/keep.js`
  precedent. Those tests were themselves mutation-checked: removing the definition-vs-call guard
  fails 3 of 6, and removing the word boundary (so `getFoo` counts `getFooBar(...)` as its caller)
  fails exactly the case written for it.
- `pnpm check:rules` now reads **Ran 58 of 58** — the runner picked the new step up from
  `ci.yml` on its own, which is the whole point of reading the count from the YAML rather than
  hardcoding it.
- Full gate green: `tsc --noEmit`, `pnpm lint` 0 errors, `check-backlog-pointers` OK at 202 entries.

## What is deliberately NOT done

**The six dead methods are baselined, not deleted** — filed as **LA-28**. Two of them
(`getWorkoutSessionOwners`, `getExerciseLogOwners`) are bulk ownership lookups. The live ownership
path is `ensureWorkoutSession`, which CLAUDE.md names as the reference for verifying client-supplied
row ids, so they read as superseded rather than as a missing guard — but *reads as* is not *verified
as*, and deleting a security-adjacent helper on that basis, inside a PR about a CI script, is how a
gap gets closed by accident. LA-28 says to confirm the sync-push ownership route first.

The prize for doing it is an **empty baseline**, which CLAUDE.md prefers outright: its reference case
is `check-aest-midnight-timezone.js`, whose baseline is empty *"so an omitting call site is a
regression rather than a debt row"*. Six is close enough to reach.

## Also in this PR

`docs/agents/state/implementation-lane-a.md`'s size baseline ratcheted **179 → 178**. It was left
loose earlier today only because two in-flight branches still carried the file at 179; both have
landed, so the slack is now just slack.

## Not exercised

Nothing runtime — this is a developer tool and a CI step. No device check is owed. The six baselined
names were verified by reading every reference to each; no runtime probe was run to prove they are
unreachable, which is the residue LA-28 carries.
