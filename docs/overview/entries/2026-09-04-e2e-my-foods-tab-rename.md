# 2026-09-04 — six e2e specs were still waiting for a tab renamed three days ago

**Branch:** `fix/e2e-my-foods-tab-rename` · Lane B · **test-only** — no product code, no migration,
no version bump.

## What was actually broken

`saved-meals-sheet.tsx` renamed its middle tab from **`Meals`** to **`My Foods`** on 2026-09-01
(BF-103, an owner decision — the pair he could not tell apart was `My Foods` against `My Meals`).
The rename shipped. Six e2e spec files went on waiting for `getByRole('tab', { name: 'Meals' })`,
and one for a control reached by `clickInView('Meals')`.

Fixed here: `builder-barcode-scan`, `empty-meal-library`, `food-row-shared`, `nutrition-sheet-surface`,
`recipe-image-to-meal` (tab name) and `back-dismiss-sweep` (the `clickInView` label).

## Why it cost four PRs and most of a session

**The failure did not look like a missing element.** Every one of those waits sits inside a
`toPass` retry loop, so a 5-second `toBeVisible` failed, retried, failed, and the test died on the
**45-second test timeout**. Three separate specs failed at 45.6s, 46.5s and 46.5s — a timing
signature that reads as "slow runner", not "wrong string".

That produced a genuinely misleading pattern, and it misled this session for over an hour:

- **Unrelated PRs, all red on E2E.** #840 (About-screen labels), #853 (a resume repaint), #871 (day
  rollover) and #868 (a day-review window) share no code, and all four were red on the same check.
- **A wrong hypothesis that fit the evidence.** 22 of 27 spec files budget a `toPass` timeout LARGER
  than the 45-second test that contains them — fourteen of them ask 90 seconds inside 45. That is
  real, and it looked like the cause. It is not: the error text says `element(s) not found`, so
  raising the timeouts would only have moved the failure from 45s to 90s. **It was one line of error
  text that refuted a hypothesis three independent observations supported.**
- **The error text is the one thing CI cannot show you.** `get_job_logs` returns only the post-job
  Postgres container dump (LB-54), and the `playwright-report` artifact is always empty because the
  CI reporter list is `[['github'], ['list']]` with no HTML reporter — #868's upload step reports
  success in **zero seconds**, and `list_workflow_run_artifacts` returns 0.
- **`main` has no E2E baseline to compare against.** The workflow has no `push: [main]` trigger by
  design (~11 billed minutes per merge for a result the PR run already produced), and the nightly is
  gated to `Tests` only. So "is this red on main too?" — the first question the CI rules say to ask
  — cannot be answered from CI history at all.

**What finally answered it** was building a CI-shaped database locally (`createdb`, migrate,
`seed.sql`) and running the suite against clean `main`. Two failures inside ten minutes, and the
`error-context.md` Playwright writes next to each failure carried the accessibility snapshot with
the answer in it: `tablist: Recent | My Foods [selected] | Search`. The spec was waiting for a tab
that had been renamed.

## The guard that was written and then deleted

A `check-e2e-ui-strings.js` was written to stop this recurring: assert every tab name and
placeholder a spec waits for appears somewhere in UI source. It passed 26 queries across 73 files
with one documented runtime-composed exemption, and it looked ready.

**It failed its own mutation test.** Reverting `empty-meal-library.spec.ts` to `'Meals'` left it
green — because `'Meals'` appears in `meal-plan-setup-sheet.tsx`'s `STEPS` array, and a substring
search across a large codebase finds any short word somewhere. A guard that cannot fail on the exact
bug it was built for is worse than no guard, because it converts an open question into false
confidence. Deleted rather than shipped; recorded in **LB-55** with what a working version would
need (the tab-label sets extracted from source, not a substring search).

An earlier draft was worse and is worth naming too: checking every `getByRole(name:)` produced eight
false positives, because an accessible name is **computed from child DOM text** — a button whose
children are `Log` and `Body Weight` is named "Log Body Weight" while that string exists nowhere.

## Verification

Each fixed spec was run against a clean CI-shaped database, before and after:

| spec | before | after |
|---|---|---|
| `empty-meal-library` (×2) | 45.6s timeout | **6.2s / 5.9s pass** |
| `builder-barcode-scan` | 46.5s timeout | **14.3s pass** |
| `back-dismiss-sweep:171` | 45.7s timeout | **13.3s pass** |
| `food-row-shared`, `nutrition-sheet-surface`, `recipe-image-to-meal` | — | **6 pass** |

The before/after is the proof: these are not timeouts that got more time, they are tests that now
find what they were looking for and finish in seconds.

## Not exercised

**Nothing on a device**, and nothing needs to be — no product code changed. The rename itself
(BF-103) shipped three days ago and is already on the owner's phone; this only makes the suite agree
with it.

**Whether this is the whole of E2E's redness.** A full-suite run on this branch was clean past the
point where `main` had already failed twice, but the suite is 144 serial tests and other failures
may sit behind these. The claim here is bounded: six specs were waiting for a string the app stopped
rendering, and they no longer are.
