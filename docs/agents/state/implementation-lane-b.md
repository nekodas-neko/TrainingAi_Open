# Implementation Agent (B) — baton

**Updated:** 2026-09-24 · **Session title:** `🚧 Implementation Agent (B) 🟢`
**Next ID:** LB-141 (LB-140 filed 2026-09-24) — allocate by grep, and check the JOURNAL too: a
shipped entry leaves the queue, so the backlog alone reads low.

## Now

RV-111 (#1520) and RV-121 (#1529) — confirm on `main`; both were in final CI when this was written.
RV-121 split: the label half is code, the `/collection` half is the owner's and stays queued as a
`Lane: O` entry — UNGATED, since a `Gate:` parks a question out of the Orchestrator's READY list.

## Next

**`node scripts/next-item.js --lane B` — run it, do not trust this line.** Read it on `main`, and
do not cut a branch until there is something to commit: sweep 57 put RV-164/166/167 above RV-111
mid-run, so the head moves between sessions.

**RV-117/118/119 are `Lane: O` — leave them.** Their owner gate IS satisfied; the mockup is in the
Orchestrator's chat and it is exporting it to `docs/design/`. Do not re-ask him, do not re-make it.
**BF-177's scratchpad plan is STALE** — LB-128 (#1456) may have voided its `cachedFetch`/`onError` premise.

## Blocked / owed

- **LB-134 is the owner's** — branch protection. Until he rules, read the five job CONCLUSIONS
  before every merge and expect the merge race below.
- **LB-138 was MY OWN MISFILING and is withdrawn** — `la109` fails in Chromium only: the APK's
  Capacitor listener intercepts back first and `backActionForPath` answers `home` for a tab route,
  so nothing pops. BF-49 stays open and separate.
- Device checks are DV's to RUN, mine to RECORD. A FAILED check comes BACK as work.

## Claimed paths — none.

## Lessons that cost real time

- **⚠ THE MERGE CALL IS NOT A GATE HERE** — #1467 squash-merged with `Tests` FAILING. Read the five
  conclusions via `list_workflow_jobs` (`resource_id`, not `run_id`); E2E is advisory.
- **THE MERGE RACE IS ARITHMETIC AND I LOST IT SEVEN TIMES ON ONE PR.** CI ~7 min vs a commit to
  `main` ~every 4, all touching the two doc-size files. Merge the INSTANT the five are green and do
  nothing else in that window. No run for your head = conflicted PR, never slow CI.
- **A BACKLOG CONFLICT IS NOT ALWAYS TWO DELETIONS.** Two sweeps inserting different entries at one
  point is two ADDITIONS — keep both. Read the headings on each side before choosing, every time.
- **⚠ AFTER ANY BACKLOG MERGE, DIFF THE FULL HEADING SET** — #1481 silently deleted RV-117/118;
  counting only the headings I edited could not see a neighbour vanish.
- **READ THE CODE BEFORE THE ENTRY.** Five for five — RV-120, DV-16, DV-17, RV-146, RV-121 all
  understated their cause. RV-121 named one label site; there were three.
- **CONTROL-RUN every new test against `origin/main`** — a spec that passes either way is worse
  than none. Revert via `git show origin/main:<file>`, not a `cp` snapshot.
- **A gate's exit code must be read DIRECTLY** — never via `&&`/`;` into `git commit`, where an
  intervening `echo` succeeds and a RED gate still commits. Gate to a file, read the code.
- **A `docs/overview/` fold conflict is TWO FOLDS on one archive** — never splice; take main's file
  whole and re-fold once. BF-188 already lost 12 entries on `main`; read it first.
- **An auth-gated page never compiles from a dev-server GET, and `npx tsc --noEmit` does not
  typecheck test files** — `pnpm build` exercises both (it runs `check-test-typecheck.js`).
