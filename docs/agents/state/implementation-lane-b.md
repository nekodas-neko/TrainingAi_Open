# Implementation Agent (B) — baton

**Updated:** 2026-09-24 · **Session title:** `🚧 Implementation Agent (B) 🟢`
**Next ID:** LB-143 — allocate by grep, checking the JOURNAL too: a shipped entry leaves the queue.

## Now

RV-111, RV-121, RV-164, BF-190 + BF-191, RV-171, RV-167 shipped. LB-141 filed (two of three walk exits
keep nothing — his call). Three of the seven named one surface and had a second: grep the symbol
before believing the line number.

## Next

**`node scripts/next-item.js --lane B` — run it, do not trust this line.** Read it on `main`, and
do not cut a branch until there is something to commit: two Review sweeps reordered the head in
one day, so it moves between sessions.

Today it offered **RV-176**, then RV-122. **RV-166 is now parked properly** — it was blocked on
RV-170's unanswered rider and said so in prose only, so the runner offered it twice; it carries
`Needs: RV-170` as of LB-142. If an entry looks blocked but is READY, check for that shape.
**RV-117/118/119 are `Lane: O` — leave them.** Their owner gate IS satisfied; the mockup is in the
Orchestrator's chat. Do not re-ask him, do not re-make it.
**BF-177's plan is STALE** — LB-128 (#1456) may have voided its `cachedFetch`/`onError` premise.

## Blocked / owed

- **LB-134 is the owner's** — branch protection. Until he rules, read the five job CONCLUSIONS
  before every merge and expect the merge race below.
- **A QUESTION FILED `Lane: O` COMES BACK.** RV-121's owner half was answered within hours and
  returned as Lane B work. Write the brief properly — he takes the recommendation — then build it.
- Device checks are DV's to RUN, mine to RECORD. A FAILED check comes BACK as work.

## Claimed paths — none.

## Lessons that cost real time

- **⚠ THE MERGE CALL IS NOT A GATE** — #1467 merged with `Tests` FAILING. Read the five conclusions
  via `list_workflow_jobs` (`resource_id`, not `run_id`).
- **THE MERGE RACE IS ARITHMETIC — seven lost cycles on one PR.** CI ~7 min vs a commit to `main`
  every ~4. Merge the INSTANT the five are green; no run for your head = conflicted PR.
- **NEVER SCALE A PARTIAL MEASUREMENT UP** (RV-167). A 19%-covered cadence stream scaled to 100%
  invents four fifths of the steps and looks measured — the phantom-duration shape BF-190 removed.
  Store null below a floor, and say on the entry when the floor is judgement rather than a fit.
- **A BACKLOG CONFLICT IS NOT ALWAYS TWO DELETIONS** — two sweeps inserting at one point is two
  ADDITIONS, keep both. Read the headings on each side, every time.
- **⚠ AFTER ANY BACKLOG MERGE, DIFF THE FULL HEADING SET** — #1481 silently deleted RV-117/118.
- **REBUILD `changelog.ts` FROM `origin/main`, NEVER SPLICE** — a shared header means a splice drops
  the other PR's entry. It conflicts on EVERY merge.
- **CONTROL-RUN every new test against `origin/main`**; E2E is ADVISORY, so pair a spec with a
  gating vitest file. **A source-scanning test can fail in CI on ITSELF**: `git ls-files` skips it
  while untracked, and `ls-files A B -- '*.tsx'` UNIONS pathspecs — filter in JS.
- **A gate's exit code must be read DIRECTLY**, never via `&&`/`;` into `git commit`; COMMIT before `git stash`/`checkout`; and `tsc --noEmit` typechecks NEITHER an auth-gated page nor tests, so run `node scripts/check-test-typecheck.js` before pushing a spec — it caught an invented enum.
- **Vitest's unit project does not transform JSX** — extract a helper to a `.ts` to make it testable.
