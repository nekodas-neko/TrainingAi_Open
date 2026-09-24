# Implementation Agent (B) — baton

**Updated:** 2026-09-24 · **Session title:** `🚧 Implementation Agent (B) 🟢`
**Next ID:** LB-141 — allocate by grep, checking the JOURNAL too: a shipped entry leaves the queue.

## Now

RV-111, RV-121 both halves, RV-164 shipped. Now BF-190 + BF-191 together — one flow, one device
check, and BF-191's floor is near-meaningless without BF-190's real elapsed time. Also fixed
BF-188's fold collision (unique `-N` per fold) since it blocked a third PR.

## Next

**`node scripts/next-item.js --lane B` — run it, do not trust this line.** Read it on `main`, and
do not cut a branch until there is something to commit: two Review sweeps reordered the head in
one day, so it moves between sessions.

Today: BF-191, then RV-171 — read RV-171 early, a failed request while the meal-plan setup opens
silently deletes every saved dietary restriction.
**RV-117/118/119 are `Lane: O` — leave them.** Their owner gate IS satisfied; the mockup is in the
Orchestrator's chat, being exported to `docs/design/`. Do not re-ask him, do not re-make it.
**BF-177's plan is STALE** — LB-128 (#1456) may have voided its `cachedFetch`/`onError` premise.

## Blocked / owed

- **LB-134 is the owner's** — branch protection. Until he rules, read the five job CONCLUSIONS
  before every merge and expect the merge race below.
- **A QUESTION FILED `Lane: O` COMES BACK.** RV-121's owner half was answered within hours and
  returned as Lane B work. Write the brief properly — he takes the recommendation — then build it.
- Device checks are DV's to RUN, mine to RECORD. A FAILED check comes BACK as work.

## Claimed paths — none.

## Lessons that cost real time

- **⚠ THE MERGE CALL IS NOT A GATE HERE** — #1467 squash-merged with `Tests` FAILING. Read the five
  conclusions via `list_workflow_jobs` (`resource_id`, not `run_id`); E2E is advisory.
- **THE MERGE RACE IS ARITHMETIC AND I LOST IT SEVEN TIMES ON ONE PR.** CI ~7 min vs a commit to
  `main` ~every 4. Merge the INSTANT the five are green; no run for your head = conflicted PR.
- **THE FOLD IS SAFE AGAIN** — it writes `-2` when `-1` exists (BF-188, fixed 2026-09-24). Still
  verify by anchor count: the loss is silent and `check-doc-links` passes over it.
- **A BACKLOG CONFLICT IS NOT ALWAYS TWO DELETIONS.** Two sweeps inserting different entries at one
  point is two ADDITIONS — keep both. Read the headings on each side before choosing, every time.
- **⚠ AFTER ANY BACKLOG MERGE, DIFF THE FULL HEADING SET** — #1481 silently deleted RV-117/118.
- **REBUILD `changelog.ts` FROM `origin/main`, NEVER SPLICE** — the conflict sits inside a `changes:`
  array under a shared header, so a splice drops the other PR's entry. It conflicts on EVERY merge.
- **READ THE CODE BEFORE THE ENTRY.** Six for six. RV-164 named three writes; the localStorage
  seeds and the dismiss path were the same defect, unnamed.
- **CONTROL-RUN every new test against `origin/main`**, and MEASURE what main does rather than
  inferring it from a red assertion. E2E is ADVISORY, so pair any spec with a gating vitest file.
- **A gate's exit code must be read DIRECTLY** — never via `&&`/`;` into `git commit`, where an
  `echo` succeeds and a RED gate still commits. Same reflex: COMMIT before `git stash`/`checkout`.
- **`pnpm build` is what compiles an auth-gated page and typechecks test files** — `tsc --noEmit`
  does neither.
