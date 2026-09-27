# Git in this sandbox — the two investigations, in full

`CLAUDE.md`'s Git Workflow section carries the rules. **This file carries the evidence** — two
investigations that each cost most of a session, kept whole because a rule that gets doubted is a
rule that gets broken, and the working is what settles the doubt.

Split out 2026-09-27 (OR-189). Read it when a branch sweep, a merge or a PR behaves strangely, or
when you are tempted to conclude a rule below is over-cautious.

---

## 1. Branch cleanup — why `git branch --merged` is useless here

- **Start every follow-up branch from a freshly-fetched `main`.** ⚠ This rule's premise was FALSE
  until 2026-09-26: **"Automatically delete head branches" was switched off**, and nothing ever
  cleaned up, so **1,562 branches had accumulated** in the six weeks since the repo was created —
  about 37 a day, which is just the merge rate with no cleanup. The owner enabled it, and a one-off
  pass took the remote from **1,562 branches to 45** (7 open PRs + 28 closed-but-unmerged + `main` +
  strays). It is now self-maintaining, and the rule below is true for the first time.
  **⚠ And `git branch --merged` CANNOT be used to find dead branches here — it reported 3 of 1,562.**
  Squash-merge writes a brand-new commit, so a merged branch's tip is never an ancestor of `main`.
  Anything that cleans up branches must key on **PR state** (`gh pr list --state merged --json
  headRefName`), intersect that with what is actually on the remote, and subtract open PRs and
  `main`. A naive ancestry sweep deletes nothing; an ancestry sweep "fixed" by ignoring ancestry
  deletes the closed-but-unmerged branches, which are the ones holding work that never landed.
  **⚑ A BRANCH HAS MEANING ONLY IF IT HAS AN OPEN PR — that is the whole rule (owner, 2026-09-26:
  *"ideally we want every branch to have meaning"*).** Auto-delete now clears merged branches, so
  anything left over is a branch whose PR was closed unmerged, or one that never had a PR. **If work
  on a branch is worth keeping, open a DRAFT PR** — that is the marker, it costs nothing, and it makes
  the work visible in one list. Anything with no open PR is sweepable without asking.
  **Do NOT use the backlog's `Branch:` field as that marker — it records a PLAN, not a fact, and it is
  already wrong.** 199 entries carry one; audited 2026-09-26, `Q-44`'s names
  `refactor/de-oura-identifiers` while its live branch is `lane-a/q44-phase3-pr1-table-rename`, and
  `OR-127` and `RV-99` have live branches and no field at all. A draft PR is a fact GitHub maintains
  and cannot go stale; a prose field is one more thing to keep in sync and it already is not.
  **⚠ Before sweeping, check the branch list against queued entry IDs — but MATCHING AN ENTRY IS NOT
  ENOUGH, and assuming it was wrong the first time this rule was applied (corrected 2026-09-26,
  `OR-174`).** Four of 38 survivors matched still-queued entries and were called a head start on
  live work. Diffed afterwards, **not one held anything worth keeping**: `OR-127`'s harness is on
  `main` with `main` **208 lines ahead**, `RV-99`'s source files are **byte-identical** to `main`,
  and `Q-44` adds migrations **273/274** that `main` already uses for something else, so it cannot
  land without renumbering. **An entry stays open for reasons unrelated to its branch** — OR-127's
  harness shipped; the entry is open for the on-device run it still owes.
  **So the check is three questions against `main`, in order: is the file there at all, is it
  identical, is `main` AHEAD.** A branch whose name matches a live entry and whose content `main`
  has moved past is the worst kind to keep, because a later session can "restore" older code from
  it.
  Squash-merge + auto-delete-head-branch means stale local refs break things silently — CI has failed to trigger entirely off a stale base (sessions 167, 171–173). Ritual: `git fetch origin main && git remote prune origin && git checkout -B <branch> origin/main`. If CI doesn't start, suspect a stale base and rebase before anything else. Expect `package.json`/`packages/shared/src/changelog.ts` conflicts when PRs land in parallel — resolve by re-bumping on the fresh base.

---

## 2. The shallow-fetch defect — why a PR can get zero CI runs

- **⛔ `git fetch origin main` in this sandbox returns a SHALLOW pack, and a PR built on it gets
  ZERO CI runs.** Measured 2026-09-23, after it ate most of a session. The proxy grafts the fetched
  tip as a root — `.git/shallow` ends up containing `origin/main` itself — so the fetched branch has
  no ancestry, `git merge origin/main` fails with **"refusing to merge unrelated histories"**, and a
  merge computed against that truncated view produces a tree GitHub reads as genuinely conflicted.
  **A conflicted PR is never given a workflow run**, so the symptom is `get_check_runs` returning
  `total_count: 0` forever while CI runs normally for every other branch. That looks exactly like
  the stale-base tell above and is a different thing — chasing the wrong one cost four PRs
  (#1426, #1428, #1430, #1435, all abandoned with sound diffs).
  **⚠ THE CULPRIT WAS `pnpm check:rules`, NOT the fetch — found and fixed 2026-09-23 (LA-130).**
  The rule used to say a plain fetch re-grafts at the new tip, so `--unshallow` was needed on
  *every* fetch. That was wrong, and so was the first attempt to correct it. **`check:rules` runs
  every step of the Custom Rules job against your own clone, and one of those steps was
  `git fetch --depth=1 origin main` — which re-shallowed the clone on every run, measured 1,445
  commits down to 2.** Since `check:rules` is run immediately before every push, the clone was
  freshly truncated at exactly the moment its ancestry mattered, and the bare `git fetch origin
  main` that followed got the blame for a state it merely failed to repair — a fetch cannot *deepen*
  a shallow clone. The CI step is now guarded on `origin/main` being absent, so it still fetches in
  CI (where a depth-1 checkout really has no base) and is a no-op locally.
  **So a bare fetch is ordinary again**, measured 0 re-shallows in 16 across two clones once
  `check:rules` was out of the picture. `git fetch --unshallow origin` is a one-off repair, and it
  **fatals** with *"on a complete repository does not make sense"* when the clone is already whole —
  so guard it with `test -f .git/shallow`, and never read its result through `| tail -1` beside
  another command, which is how a fatal was read as a success and sent this whole diagnosis the
  wrong way twice. The session-start hook does the one repair for `$CLAUDE_PROJECT_DIR`; a clone you
  make yourself in the scratchpad is yours.
  **Still check `.git/shallow` when a merge or a PR misbehaves** — it is one cheap command, and any
  other tool that replays a CI step can reintroduce this. Two things distinguish it from a stale
  base, and both are cheap:
  `git rev-list --max-parents=0 HEAD | wc -l` returning more than 1, and
  `git merge-base HEAD origin/main` returning empty. When a local repo has already been poisoned,
  `git clone` (no `--depth`) into the scratchpad gives a sound history — that is what unblocked it,
  and `pnpm install --frozen-lockfile` there takes 30 s. **`update_pull_request_branch` is the
  decisive test**: it merges server-side with GitHub's full history, so if it also refuses with
  *"merge conflict between base and head"*, the conflict is real and not a reporting lag.
