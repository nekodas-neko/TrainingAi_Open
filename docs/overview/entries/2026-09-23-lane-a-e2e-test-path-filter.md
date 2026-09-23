# 2026-09-23 — a vitest file under `app/` was buying a 34-minute browser suite

**Branch:** `lane-a/e2e-test-path-filter` · **Agent:** Implementation (Lane A) · **CI + docs.**
No app behaviour changes, so no version bump.

Three things, all fallout from a session that spent most of its time not shipping.

## The change: `__tests__/` no longer gates the browser suite

`ci.yml`'s E2E gate ran the full Playwright suite for any changed path under `app/` (minus
`app/api/`) or `components/`. That includes `__tests__/` directories — vitest files that no browser
ever loads and that therefore cannot change what Playwright sees.

**Measured, not reasoned:** PR #1405 touched exactly **one** such file,
`app/session-explain/__tests__/bf172-fit-not-readiness.test.ts`, and bought **four** full ~34-minute
runs. It reached all-six-green on the fourth and still could not merge, because `main` had moved
during the run each time.

The exclusion is the same shape, and the same argument, as the `app/api/**` drop already in that
line (LA-63: *"a migration and four API routes used to buy the full ~25-minute suite"*). `e2e/`
specs are not under a `__tests__/` directory — checked, zero — so the browser suite still gates on
itself. Verified by simulating the three cases against the real pipeline: a test-only change skips,
a component change runs, an `e2e/` spec change runs.

**This is a structural call made rather than asked**, per the owner's 2026-09-22 delegation. Reversal
is deleting one `grep -vE` from one line.

## The rule: a plain `git fetch` here produces PRs that CI silently skips

The expensive half of the session. The sandbox's git proxy **returns a shallow pack on every
`git fetch origin main`**, grafting the fetched tip as a root — `.git/shallow` ends up holding
`origin/main` itself. The fetched branch then has no ancestry, `git merge origin/main` fails with
*"refusing to merge unrelated histories"*, and a merge computed against that view produces a tree
GitHub reads as genuinely conflicted.

**A conflicted PR is never given a workflow run.** So the symptom is `get_check_runs` returning
`total_count: 0` indefinitely while CI runs normally for every other branch — which is
indistinguishable, from the outside, from the stale-base tell already in CLAUDE.md. Chasing the
wrong one cost four PRs with sound diffs (#1426, #1428, #1430, #1435).

Two cheap discriminators are now written down: `git rev-list --max-parents=0 HEAD | wc -l` above 1,
and an empty `git merge-base HEAD origin/main`. And the decisive test is
`update_pull_request_branch` — it merges server-side with GitHub's full history, so if *it* also
refuses, the conflict is real rather than a reporting lag. That call is what finally settled it.

The remedy is `--unshallow`/`--deepen` on **every** fetch, and a plain `git clone` into the
scratchpad when a repo is already poisoned (`pnpm install --frozen-lockfile` there takes 30 s).

> **⚠ Corrected the same day by LA-130 — "every fetch" is wrong.** One `--unshallow` immunises the
> clone permanently; a bare fetch cannot *deepen* a still-shallow clone, which is what looked like
> re-shallowing. See `docs/overview/entries/2026-09-23-lane-a-la130-unshallow-once.md`.

## The entries: one orphaned finding, one for the Orchestrator

**LA-129** files what owner decision item 5 explicitly left unfiled — generating the `.size`
baselines in CI rather than committing them, which the owner named as *"the better long-term
answer"* while knowingly taking the cheap one. Per **No orphaned findings** it should exist as a
queue entry rather than a sentence inside a resolved decision. It carries this session's measurement
(three Lane A PRs needing four, three and two re-merges) and the open design question that decides
its size: whether the ratchet can read its baseline from `origin/main` at run time without losing
the shrink-only property.

**OR-132** hands the Orchestrator the five dead PRs. Closing a PR needs the owner's authorisation,
which is why this is `Lane: O` and not something I did — item 6 set that precedent on 2026-09-22.

## Verification

`pnpm check:rules` **75 of 75** · `check-backlog-pointers` OK, 430 entries, no duplicates. The
pipeline change was simulated against the three real path cases rather than assumed; its true test
is the next PR that touches only a test file under `app/`, which should now report E2E in seconds.

**Not exercised:** nothing ran on `pnpm dev` or on device — there is no app code in this diff.
