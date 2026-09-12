# 2026-09-12 — LA-91: every CI job gets a timeout, and a guard so the next one does too

**Branch:** `lane-a/la91-ci-job-timeouts` · **Agent:** Implementation Lane A

## The problem

A GitHub job with no `timeout-minutes` inherits the 360-minute default. One hung step — a Playwright
run that never exits, a webServer that never binds — holds a runner for six hours while the PR sits
`mergeable_state: unstable`, indistinguishable from a slow job.

## What shipped

`timeout-minutes` on all **eight** jobs across all three workflow files, plus
`scripts/check-workflow-job-timeouts.js` wired into Custom Rules as step 74.

| workflow | job | measured | limit |
|---|---|---|---|
| ci.yml | Custom Rules | 0:21 – 0:36 | 10 |
| ci.yml | Migration Check | 0:49 – 1:04 | 10 |
| ci.yml | Lint | 0:45 – 0:47 | 10 |
| ci.yml | Build | 4:10 – 4:54 | 20 |
| ci.yml | Tests | 6:15 – 6:17 | 20 |
| ci.yml | E2E | 26:14 – 27:43 | 45 |
| android.yml | Android | ~4:06 – 4:30 | 20 |
| android-emulator.yml | emulator | — | 45 (already had one) |

## Two things the entry got wrong, both in the same direction

- **It scoped itself to `ci.yml`.** Its own `Lane:` field says `.github/workflows/ci.yml`, and its
  evidence was `grep -n timeout-minutes .github/workflows/ci.yml` returning nothing — true, but the
  grep was narrower than the problem. `android.yml`'s job had no limit either. Per the
  sibling-surface rule, all three files are swept.
- **Its E2E sizing is measured against a run that has since moved.** The entry recorded 24:36 with
  the `pnpm e2e` step at 23:06 and argued 45 minutes "leaves real headroom". Re-measured on two runs
  from 2026-09-12: **26:14 and 27:43** at the job level, step 24:52 and 26:13. So E2E grew ~13% in
  three days, and the headroom is 62% rather than the ~83% the entry implies. 45 still holds — a run
  where thirty specs retry adds roughly ten minutes against a ~19 s average spec — so the number is
  kept, with the real figures recorded so the next person sizing it is not working from the old ones.
- **A detail the entry's step-level reasoning skips: `timeout-minutes` is a JOB limit, not a step
  limit.** It covers the ~1:15 of container init, checkout, install and migrations before `pnpm e2e`
  starts. Sizing from the step alone would understate what the limit has to cover.

## Decisions

- **The guard checks presence, not value.** A script asserting a particular number would go stale as
  the suite grows, or force every future job into one shape. The right limit is a property of what
  the job does; what must never happen is a job with no limit at all, which is silent.
- **The limits are sized from measured runs, not judgement.** The entry itself records why: a
  check-in once called 25 minutes "beyond plausible" for the E2E suite with no evidence, and the real
  run took 24:36. Acting on that guess would have killed a healthy run two minutes before it went
  green. That reasoning is quoted into the script's error message.
- **Parsed by indentation rather than with a YAML library.** These scripts carry no dependencies of
  their own — that is what keeps Custom Rules at ~25 seconds with no install step.

## Verification

- Every workflow re-parsed with PyYAML after editing: all eight jobs present, each limit on the
  intended job.
- **Mutation pass — 4 planted defects, 4 killed:** a `ci.yml` job losing its timeout; the *last* job
  in a file losing its timeout (the close-at-EOF path, which an indentation parser can miss); a job
  in a *different* workflow file losing its timeout; and a timeout indented as a STEP key rather than
  a job key — valid YAML, wrong meaning. The equivalent control (`missing.length` rewritten as
  `missing.length > 0`) survived.
- `pnpm check:rules` — **Ran 74 of 74**, all passed, the new rule reporting as step 74.
- Full suite green with a `DATABASE_URL` (8,411 tests), lint green separately.

## Not exercised

This change alters CI itself, so its real test is this PR's own run — the first one to execute under
the new limits. No device path is involved. The limits have not been observed actually firing on a
hung job, because nothing has hung since they landed; what is verified is that they are present,
correctly placed, and above every measured duration.
