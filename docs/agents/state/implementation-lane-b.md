# Implementation Agent (B) — baton

**Updated:** 2026-09-24 · **Session title:** `🚧 Implementation Agent (B) 🟢`
**Next ID:** LB-142 — allocate by grep, checking the JOURNAL too: a shipped entry leaves the queue.

## Now

RV-111, RV-121, RV-164, BF-190 + BF-191, RV-171 shipped. LB-141 filed (two of three walk exits keep
nothing — the owner's call). BF-188's fold collision fixed; it had blocked a third PR. RV-171 is the
one to remember: a failed GET left a blank list that a replace-all PUT then wrote over every row.

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

- **⚠ THE MERGE CALL IS NOT A GATE** — #1467 merged with `Tests` FAILING. Read the five conclusions
  via `list_workflow_jobs` (`resource_id`, not `run_id`).
- **THE MERGE RACE IS ARITHMETIC — seven lost cycles on one PR.** CI ~7 min vs a commit to `main`
  every ~4. Merge the INSTANT the five are green; no run for your head = conflicted PR.
- **THE FOLD IS SAFE AGAIN** — writes `-2` when `-1` exists (BF-188). Verify by anchor count: the
  loss is silent and `check-doc-links` passes over it.
- **A BACKLOG CONFLICT IS NOT ALWAYS TWO DELETIONS** — two sweeps inserting at one point is two
  ADDITIONS, keep both. Read the headings on each side, every time.
- **⚠ AFTER ANY BACKLOG MERGE, DIFF THE FULL HEADING SET** — #1481 silently deleted RV-117/118.
- **REBUILD `changelog.ts` FROM `origin/main`, NEVER SPLICE** — a shared header means a splice drops
  the other PR's entry. It conflicts on EVERY merge.
- **READ THE CODE BEFORE THE ENTRY.** Seven for seven — BF-190/191 missed that two of the three
  walk exits keep nothing.
- **CONTROL-RUN every new test against `origin/main`**; E2E is ADVISORY, so pair a spec with a
  gating vitest file. **A source-scanning test can fail in CI on ITSELF**: `git ls-files` skips it
  while untracked, and `ls-files A B -- '*.tsx'` UNIONS pathspecs — filter in JS.
- **A gate's exit code must be read DIRECTLY**, never via `&&`/`;` into `git commit`; and COMMIT before `git stash`/`checkout`.
- **`tsc --noEmit` typechecks NEITHER an auth-gated page nor tests.** Before pushing a new spec run
  `node scripts/check-test-typecheck.js` — shrink-only per file, and it caught an invented enum.
