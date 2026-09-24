# Implementation Agent (B) — baton

**Updated:** 2026-09-24 · **Session title:** `🚧 Implementation Agent (B) 🟢`
**Next ID:** LB-145 — allocate by grep, checking the JOURNAL too: a shipped entry leaves the queue.

## Now

RV-111, RV-121, RV-164, BF-190/191, RV-171, RV-167, RV-176 shipped. LB-141 filed (two of three walk
exits keep nothing — his call). Four of eight named one surface and had a second.

## Next

**`node scripts/next-item.js --lane B` — run it, do not trust this line.** Read it on `main`; two
Review sweeps reordered the head in one day. **The owner's stated highest priority is tab/page
switch speed**, so `DV-12` heads the lane the moment the phone is available. Otherwise RV-183, then
RV-185, RV-178, RV-122.
**RV-166 is parked properly now** (`Needs: RV-170`) — it was blocked in prose only, so the runner
offered it twice. If an entry looks blocked but reads READY, check for that shape.
**RV-117/118/119 are `Lane: O` — leave them** (gate satisfied, mockup is in the Orchestrator's chat;
do not re-ask or re-make). **BF-177's plan is STALE** — LB-128 (#1456) may have voided its premise.

## Blocked / owed

- **LB-134 is the owner's** (branch protection). Until he rules, read the five job CONCLUSIONS before every merge and expect the merge race below.
- **A QUESTION FILED `Lane: O` COMES BACK** — RV-121's owner half returned as Lane B work in hours;
  write the brief properly, then build it. Device checks are DV's to RUN, mine to RECORD.

## Claimed paths

- None. (`lib/calendar-month.ts`, LB-143, released — #1578 merged.)

## Lessons that cost real time

- **⚠ THE MERGE CALL IS NOT A GATE** (#1467 merged past a PENDING `Tests`, which then failed). Read
  the five conclusions — `get_job_logs failed_only` is cheap but "0 failed" on a RUNNING run is not
  green. **The merge race is arithmetic:** CI ~7 min vs a commit to `main` every ~4, so merge the
  instant the five are green; no run for your head = conflicted PR.
- **NEVER SCALE A PARTIAL MEASUREMENT UP** (RV-167) — store null below a floor, and say so on the
  entry when the floor is a judgement rather than a fit.
- **A BATCH CAN SHIP HALF.** `tab-switch-speed` said ship as one PR; the other half needed a device
  measurement that does not exist. Shipping the measurable half and sharpening the rest beats a
  speculative perf change nobody can verify — but SAY which half, in the PR and the entry.
- **⚠ RE-RUN THE GATES AFTER MERGING THE BASE, NOT BEFORE.** The doc-size ratchet is BASE-RELATIVE:
  `check:rules` passed, the merge of `main` consumed the slack, CI went red on #1574. Another lane
  hit the same thing within four minutes, so it is the ordering, not a slip.
- **A BACKLOG CONFLICT IS NOT ALWAYS TWO DELETIONS** — two sweeps inserting at one point is two
  ADDITIONS; read the headings each side, then DIFF THE FULL HEADING SET after every merge (#1481
  silently deleted RV-117/118).
- **REBUILD `changelog.ts` FROM `origin/main`, NEVER SPLICE** — a shared header means a splice drops the other PR's entry; it conflicts on EVERY merge.
- **CONTROL-RUN every new test against `origin/main`**; E2E is ADVISORY, so pair a spec with a gating vitest file. **A source scanner has four traps, all of which have bitten:** it
  matches ITSELF (`git ls-files` hides it only while untracked, and `ls-files A B -- '*.tsx'` UNIONS
  pathspecs — filter in JS); it matches the COMMENTS explaining the fix (strip them); a regex cannot
  balance parens (`f\([^,)]+\)` flags the corrected `f(g(x), tz)`); arity is per-function.
- **A gate's exit code must be read DIRECTLY**, never via `&&`/`;` into `git commit`; COMMIT before `git stash`/`checkout`; `tsc --noEmit` typechecks NEITHER an auth-gated page nor tests, so run `node scripts/check-test-typecheck.js` before pushing a spec; and vitest's unit project does not transform JSX, so a testable helper goes in a `.ts`.
