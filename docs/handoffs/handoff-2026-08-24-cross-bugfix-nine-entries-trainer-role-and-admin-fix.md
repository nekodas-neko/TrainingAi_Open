# Handoff — 2026-08-24 · BugFix intake: nine entries, a trainer-role design decision, and one stale PR rescued

_Domain: `cross` (touches `nutrition`, `body`, `workouts`, `platform`) · Branch:
`claude/bugfix-intake-agent-mfzw9q` · PR: docs-only wrap-up, opened this commit_

> **Read first:** `projectOverview.md` (status + Known Issues), then
> `docs/agents/state/bugfix.md` (this role's baton — rewritten in full alongside this doc), then
> `docs/implementation-backlog.md` (the queue: `BF-1` through `BF-9`). This file covers only what
> *this* session did and what it leaves behind — it is not a substitute for the baton, which is
> what a successor BugFix session actually starts from.

## Goal

Standing BugFix intake: turn owner reports (screenshots, one-line asks, "why is this doing that")
into traced, docs-only backlog entries. Not a single line of work — one continuous session across
a full day that filed nine entries across four domains, plus one detour into merging an unrelated
PR at the owner's explicit direction.

## Current status

- Nine backlog entries filed (`BF-1` through `BF-9`), all landed on `main` via docs-only PRs.
- **Two shipped already**, by Lane B, before this session closed: `BF-6` (#355) and `BF-8` (#353).
  Their own PRs did their own `projectOverview.md`/changelog/journal bookkeeping — nothing left for
  this session to do there.
- **Seven remain open**: `BF-1`, `BF-2`, `BF-3`, `BF-4`, `BF-5`, `BF-7`, `BF-9`.
- Every PR this session opened is merged. Working tree clean, branch rebuilt from a fresh `main`.
- Build/test: every PR passed the full CI gate before merge (`pnpm check:rules` run locally first
  each time — the step count moved from 50 to 54 over the course of the day as other lanes landed
  their own Custom Rules checks; always quote the count the run actually reports, never a
  remembered number). No app code was touched by this session except the one non-BugFix PR
  described below, which had its own test run.
- Device-verified: n/a — no UI/native paths touched by any entry filed this session. Two of the
  *shipped* entries (BF-6, BF-8) touch on-screen ordering and workout-screen text respectively;
  their own PRs state their own device-verification status, not repeated here.

## What shipped (by this session directly)

All docs-only, all merged, all self-mergeable per CLAUDE.md's Standing Instructions (no
confirmation needed for docs-only PRs):

| PR | What |
|---|---|
| #293 | Filed `BF-1` (blood-panel import, gated), `BF-2` (DEXA calibration filter), `BF-3` (dosed-substance tracking) — three feature notes from one owner message |
| #294 | Cleared `BF-1`'s gate — owner picked crop-before-upload; recorded two binding constraints (region chosen not fixed; pre-cropped files accepted) and flagged that the repo is **public**, so the owner's real example report must never become a committed test fixture |
| #301 | Filed `BF-4` (nutrition photo scan feels slower) — first pass ruled out the AI call via `ai_call_log` latency data |
| #304 | Amended `BF-4` after the owner pointed at the archived pre-cut repo — dated the regression to `#112` (3 Jul, `generateText`+`JSON.parse` → `generateObject`), and **corrected two of the entry's own earlier claims** rather than silently rewriting them |
| #337 | Filed `BF-5` (week-in-review as its own page — feature, needs a plan) and `BF-6` (finished-logging button unreachable — measured **0 of 55** `day_checkins` rows ever marked) |
| #341 | Filed `BF-7` (45-min session-length slider — feature, needs a plan) and `BF-8` (Intensity toggle reads "Full · As prescribed" over an auto-applied deload — found unreported, in a screenshot sent for something else) |
| #342 | Promoted `BF-8` to the head of the queue and re-tagged 🔴 after the owner confirmed it from lived experience (*"I was under the assumption I was doing my full session but it looks like it has been deload"*); settled two of `BF-7`'s three findings after the owner chose to anchor to the session's configured length and drop 15 minutes |
| #343 | Filed `BF-9` (trainer role — build a program for another user from your own app) with the design recommendation, then amended in the same PR with the owner's approval and the real population size (~3 users, 5 max, all known) |

## What shipped (one detour, not mine to file)

**PR #124** (`fix/exercises-route-admin-db-check`) — another session's fix, open and green since
2026-08-18, waiting on an owner decision. The owner's *"go with your recommendation… merge when
green"* covered `BF-9`'s design but not, on its own, someone else's auth PR — that got its own
explicit `AskUserQuestion` before touching it, and came back yes.

Its green was five days and ~200 commits stale. Rather than trust it, this session:
1. Attempted `update_pull_request_branch` → real conflicts.
2. Merged `origin/main` into it locally (**never rebased** — not this session's branch, and a
   rebase would invalidate the original author's checkout).
3. Resolved two conflicts by keeping what each side contributed, not by picking a side wholesale:
   `.github/workflows/ci.yml` gained 4 new Custom Rules steps on `main` while the PR added 1 — kept
   all 5. `docs/implementation-backlog.md` had drifted too far for a hunk-level splice to be safe,
   so it was taken whole from `main` with only the PR's one legitimate edit (removing the `Q-479`
   entry it completes) reapplied on top.
4. Ran its `admin-claim-not-authoritative.test.ts` locally (4/4) before pushing.
5. Pushed, watched CI go green on the fresh head, merged.

Verified on `main` afterward: `check-admin-claim-in-api` present exactly once in `ci.yml`, `Q-479`
gone from the backlog.

## Deliberately NOT done

- **No entry in this session was implemented.** BugFix's whole authority is docs-only; even `BF-9`
  — approved down to population size and risk acceptance — is filed and designed, not built.
- **No separate `docs/overview/entries/` journal file for this session's own PRs.** That
  convention is shaped for shipped code (version bump, changelog line); BugFix's two prior
  sessions instead kept a `## Session log` section inside the baton itself, and this session
  follows that established pattern rather than forcing a mismatched file. This handoff doc is the
  narrative record; the rewritten baton carries the log entry.
- **No `projectOverview.md` edit.** Nothing this session did reached `main` as shipped code, so
  there is no ✅ to tick and no Known-Issues row this session itself is the source of.

## Key decisions (with rationale)

- **`BF-9`'s design is settled, and the settlement has a hard edge that must survive to
  implementation.** Trainer is a relationship table beside `friendships`, never a boolean on
  `users` — reusing `isAdmin` would hand every trainer the read-only SQL endpoint and the error
  console, which are *operator* permissions, not trainee ones. Consent must be the trainee's,
  copying the friendship handshake exactly (trainer requests, trainee accepts, trainee revokes).
  The owner accepted the *population* risk (~3 users, 5 max, all known, "risk woudl be accepted")
  — that is a statement about who the people are, and it does **not** relax the write-path
  ownership guards, which exist to stop a *bug* corrupting a real person's data, not an attacker.
  Both points are written into `BF-9` itself so a planning session cannot miss them.
- **A stale PR's green CI is not evidence, and this cost real time twice in one night.** `#124`'s
  18-Aug green and this session's own `#343` mid-flight green both turned out to be racing a `main`
  that moved every few minutes. The fix each time was the same: re-check `git log --oneline
  HEAD..origin/main`, merge if behind, re-verify, then merge — never trust a check-run result
  older than the last base-freshness check.
- **The archived pre-cut repo is now a standing tool, not a one-off.** `nekodas-neko/TrainingAI_Old`
  (3,225 commits) is what let `BF-4` be dated to a specific PR after the public repo's own short
  history said it couldn't be done. Recorded in the baton so the next session reaches for it
  immediately instead of rediscovering that it exists.

## Gotchas / what did NOT work

- **A shallow clone that re-forms after a container restart produces two distinct false
  alarms.** `git merge origin/main` fails with `refusing to merge unrelated histories`, and — more
  dangerously — `git diff --stat origin/main` shows large phantom deletions across files this
  session never touched, which reads exactly like another agent's work being reverted. It is not;
  `git fetch --unshallow origin` before either command resolves both symptoms. Caught before acting
  on it, but only barely — worth flagging loudly to whoever reads this next.
- **An added-on-one-side merge conflict must be verified, never assumed.** Twice this session a
  conflict's `main`-side hunk was empty (a heading removed upstream). The correct resolution — keep
  mine — was confirmed each time by grepping the target commit for whether the removed entry had
  actually shipped, **before** resolving. A stale-base merge blindly reviving a completed entry is
  a documented failure mode in this repo (`docs/implementation-backlog.md`'s own protocol section
  names the "heading with no body" tell); the discipline that prevents it is checking `main`, not
  trusting `--ours`.
- **`mcp__github__list_pull_requests` (search-backed) reported `merged: false` for PRs this
  session had just watched `merge_pull_request` return `{"merged": true}` for.** `pull_request_read
  get` on the same number returned the correct `"merged": true`. Treat the list/search tool's
  `merged` field as unreliable; use `get` (or read the state directly off `main`) when it matters.
- **A drafted doc-size baseline raise can evaporate before it's pushed.** Twice this session a
  raise was computed, written into `doc-size-baseline-history.md`, and then made unnecessary by a
  parallel PR shrinking the backlog underneath it in the time it took to commit. The fix each time
  was to recompute after the merge, not before, and to record in the history file that a raise was
  drafted and did not happen — deleting the reasoning would have looked like sloppy bookkeeping
  rather than what actually occurred.

## Files to look at

- `docs/agents/state/bugfix.md` — the baton, rewritten in full as part of this same wrap-up. Read
  it before this file if you are picking up the role.
- `docs/doc-size-baseline-history.md` — every raise/ratchet this session made, each with the
  reasoning, including the two that evaporated (see above).
- `docs/implementation-backlog.md` — `BF-1` through `BF-9` (minus `BF-6`/`BF-8`, shipped). `BF-9`
  is the one with the most implementation-relevant detail packed into the entry itself.

## Open questions / blockers

- **Nothing is waiting on the owner right now.** Every question this session raised was answered
  in the same session (BF-1's crop decision, BF-7's slider anchor, BF-9's design and risk
  acceptance, the go-ahead to merge `#124`).
- `BF-1`, `BF-5`, `BF-7`, `BF-9` each explicitly need a **planning session** before an implementer
  can start — none of the four is a bug an implementer can pick straight off the queue.

## Pickup prompt

See the chat reply for the paste-ready block — it is the standing `prompts/bugfix.md` cold-start
prompt plus one explicit line the owner asked for: read the baton and orientation docs, then wait,
because a specific request is coming and the agent should not pick up a queue item on its own
initiative before it arrives.
