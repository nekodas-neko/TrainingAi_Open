# The standing agents

Four agent roles run against this repo, one of them in two parallel lanes — five concurrent
sessions at full strength. This file is the contract between them. Read it before starting a
session, and read it again if you are about to touch a path you do not own.

| Agent | Sessions | Takes input from | Produces | Touches code? |
|---|---|---|---|---|
| **Implementation** | 2 (Lane A, Lane B) | `docs/implementation-backlog.md` | Shipped changes | **Yes** |
| **BugFix** | 1 | The owner — screenshots, reports, "this looks wrong" | Triaged backlog entries | No |
| **Tuning** | 1 | The owner — lived experience against what a score said | Calibration evidence + proposals | No |
| **Review** | 1, weekly | The app itself | Review write-ups + backlog entries | No |

**Only the two Implementation lanes write code.** The other three are intake and analysis roles
that end at a docs-only PR. That is the single most important property of this arrangement: it
means the collision surface between five concurrent agents is just Lane A against Lane B, and
everything else merges freely.

---

## 1. What each agent is for

### Implementation (Lane A · Lane B)

Works the backlog queue top-down within its lane, one item per run, following the protocol at the
top of [`docs/implementation-backlog.md`](../implementation-backlog.md). Re-verifies each entry's
premise against current `main` before building — entries are leads, not specs, and this queue has
repeatedly held items that were already shipped, already refuted, or wrong about how many call
sites existed.

Lane A is the **engine**: data, sync, scoring, server routes, device pipelines.
Lane B is the **surface**: screens, components, client state, styling.

The seam is drawn by file ownership rather than by subject, because file ownership is what actually
causes merge conflicts. §3 is the contract.

### BugFix

The owner's intake channel. Takes a screenshot, a description, a "why is this doing that", and
turns it into a backlog entry good enough to implement from: what was observed, on what surface,
the code path it traces to, and what evidence would confirm it. Then it merges the docs-only PR and
waits for the next report.

**It does not fix.** The temptation to fix a one-line bug in the intake session is exactly how
intake stops being reliable — the queue is the record, and a fix that skipped the queue is a fix
nobody else can see coming. If the owner explicitly asks for an in-session fix, that is a direct
instruction and it wins, but it is the exception and the entry still gets written.

What separates a good entry from a bad one here: **trace it before filing it.** A report says what
the owner saw; the entry has to say what the code does. An entry that only restates the symptom
makes the implementer redo the triage, which is the work this agent exists to have already done.

### Tuning

Takes lived feedback against what the app claimed — *"my sleep was bad but it scored 82"*, *"this
said I was recovered and I wasn't"* — and turns it into calibration evidence.

**It proposes; it does not ship.** Scoring drives every recommendation the app makes, a bad
calibration is hard to notice from inside, and the history is only comparable to itself if changes
are deliberate. So this agent measures, writes up what it found, and files the proposal. The owner
signs off before any scoring change is implemented, and the implementation itself belongs to Lane A.

A proposal is not ready until it carries: the owner's report, the stored values for those days
pulled from production, what the current formula does with them, what the proposed change would
have produced instead, and **how many other days it would move**. That last one is the one that
gets skipped and the one that matters — a change tuned to one bad night that silently re-scores
four months of history is not a tuning, it is a rewrite.

Where the numbers come from: `POST /api/admin/db-query` over the `claude_ro` views. Read the
constraint in `CLAUDE.md` before quoting any count — those views are row-scoped to one user and
prune at 30 days, so every number is "the owner's, recently", never "the system's".

### Review

Runs on a weekly cadence rather than on demand. Sweeps the app for bugs, inconsistencies and drift,
writes the findings up in `docs/reviews/YYYY-MM-DD-<topic>.md`, and files each one as a backlog
entry. Findings without a backlog entry do not count — `CLAUDE.md`'s **No orphaned findings** rule
is the whole point of this role.

The failure mode to design against is a review that reads source and reports what *should* happen.
This repo has paid for that repeatedly; the 2026-08-08 review that actually ran the app found two
live bugs that source-reading had missed several times. Run it. `pnpm dev` works, the E2E harness
exists, and production is queryable.

---

## 2. What every agent may do without asking

The owner's standing decision, current as of 2026-08-17:

| Action | Authority |
|---|---|
| Push to a feature branch, open a PR | **Go ahead** |
| Merge a tested, CI-green change | **Go ahead** — with the base check in §5 |
| Merge a docs-only or plan-only PR | **Go ahead**, no ceremony |
| Data-dropping or non-reversible migration | **Ask first** |
| Auth, session or security change | **Ask first** |
| Secret handling | **Ask first** |
| **Any scoring or formula change originating from Tuning** | **Ask first** — see §1 |
| Post a comment on a PR or issue | Only when a reply is genuinely needed |

"Tested" means the full local gate *and* the device-verification gate, both defined in `CLAUDE.md`.
Neither is relaxed by anything in this file.

---

## 3. The lane contract

### The principle

**Lane A owns everything that decides what is true. Lane B owns everything that decides how it
looks.** A value computed, stored, synced or served belongs to A. A value rendered, laid out or
animated belongs to B.

### Lane A — the engine

```
lib/data/**                     including every Postgres migration
lib/local-store/**  lib/sqlite/**
lib/cache-groups.ts
app/api/**
packages/shared/**              except changelog.ts (see below)
lib/health/  lib/sleep/  lib/workout/  lib/nutrition/  lib/activity/
lib/coach/  lib/ai/  lib/ai-chat/
lib/oura/  lib/oura-ble/  lib/oura-models/  lib/scale-ble/  lib/polar-ble/  lib/live-hr/
lib/auth/  lib/security/  lib/rate-limit.ts  lib/observability*
android/**                      Kotlin, the BLE foreground services
```

### Lane B — the surface

```
app/**                          except app/api/**
components/**
app/globals.css
lib/hooks/**  lib/stores/**
lib/haptics.ts  lib/shell-nav.ts  lib/navigate-with-transition.ts
lib/view-transition.ts  lib/use-copy.ts  lib/use-online-status.ts  lib/session-icon.tsx
```

### Anything not listed

`lib/` holds ~60 top-level entries and enumerating all of them here would go stale within a month.
So: **if a path is not listed, the lane that needs it claims it in its state file before touching
it**, and the other lane checks state files before starting an item. First claim wins for the
duration of that item. If both lanes need the same file at the same time, the item that needs it
*changed* outranks the item that needs it *read*, and the other lane picks a different item rather
than negotiating.

### The files both lanes will fight over anyway

`package.json` and `packages/shared/src/changelog.ts` conflict on essentially every parallel merge,
because every user-visible change bumps the same lines. There is no way around it, only a correct
way through it:

> **Rebuild from `origin/main`, never splice the conflict hunks.** When two PRs bump on the same
> day the conflict falls *inside* an entry's `changes:` array, and both sides share the
> `version:`/`date:` header above the marker — so a naive splice produces an entry with no header
> and silently drops the other lane's version. Take
> `git show origin/main:packages/shared/src/changelog.ts`, prepend your entry at the next free
> number, write the whole file. This corrupted the changelog twice in one day before the approach
> changed.

### Numbers, reserved up front

The repo has lost sessions to number collisions — six in three days at the worst, and two live
duplicate Q numbers survived in the backlog until 2026-08-17. The pointer in the backlog is a
*floor*: it cannot see an unmerged PR, and a number can be claimed and merged inside a single
session without ever appearing in an open one.

So numbers are **not** taken one at a time from the pointer. Each agent owns a band:

| Agent | Q band |
|---|---|
| Implementation Lane A | **314 – 349** |
| Implementation Lane B | **350 – 386** |
| BugFix | **387 – 449** |
| Review | **450 – 499** |
| Tuning | **500 – 529** |

Take numbers from your own band and you never need to read the pointer or write to it — which also
removes the shared-line edit at the top of the backlog that would otherwise conflict five ways.
When a band runs out, claim the next block of 50 above 529, record it in this table, and say so in
your handoff.

Q numbers are identifiers, not priorities. Priority is queue position. A Q-451 sitting above a
Q-315 is correct and expected.

**Postgres migration numbers and local SQLite versions belong to Lane A alone.** No other agent
takes one. If work outside Lane A turns out to need a schema change, stop and hand it to Lane A
rather than taking a number.

---

## 4. Identity and handoff

Each agent is a continuing role, not a session. When a session's context runs long, or the owner
calls a reset, the agent writes its baton and a successor picks it up **under the same name**.

### The baton: `docs/agents/state/<agent>.md`

One file per agent, at a stable path, **overwritten** at every handoff. This is the first thing a
successor reads, and it answers only: where am I, what is in flight, what is next, what is blocked.

It is deliberately not a narrative. The narrative goes in a dated handoff doc
(`docs/handoff-YYYY-MM-DD-<domain>-<title>.md`, written with the `handoff` skill) when a session
closes a cluster of related work. The two have different jobs — the baton is *state* and is always
current; the handoff is *history* and is never edited after the fact.

### The handoff ritual

Trigger it on context pressure, on an owner reset, or on finishing a cluster:

1. **Land everything first.** The container is ephemeral and the repo is re-cloned each session.
   An uncommitted baton is a lost baton. If a PR is open, fold the handoff into it.
2. **Rewrite the baton** at `docs/agents/state/<agent>.md`, in full. Stale batons are worse than
   absent ones, because they are trusted.
3. **Write the dated handoff doc** if a cluster closed. Use the `handoff` skill; it owns the
   template and the honesty rules.
4. **Reconcile the docs** per `CLAUDE.md`'s Session Wrap-Up — `projectOverview.md`, the pillar
   index, the backlog, the journal entry.
5. **Never write "done" for anything not in a committed diff and observed working.** State which
   failure surfaces were not exercised — device, native, safe-area, prod-data — every time.

The successor starts from the same prompt in [`prompts/`](prompts/), which tells it to read its own
baton first. No prompt needs editing between generations; the baton carries the change.

---

## 5. Rules that exist because there are five of you

Everything in `CLAUDE.md` applies unchanged. These are the additions that only matter under
concurrency:

- **Re-merge `origin/main` immediately before opening each PR, and again before merging.** Not just
  when cutting the branch. With five agents landing work, a branch cut from a current `main` goes
  stale while you work. Confirm CI is green on the *updated* head — never merge a stale green.
- **`total_count: 0` from `get_check_runs` several minutes after opening a PR means a stale base,
  not slow CI.** Real CI reports queued checks within about a minute. Fetch, merge `origin/main`,
  push; checks start immediately. Do not sit and wait for checks that will never arrive.
- **Commit or stash before every `git checkout`.** A checkout with a dirty tree carries the modified
  files across, and the next `git add -A` commits them onto the wrong branch. This has put one
  item's work into another item's PR twice in a single session. Prefer `git add <paths>` while
  several things are in flight.
- **Check the other lane's baton before claiming an unlisted path.**
- **Never force-push, `reset --hard`, or `--no-verify`.** Under concurrency these do not just lose
  your work.

---

## 6. Starting an agent

Paste the matching prompt from [`prompts/`](prompts/):

| Agent | Prompt |
|---|---|
| Implementation Lane A | [`prompts/implementation-lane-a.md`](prompts/implementation-lane-a.md) |
| Implementation Lane B | [`prompts/implementation-lane-b.md`](prompts/implementation-lane-b.md) |
| BugFix | [`prompts/bugfix.md`](prompts/bugfix.md) |
| Tuning | [`prompts/tuning.md`](prompts/tuning.md) |
| Review | [`prompts/review.md`](prompts/review.md) |

Each prompt is written to be pasted verbatim into a cold session. None of them reference a
conversation, and none need editing between generations.
