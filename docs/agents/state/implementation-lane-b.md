# Implementation Agent (B) — baton

**Updated:** 2026-09-24 · **Session title:** `🚧 Implementation Agent (B) 🟢`
**Next ID:** LB-141 (LB-140 filed 2026-09-24) — allocate by grep, and check the JOURNAL too: a
shipped entry leaves the queue, so the backlog alone reads low.

## Now

RV-111 (#1520), RV-121 (#1529) and RV-164 (#1546) shipped. RV-121's `/collection` half stays queued
as a `Lane: O` question — UNGATED, since a `Gate:` parks it out of the Orchestrator's READY list.
**#1545, my journal fold, is redundant and wants closing** — see Blocked.

## Next

**`node scripts/next-item.js --lane B` — run it, do not trust this line.** Read it on `main`, and
do not cut a branch until there is something to commit: sweep 57 reordered the head mid-run, so it
moves between sessions. Today it reads RV-166, RV-167, RV-122.

**RV-117/118/119 are `Lane: O` — leave them.** Their owner gate IS satisfied; the mockup is in the
Orchestrator's chat, being exported to `docs/design/`. Do not re-ask him, do not re-make it.
**BF-177's plan is STALE** — LB-128 (#1456) may have voided its `cachedFetch`/`onError` premise.

## Blocked / owed

- **LB-134 is the owner's** — branch protection. Until he rules, read the five job CONCLUSIONS
  before every merge and expect the merge race below.
- **#1545 needs the owner's yes to CLOSE.** Lane A's fold landed first (#1543), same filename, so
  main is green at 41 foldable and mine is redundant; merging means hand-merging two archives,
  BF-188's exact hazard. Closing loses nothing — the extra entries stay loose for the next sweep.
- Device checks are DV's to RUN, mine to RECORD. A FAILED check comes BACK as work.

## Claimed paths — none.

## Lessons that cost real time

- **⚠ THE MERGE CALL IS NOT A GATE HERE** — #1467 squash-merged with `Tests` FAILING. Read the five
  conclusions via `list_workflow_jobs` (`resource_id`, not `run_id`); E2E is advisory.
- **THE MERGE RACE IS ARITHMETIC AND I LOST IT SEVEN TIMES ON ONE PR.** CI ~7 min vs a commit to
  `main` ~every 4. Merge the INSTANT the five are green; no run for your head = conflicted PR.
- **A CHORE THE GATE DEMANDS IS A RACE.** The 60-entry limit fails for every lane at once, so
  several start the same fold within minutes. Check `main` first; finish your own PR instead.
- **A BACKLOG CONFLICT IS NOT ALWAYS TWO DELETIONS.** Two sweeps inserting different entries at one
  point is two ADDITIONS — keep both. Read the headings on each side before choosing, every time.
- **⚠ AFTER ANY BACKLOG MERGE, DIFF THE FULL HEADING SET** — #1481 silently deleted RV-117/118.
- **REBUILD `changelog.ts` FROM `origin/main`, NEVER SPLICE** — the conflict sits inside a `changes:`
  array under a shared `version:` header, so a splice drops the other PR's whole entry.
- **READ THE CODE BEFORE THE ENTRY.** Six for six. RV-164 named three writes; the localStorage
  seeds and the dismiss path were the same defect, unnamed.
- **CONTROL-RUN every new test against `origin/main`**, and MEASURE what main does rather than
  inferring it from a red assertion.
- **A gate's exit code must be read DIRECTLY** — never via `&&`/`;` into `git commit`, where an
  `echo` succeeds and a RED gate still commits. Same reflex: COMMIT before `git stash`/`checkout`.
- **An auth-gated page never compiles from a dev-server GET, and `npx tsc --noEmit` does not
  typecheck test files** — `pnpm build` exercises both (it runs `check-test-typecheck.js`).
