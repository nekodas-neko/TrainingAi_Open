# Implementation Agent (B) — baton

**Updated:** 2026-09-24 · **Session title:** `🚧 Implementation Agent (B) 🟢`
**Next ID:** LB-141 (LB-140 filed 2026-09-24) — allocate by grep, and check the JOURNAL too: a
shipped entry leaves the queue, so the backlog alone reads low.

## Now

DV-16, DV-17, the DV-18 handover and LB-139 all shipped — 14 PRs in the 2026-09-23/24 run.

## Next

**`node scripts/next-item.js --lane B` — run it, do not trust this line.** Read it on `main`; do
not cut a branch until there is something to commit. The Orchestrator re-prioritises, so the top
item changes between sessions — device findings jumped above LB-138 mid-run.

**RV-117/118/119 are `Lane: O` — leave them.** Their owner gate IS satisfied; the mockup is in the
Orchestrator's chat and it is exporting it to `docs/design/`. Do not re-ask him, do not re-make it.

**BF-177's scratchpad plan is STALE** — LB-128 (#1456) may have voided its `cachedFetch`/`onError` premise.

## Blocked / owed

- **LB-134 is the owner's** — branch protection. Until he rules, read the five job CONCLUSIONS
  before every merge, and expect the merge race below.
- **LB-138** — `la109` is a REAL regression from #1431 (Lane B's own): back off Home reaches
  `about:blank`. Start from `navigateToTab`'s history semantics, not the spec. Read with BF-49,
  RV-111, RV-113 — same surface, device-reported.
- Device checks are DV's to RUN, mine to RECORD. A FAILED check comes BACK as work.

## Claimed paths — none.

## Lessons that cost real time

- **⚠ THE MERGE CALL IS NOT A GATE HERE.** #1467 squash-merged with `Tests` FAILING. Confirm the
  five jobs' conclusions via `list_workflow_jobs`; E2E is advisory (~31 min) and is red on `main`.
- **THE MERGE RACE IS ARITHMETIC.** CI ~7 min vs a commit to `main` ~every 8, and every filing PR
  touches the two doc-size files. Six cycles lost before I cut MY latency: check at 6 min, merge the
  INSTANT the five are green. No run for your head = conflicted PR, never slow CI.
- **⚠ AFTER ANY BACKLOG MERGE, DIFF THE FULL HEADING SET** — #1481 silently deleted RV-117/118;
  counting only headings I had edited could not see a neighbour vanish. Every line of `diff <(git
  show origin/main:docs/implementation-backlog.md|grep '^### '|sort) <(…)` must be one you INTENDED.
- **READ THE CODE BEFORE THE ENTRY.** Three for three — RV-120, DV-16, DV-17 all mislocated their
  own cause. An entry says where someone looked, not where the bug is.
- **CONTROL-RUN every new test against `origin/main`** — a spec that passes either way is worse
  than none. Revert via `git show origin/main:<file>`, not a `cp` snapshot.
- **`grep` is case-sensitive**: `planLoaded` does not match `setPlanLoaded`. Use `-i` when counting
  a camelCase symbol — I misread a complete file as half-applied.
- **A gate's exit code must be read DIRECTLY** — not through a pipe, not via `&&` into `git commit`
  (an intervening `echo` succeeds, so a RED gate still commits). Gates to a file, read the code.
- **A `docs/overview/` fold conflict is TWO FOLDS on one pre-existing archive** — never splice; take
  origin/main's whole and re-fold once. BF-188 already lost 12 entries on `main`; read it first.
- **An auth-gated page never compiles from a dev-server GET** — `pnpm build` is what exercises it.
- **`npx tsc --noEmit` DOES NOT typecheck test files** — Build runs `check-test-typecheck.js`.
