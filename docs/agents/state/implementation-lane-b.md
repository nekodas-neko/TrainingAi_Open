# Implementation Agent (B) — baton

**Updated:** 2026-09-25 · **Session title:** `🚧 Implementation Agent (B) 🟢`
**Next ID:** LB-148 — allocate by grep, checking the JOURNAL too: a shipped entry leaves the queue.

## Now

RV-111/121/164/167/171/176, BF-190/191, RV-113+OR-161 (half of `tab-switch-speed`), BF-196, RV-183's supplement half. LB-141 filed.

## Next

**`node scripts/next-item.js --lane B` — run it, do not trust this line.** Read it on `main`; two
Review sweeps reordered the head in one day. **The owner's stated highest priority is tab/page
switch speed**, so `DV-12` heads the lane the moment the phone is available. Otherwise RV-183, then
RV-185, RV-178, RV-122.
**A BLOCKED ENTRY NEEDS A FIELD, NOT A PARAGRAPH** — RV-166 (`Needs:`) and DV-12/OR-162 (`Gate:
device`) both headed READY while unstartable. The field must LEAD its own bullet; inline after
`Lane:` parses as nothing.
**RV-117/118/119 are `Lane: O` — leave them** (gate satisfied, mockup is with the Orchestrator). **BF-177's plan is STALE** — LB-128 (#1456) may have voided its premise.

## Blocked / owed

- **LB-134 is the owner's** (branch protection). Until he rules, read the five job CONCLUSIONS before every merge and expect the merge race below.
- **A QUESTION FILED `Lane: O` COMES BACK** — write the brief properly, then build it. Device checks are DV's to RUN, mine to RECORD.

## Claimed paths

- None. (`lib/calendar-month.ts`, LB-143, released — #1578 merged.)

## Lessons that cost real time

- **⚠ THE MERGE CALL IS NOT A GATE** (#1467 merged past a PENDING `Tests`, which then failed). Read
  the five conclusions — `get_job_logs failed_only` is cheap but "0 failed" on a RUNNING run is not
  green. **The merge race is arithmetic:** CI ~7 min vs a commit to `main` every ~4, so merge the
  instant the five are green; no run for your head = conflicted PR.
- **NEVER SCALE A PARTIAL MEASUREMENT UP** (RV-167) — store null below a floor, and say so on the
  entry when the floor is a judgement rather than a fit.
- **GREP THE FIELD, NOT THE FILES THE ENTRY NAMES** — six in a row named one surface and had more, or one already fixed. BF-196's third surface had solved it (match it, don't re-coin); RV-183's catalogue claim was WRONG (`freshWithinTtl` since the snapshot) and its "3,040 server reads" was a 6 h TTL over many days — **a read count localises nothing**. Verify every bullet of a multi-part entry before building any of it, and retract what does not hold.
- **A BATCH OR A MULTI-PART ENTRY CAN SHIP HALF** — ship what holds, sharpen the rest, SAY which half.
- **THE GATE IS FIVE THINGS AND THEY RUN AFTER THE BASE MERGE, NOT BEFORE.** `check:rules` · `pnpm
  lint` (repo-wide — `--file` covers only what you name, and a `console.log` in a new spec took
  #1587 red; `no-console` allows info/warn/error) · `pnpm test` · `pnpm build` · `tsc`. The doc-size
  ratchet is BASE-RELATIVE, so a clean run before merging `main` proves nothing — that put #1574
  red, and another lane hit it four minutes later.
- **A BACKLOG CONFLICT IS NOT ALWAYS TWO DELETIONS** — two sweeps inserting at one point is two
  ADDITIONS; read the headings each side, then DIFF THE FULL HEADING SET after every merge (#1481
  silently deleted RV-117/118).
- **REBUILD `changelog.ts` FROM `origin/main`, NEVER SPLICE** — a shared header means a splice drops the other PR's entry; it conflicts on EVERY merge.
- **CONTROL-RUN every new test against `origin/main`**; E2E is ADVISORY, so pair a spec with a gating vitest file. **A source scanner has four traps, all of which have bitten:** it
  matches ITSELF (`git ls-files` hides it only while untracked, and `ls-files A B -- '*.tsx'` UNIONS
  pathspecs — filter in JS); it matches the COMMENTS explaining the fix (strip them); a regex cannot
  balance parens (`f\([^,)]+\)` flags the corrected `f(g(x), tz)`); arity is per-function.
- **⚠ ASSERT EVERY SCRIPTED `str.replace`.** This file's "Now" line sat three PRs stale because one no-oped silently on text an earlier no-op never wrote. Code edits were asserted; the baton's were not, and the baton is what survives a compaction.
- **A gate's exit code must be read DIRECTLY**, never via `&&`/`;` into `git commit`; COMMIT before `git stash`/`checkout`; `tsc --noEmit` typechecks NEITHER an auth-gated page nor tests, so run `node scripts/check-test-typecheck.js` before pushing a spec; and vitest's unit project does not transform JSX, so a testable helper goes in a `.ts`.
