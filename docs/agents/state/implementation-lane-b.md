# Implementation Agent (B) — baton

**Updated:** 2026-09-25 · **Session title:** `🚧 Implementation Agent (B) 🟢`
**Next ID:** LB-153 — allocate by grep, checking the JOURNAL too: a shipped entry leaves the queue.

## Now

RV-111/121/164/167/171/176, BF-190/191, RV-113+OR-161 (half of `tab-switch-speed`), BF-196, RV-183's supplement/meal halves, LB-148, RV-178, RV-99's one defect (RV-122 in flight). LB-141/149/150 filed; LB-151 rides with RV-122; LB-152 put RV-99's restyle to the owner; RV-183's remaining fetch half proved Lane A's.

## Next

**`node scripts/next-item.js --lane B` — run it, do not trust this line.** Read it on `main`; sweeps
reorder the head daily. **The owner's stated top priority is tab/page switch speed**, so `DV-12`
heads the lane once the phone is available. Otherwise RV-101, RV-102, RV-67 (RV-183 is Lane A's throughout; RV-185 is parked behind RV-186; RV-99's Lane B half now waits on LB-152's answer).
**A BLOCKED ENTRY NEEDS A FIELD, NOT A PARAGRAPH** — RV-166 (`Needs:`) and DV-12/OR-162 (`Gate: device`) headed READY while unstartable. The field must LEAD its own bullet; inline after `Lane:` parses as nothing.
**RV-117/118/119 are `Lane: O` — leave them** (gate satisfied, mockup is with the Orchestrator). **BF-177's plan is STALE** — LB-128 (#1456) may have voided its premise.

## Blocked / owed

- **LB-134 is the owner's** (branch protection). Until he rules, read the five job CONCLUSIONS before every merge and expect the merge race below.
- **A QUESTION FILED `Lane: O` COMES BACK** — write the brief properly, then build it. Device checks are DV's to RUN, mine to RECORD.

## Claimed paths

- `lib/cache-groups.ts` — ONE added line per new cache key (RV-178), released when that PR merges. Lane A's file; registering a key is not optional, so the choice was register it or do not add the key.

## Lessons that cost real time

- **⚠ THE MERGE CALL IS NOT A GATE** (#1467 merged past a PENDING `Tests`, which then failed). Read
  the five conclusions — `get_job_logs failed_only` is cheap but "0 failed" on a RUNNING run is not
  green. **The merge race is arithmetic:** CI ~7 min vs a commit to `main` every ~4, so merge the
  instant the five are green; no run for your head = conflicted PR.
- **NEVER SCALE A PARTIAL MEASUREMENT UP** (RV-167) — store null below a floor, and say so on the
  entry when the floor is a judgement rather than a fit.
- **MEASURE BEFORE MIGRATING — DOES IT CHANGE WHAT RENDERS?** RV-99 reads as a refactor and is a VISIBLE app-wide restyle (green moves 67 in sRGB): the owner's, so `Lane: O` + `Ask: owner` (a FIELD — prose there fails the pointer check). Only the file holding two values for ONE meaning was a defect. **GREP THE FIELD, NOT THE FILES THE ENTRY NAMES** — six in a row named one surface and had more, or one already fixed. BF-196's third surface had solved it (match it, don't re-coin); RV-183's catalogue claim was WRONG (`freshWithinTtl` since the snapshot) and its "3,040 server reads" was a 6 h TTL over many days — **a read count localises nothing**. Verify every bullet of a multi-part entry before building any of it, and retract what does not hold.
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
  pathspecs — filter in JS); it matches the COMMENTS explaining the fix (strip them); **a regex cannot balance
  parens — write the depth-counting scan FIRST** (this lesson was already here and `[^)]*` still
  falsely accused 3 callers in LB-148, stopping at the `)` in `new Date()`); arity is per-function.
- **A DEFERRAL IS A CLAIM — RE-READ IT BEFORE TRUSTING IT.** RV-183's meal half was deferred as "needs a join"; there was none, just an over-wide parameter type demanding four fields the file never reads.
- **⚠ ASSERT EVERY SCRIPTED `str.replace`.** This file's "Now" line sat three PRs stale because one no-oped silently on text an earlier no-op never wrote. Code edits were asserted; the baton's were not, and the baton is what survives a compaction.
- **RUN `pnpm lint` AND `check:rules` BEFORE BELIEVING A FIX IS DONE** — RV-178's first cut tripped three rules I would not have predicted: the fetch-once ratchet (a `cachedFetch` inside a `useEffect` is the banned shape — use `useCachedValue`), the component-size cap on `config-screen.tsx`, and RV-84's dead-`.catch` guard. Each pointed at a BETTER shape, not a workaround. Compare the lint WARNING COUNT against the base too — a new one is yours.
- **A gate's exit code must be read DIRECTLY** — never via `&&`/`;` into `git commit`, and never through a PIPE (`| tail`, `| cut`) which returns the LAST command's status, so a failing check reads as 0 (hit again in LB-149); COMMIT before `git stash`/`checkout`; `tsc --noEmit` typechecks NEITHER an auth-gated page nor tests, so run `node scripts/check-test-typecheck.js` before pushing a spec; and vitest's unit project does not transform JSX, so a testable helper goes in a `.ts`.
