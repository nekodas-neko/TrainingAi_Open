# Handoff — 2026-10-05 · Release-train restructure: spec, freeze, triage

_Domain: `platform` (also touches every role in `docs/agents/`) · Branch: `neko/adoring-ritchie-pnfwwj`
· PR: [#2055](https://github.com/nekodas-neko/TrainingAi_Open/pull/2055), open, CI running on
`ee230953`_

> **Read first:** [`docs/superpowers/specs/2026-10-05-release-train-design.md`](../superpowers/specs/2026-10-05-release-train-design.md)
> (the agreed design, §9 holds every decision), then
> [`docs/superpowers/specs/2026-10-05-backlog-triage.md`](../superpowers/specs/2026-10-05-backlog-triage.md)
> (Phase 1). This file covers what the "Development workflow restructuring" session did and hands
> on. **From here the Orchestrator is the only session driving this work** (owner, 2026-10-05:
> "only one chef").

## Goal

The owner wants fewer Railway deploys, much lower token use, GitHub-native work tracking and
control of the workflow back in their hands. The agreed answer:
- merges to `main` stop deploying, and weekly releases are tags the owner approves through the
  Orchestrator;
- GitHub Issues and milestones replace `docs/implementation-backlog.md`;
- four roles replace seven;
- a fully automated side-by-side "TrainingAi Dev" app does the device checks;
- a lean `CLAUDE.md`.

## Current status

- **Phase 0 (freeze): done, apart from running the branch sweep.**
- **Phase 1 (triage): written, waiting on the owner's skim.**
- **Phases 2–5: not started.** Nothing in the pipeline has changed yet: **merges still auto-deploy
  to Railway** and the backlog file is still the queue.
- Verification of what this session wrote:
  - `pnpm check:rules` ran 86 of 86 and all passed.
  - The four test files that read workflow files passed (40 tests).
  - `check-doc-links` and `check-index-doc-paths` are clean.
  - The triage script reproduces the committed CSV byte for byte.
  - **Not exercised:** `branch-sweep.yml` itself (manual trigger, after merge). There was no app,
    device or production code in this work.
- PR #2055 CI on `ee230953` when this was written: Lint, Custom Rules and Migration Check green,
  Tests shards 1 and 4 green, shards 2/3 and Build still running.

## What shipped (on the branch, in #2055; nothing merged yet)

| Commit | What |
|---|---|
| `f0f66bc7`, `9e938334`, `66050688`, `50ea1bba` | The spec: first draft, then the switch from a `dev` branch to **tags**, §10 (bundled shell deferred to v2), then the owner's answers recorded in §9 |
| `ea6fa68a` | The Phase 1 triage doc + CSV, the branch-sweep workflow + list, the platform-index links, the journal entry `docs/overview/entries/2026-10-05-neko-adoring-ritchie-pnfwwj.md` |
| `408e2f83`, `bc4369bb`, `ee230953` | **Pushed by the Orchestrator, not this session:** permanent roles with bounded context, local vs cloud decided by hardware, decisions 11–13 and §9.1, the #1849 correction, and a merge of `origin/main` |
| this commit | `scripts/backlog-triage.js` (the triage generator) and this handoff |

**Done outside the repo (owner-approved, 2026-10-05):**
- **Routines paused** (`enabled: false`, not deleted, so re-enabling is one call): Lane A queue
  check `trig_014GsQsMkskEjkrQc5147pCh`, Lane B queue check `trig_01WcuYTidPtngLFZFD7yKnoL`,
  inbound GitHub watch `trig_01NqWJvqX1DegskXLgdvn26G`. The Gmail sweep and the other project's
  review watch were left alone; they aren't this repo.
- **Freeze message sent** to all seven standing sessions. The owner confirmed every one wrapped up,
  and their wrap-up PRs #2049–#2054 merged.
- **PRs:** #1790 and #1762 closed as superseded, each with a one-line comment. **#1499 held for
  release 1.** **#1849 merged at 08:04Z**, three minutes before the owner's "hold" answer arrived.
  Its migration is guarded (a column drops only if no row in any account holds a value) and the
  deploy check passed, so nothing was lost, but it is live.
- **#2037 and #2040** were left to their own sessions. Check their state; they may still be open.

## Deliberately NOT done

- **Phase 2 plumbing**: the release workflow, docs-skip in `ci.yml`, issue/PR templates, labels,
  the `.dev` Android flavor. It needs the owner's settings first (below), and the flavor needs an
  APK cycle, which is the local Implementer Agent's job.
- **Phase 3 migration and Phase 4 rules rewrite.** Phase 4 must be read by the owner before merge.
- **Fixing the split decisions table** in spec §9: row `10` sits below §9.1. It was left so as not to
  collide with the Orchestrator's in-flight edits. A two-line move.
- **Regenerating the triage CSV.** The branch has since merged `origin/main`, which carries 116 new
  backlog lines from the wrap-up PRs, so a re-run now gives different numbers. That drift is
  expected; re-run right before Phase 3.

## Key decisions (all in spec §9 with reasons; listed so nobody re-asks)

1. **Tags on `main`, not a `dev` branch.** One branch, no back-merges, it ships exactly the tested
   commit, and rollback means redeploying the previous tag.
2. **Weekly releases**, hotfixes any time.
3. **Full CI on every PR, auto-merge, nobody watching.** The owner's cost concern was Railway, not
   Actions, which are free on a public repo.
4. **Four roles:** Orchestrator (absorbs Review, Tuning, release prep), BugFix (may fix small bugs),
   Implementer Agent (local; builds plus release testing plus device checks).
5. **Device testing:** a side-by-side `.dev` app over USB, fully automated. The owner only plugs the
   phone in; the script installs the `.dev` package only.
6. **Triage first, migrate live work only.**
7. **Release approval:** the owner reads the Orchestrator's concise summary (template in spec §3.3)
   and says "approve" in its chat. This is enforced by instruction. GitHub's required reviewer is an
   optional hard lock.
8. **Bundled shell:** v2 milestone, after 2–3 clean releases.
9. **#1499 held** (#1849 already merged).
10. **Phase 0 started 2026-10-05.**
11–13. The Orchestrator's additions: permanent roles with bounded context (compact before going
idle); the ingest architecture (`OR-213`/`214`/`215`) is the first epic after the workflow lands,
**except its Phase 0** (export the raw Oura archive and prove a restore, during the freeze); the
triage stands, and a re-check against the architecture spec replaces a re-triage.

## Gotchas / what did NOT work

- **A cloud session can push only to its own branch.** A tag push and a branch delete both failed
  with "unexpected disconnect". That is why the sweep is a workflow.
- **Every agent acts as `nekodas-neko`**, so GitHub can't distinguish agent from owner. #1849 shows
  the consequence: a "hold" agreed in one session doesn't stop another session merging.
- **Squash-merging #2055 with GitHub's default message would put session URLs into `main`.** The
  first five commits on this branch carry `Claude-Session:` and `Co-Authored-By:` trailers, which
  `CLAUDE.md` forbids. **Merge with `merge_pull_request`, method `squash`, and an explicit
  `commit_title` / `commit_message`.** Auto-merge takes no message, so don't use it here.
- **A push by a second session cancels the running CI.** The cancelled run's `Tests` aggregator then
  reports *failure*. That is not a real failure: check that the run's conclusion is `cancelled`
  before diagnosing anything.
- **Triage regex limits.** "Obsolete" is decided from Lane O titles by keyword. It misfired on
  OR-163 ("sweep"), which was corrected. `keepKind` takes `keep.text`, and `keepIsSettled` takes
  `(keep, lines)`. The buckets must mirror `next-item.js`, including a `Keep:`'s own gate, or the
  counts drift from the tool.
- **The usage figures** in spec §1 (about $45k API-equivalent across five sessions) are what the
  platform reports per session. The Orchestrator's §5 note is right that they are evidence about
  large contexts, not about session lifetime.

## Files to look at

- `docs/superpowers/specs/2026-10-05-release-train-design.md`: the design. §8 is the rollout with
  progress notes, §9 the decisions, §10 the v2 shell.
- `docs/superpowers/specs/2026-10-05-backlog-triage.md` + `.csv`: Phase 1. The CSV is the Phase 3
  migration's input.
- `scripts/backlog-triage.js`: regenerates the CSV (`node scripts/backlog-triage.js`). It holds the
  `OVERRIDES` map with the reason for each.
- `.github/workflows/branch-sweep.yml` + `.github/branch-sweep.txt`: 46 deletes and 3
  archive-then-deletes (`lane-a/q44-phase3-pr1-table-rename`, `chore/or-188-repo-cleanup`, the
  latter holding the first `CLAUDE.md` compaction that Phase 4 can reuse, and
  `fix/offline-tab-tap-native-fallback`).

## Open questions / blockers

- **Owner:** skim the triage doc, mainly its table of 38 questions.
- **Owner, for Phase 2:** create a Railway project token; create a `production` environment in
  GitHub and store the token there; add a tag ruleset so `v*` tags can't be moved or deleted.
- **#2055** needs a merge once CI is green, with the explicit message described above.
- **Then the branch sweep:** a dry run first, then the real run, from the Actions tab.
- **OR-213** is typed as one `chore` in the CSV. It needs an epic or milestone with its phases as
  sub-issues before Phase 3 runs (spec §9.1).

## Pickup prompt

Written for the **existing** Orchestrator chat, which the owner has made the main session. It
already holds its own context on this work (it wrote §5's permanent-roles section and decisions
11–13), so this prompt merges, it does not cold-start.

```
The "Development workflow restructuring" session has handed its work to you and stopped. From
now on you are the ONLY session driving the release-train restructure ("one chef", owner
2026-10-05). Combine what it knew with what you already know, then carry on.

1. Sync: `git fetch origin neko/adoring-ritchie-pnfwwj` and check it out. It holds your three
   commits plus its handoff and the triage script.
2. Read docs/handoffs/handoff-2026-10-05-platform-release-train-restructure.md in full. It holds
   everything that session did that you may not have seen:
   - the Phase 0 actions taken outside the repo (paused routine IDs, the freeze messages, the
     closed PRs);
   - why #1849 got through the hold;
   - the branch-sweep design (a cloud session can only push its own branch);
   - how the triage was derived, and the regenerator at scripts/backlog-triage.js;
   - the gotchas, chiefly: merge #2055 with an EXPLICIT squash message, because the early commits
     carry session-URL trailers CLAUDE.md forbids on main, and a "Tests: failure" from a
     CANCELLED run is not real.
3. Reconcile it with your own context. Where the two disagree, the spec's §9 decisions table is
   the record. Tell the owner in a few lines what changed in your picture, if anything.
4. Then continue, in order:
   a. Spec §9: move decision row 10 back inside the table (it sits below §9.1).
   b. PR #2055: when every required check is completed+success on the head, merge it with
      merge_pull_request, method "squash", and an explicit commit_title/commit_message. No
      auto-merge, no default message.
   c. Branch sweep: after the merge, run the "Branch sweep" workflow with dry_run=true
      (actions_run_trigger), read its log, then run it for real. It skips any branch with an open PR.
   d. Raw-archive export plus a proven restore (ingest-architecture Phase 0, your decision 12),
      during the freeze.
   e. Before Phase 3: re-run `node scripts/backlog-triage.js` (the backlog has drifted), make
      OR-213 an epic or milestone in the CSV, and diff the work rows against the architecture spec.

Standing constraints: merges to main still auto-deploy until Phase 2 turns Railway's auto-deploy
off. #1499 (auth) is held for release 1. The three routines are paused; leave them so. Phase 2
needs the owner's Railway token, a `production` environment holding it, and a `v*` tag ruleset.
The `.dev` Android flavor is the local Implementer Agent's job (APK cycle). Phase 4 (the lean
CLAUDE.md and the role prompts) is read by the owner before merge. Every agent acts as the owner's
GitHub account, so agree in writing who merges what.
```
