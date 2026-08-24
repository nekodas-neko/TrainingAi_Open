# The standing agents

Five agent roles run against this repo, one of them in two parallel lanes — six concurrent
sessions at full strength. This file is the contract between them. Read it before starting a
session, and read it again if you are about to touch a path you do not own.

| Agent | Sessions | Model | Takes input from | Produces | Touches code? |
|---|---|---|---|---|---|
| **Implementation** | 2 (Lane A, Lane B) | Opus 5 · `xhigh` (A) / `high` (B) | `docs/implementation-backlog.md` | Shipped changes | **Yes** |
| **BugFix** | 1 | Sonnet 5 · `high` | The owner — screenshots, reports, "this looks wrong" | Triaged backlog entries | No |
| **Tuning** | 1 | Opus 5 · `high` | The owner — lived experience against what a score said | Calibration evidence + proposals | No |
| **Review** | 1, weekly | Opus 5 · `xhigh` | The app itself | Review write-ups + backlog entries | No |
| **Orchestrator** | 1, weekly | Sonnet 5 · `medium` | The queue and the docs | Sweeps: completions cleared, batches assigned, lanes resolved | No |

The model column is not arbitrary and is not a cost ranking — §6 gives the reasoning per role.

**Only the two Implementation lanes write code.** The other four are intake and analysis roles
that end at a docs-only PR. That is the single most important property of this arrangement: it
means the collision surface between six concurrent agents is just Lane A against Lane B, and
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

### Orchestrator

The only role whose subject is the process rather than the product. Review sweeps the running app
for bugs; Orchestrator sweeps the *repository* for what makes the queue hard to work from: entries
already done, entries that should ship together, entries nobody can tell which lane owns, docs that
no longer describe reality.

It exists because those four jobs have no natural owner. Every other role is measured on what it
finds or ships, so queue hygiene is always somebody's second priority — and the evidence is that it
was nobody's: **17 queue entries announce their own completion in their own headings**, and 4 of 211
carry a batch. Neither is a failure of any individual session; both are what happens when a standing
chore has no standing owner.

It runs one of four sweeps per session — completions, aggregation, lane/readiness, docs-vs-reality —
and says which. Its authority is docs-only, same as BugFix, Tuning and Review. **Reordering the queue
is the one place it can do real damage**, so it never moves an entry inside an owner-directed focus
block or one carrying `Gate: owner`, never moves down what the owner moved up, and states every move
it does make in the PR body. A silent reprioritisation is indistinguishable from a bad merge, and
this repo has had both.

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

### Anything not listed — decide it by the rule, not by the list

`lib/` holds around 68 top-level entries and **40 of them are named in neither list above**. An
enumeration of that surface goes stale within a month and then quietly misleads, and it already had:
`lib/coach/` was listed under Lane A here while Q-407 told whoever took it to claim the path in a
baton "because it belongs to neither lane's declared paths". Six `app/api/coach/**` routes import
that directory, so the rule below had always answered Lane A; the entry was corrected to match
(PS-1, 2026-08-20). Nothing caught the contradiction on its own, and an enumeration never will —
which is the argument for the rule.

So the lists above are the obvious cases, and this rule settles everything else:

> **Reached by `app/api/**`, or it reads or writes storage → Lane A.**
> **Reached only from `app/**` or `components/**` → Lane B.**
> **Both → Lane A, and the engine half lands first.**

Trace the import, don't search this file. A rule survives a new directory; a list does not.

Where even the rule is ambiguous — a genuinely new shared module, a script, a workflow file — the
lane that needs it **claims it in its baton before touching it**, and the other lane checks batons
before starting an item. First claim wins for that item's duration. If both lanes need the same file
at once, the item that needs it *changed* outranks the item that needs it *read*, and the other lane
picks a different item rather than negotiating.

**Release a claim when the PR that took it merges.** Four claims in Lane B's baton currently end
"release the claim when convenient", which is how a lease becomes permanent. A claim names the
branch that holds it; when that branch is gone, so is the claim.

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

### Identifiers — one letter per agent, counting up forever

Every queue entry carries an ID. **The letter says who found it. It never says who ships it, and it
never changes** — an item filed by Review and built by Lane A keeps its `RV-` for good, which is what
makes "what has Review found, and did any of it get built" a question you can actually ask.

| Agent | Letter |
|---|---|
| Implementation Lane A | `LA-` |
| Implementation Lane B | `LB-` |
| BugFix | `BF-` |
| Review | `RV-` |
| Tuning | `TN-` |
| Orchestrator | `OR-` |
| One-off sessions (planning, urgent) | `PS-` |

Counters are **unbounded**. Find your next free number with one command:

```bash
grep -rhoE '\bRV-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1
```

**Why this replaced reserved number bands.** Bands were introduced because a single shared
next-free pointer is a *floor*, not an authority — it cannot see an unmerged PR, and that caused six
collisions in three days plus two live duplicates that survived for weeks. Bands fixed that and
bought two new problems: they **run out** (Tuning reached 29 of its 30; Review burned all 50 in two
days), and they need a ledger that has now drifted twice — the second time, following this file's
own "take the next block of 50" instruction literally would have collided with fourteen live
numbers.

Per-agent counters prevent cross-agent collisions exactly as well as bands did. Both still fail if
two sessions of the *same* role run at once and cannot see each other's unmerged PRs — that is
unavoidable in any allocation scheme, and it has happened (two sessions once ran the same compaction
chore and one PR's work was discarded whole). The difference is that counters never exhaust and need
no ledger, and `scripts/check-backlog-pointers.js` fails CI on a duplicate ID, so a same-role
collision surfaces at review rather than living in the queue. Resolve one by appending a letter:
the second `RV-14` becomes `RV-14a`.

**Existing `Q-` numbers stay exactly as they are.** There are over 10,000 references to them across
775 files; renumbering that surface would be days of risk for no function. `Q-` is a valid legacy
ID, and both schemes coexist in the queue indefinitely.

Priority is queue position, not the ID. An `RV-31` above an `LA-12` is correct and expected.

**Postgres migration numbers and local SQLite versions belong to Lane A alone.** No other agent
takes one — not Review, not BugFix, not an urgent one-off. Work outside Lane A that turns out to
need a schema change stops and hands the item to Lane A.

### The three fields that decide what is startable

Beyond the `[domain]` tags, an entry may carry:

- **`Lane: A` / `Lane: B`** — which implementer. A *prediction*, useful when the rule above is
  ambiguous or the item spans unlisted paths. Most entries carry none, and that is correct: the rule
  already answers it. Where the filer genuinely cannot tell, write **`Lane: ?`** — the first lane to
  reach it decides and edits the entry, rather than both assuming the other owns it.
- **`Needs: <ID>`** — this entry cannot start until that one has shipped. **A target that is not in
  the queue counts as satisfied**, because a completed entry is removed from the queue by the
  protocol; treating its absence as an error would wedge every dependent the day its blocker
  succeeded. The cost of that rule is that a typo'd ID looks identical to a shipped one, so the
  check script fails on a `Needs:` naming an ID that has never existed anywhere in the tree.
- **`Gate: owner`** / **`Gate: device`** — waiting on a decision from the owner, or on the S25 smoke
  run. These used to be prose `⛔ blocked:` markers that conflated three different things with three
  different resolvers; separating them is what lets a script tell you what is genuinely ready.

An item that needs both halves of the app is **two entries**, not one with a paragraph explaining
the order:

```markdown
### [platform] PS-4a — wire the SDK into instrumentation.ts
- Lane: A

### [platform] PS-4b — surface it in the admin console
- Lane: B
- Needs: PS-4a
```

`PS-4b` sits under PARKED until `PS-4a` leaves the queue, and then unparks with nobody editing
anything.

### Batching — aggregate on what has to be verified, not on subject

Two hundred queue entries do not mean two hundred pull requests. But the axis to batch on is not the
obvious one. Measured across the queue on 2026-08-19: entries name **320 distinct files and only 39
are touched by more than one**, so batching by file buys almost nothing; and `platform` alone holds
106 entries, so batching by domain is far too coarse. Half the entries carry 40+ lines of analysis —
this is not a pile of trivia.

**CI is not the scarce resource.** Two hundred PRs at 3–5 minutes is machine time nobody waits on.
The scarce resources are **the owner's attention and the device**. So entries batch when *one
verification pass covers all of them*, and not otherwise:

| Class | Rule | Why |
|---|---|---|
| Touches a migration or the sync-push path | **Never batch** | Blast radius is data; the revert is a corrective migration, not a `git revert` |
| Native / Kotlin (~20 entries) | **Batch hardest** | Each costs an APK build and a sideload, and an install can force the uninstall that destroys the ring key |
| One screen or flow | **Batch by surface** | One `pnpm dev` pass and one device look covers every entry on that screen |
| One pattern across N files (18 entries, up to 263 files each) | **Already a batch — never split** | One review of the pattern covers every site |

A batch is too big when you can no longer describe it in one sentence or revert it as a unit. In
practice that is around five entries or four hundred diff lines, whichever comes first.

**Record it with a `Batch:` field**, because an unwritten grouping is not a grouping:

```markdown
- **Batch:** calorie-budget-surface
```

Entries sharing a slug ship as **one PR**, and `next-item.js` groups them so an implementer picks up
the cluster rather than its top member alone. The batch inherits its highest member's queue
position, so priority is unchanged. `scripts/check-backlog-pointers.js` fails a batch that mixes
Lane A and Lane B — one PR is one lane's work — and the query flags any batched entry that looks
like it carries a schema change.

**Batches are assigned when an entry is next touched, not up front.** Grouping 200 entries in one
pass means deciding for work nobody is about to start, from the least information anyone will ever
have, and the queue moves underneath it. Two are seeded as worked examples:
`calorie-budget-surface` and `scale-weighing-ui`.

### What an implementer reads to start

```bash
node scripts/next-item.js --lane A
```

One global queue, ordered by you; two views onto it. It prints READY in priority order, PARKED with
the reason, and UNCLASSIFIED for anything it could not place — an entry invisible to the query would
be worse than one you had to read.

### An urgent fix from outside the two lanes

Occasionally a session that is not Lane A or Lane B needs to ship a fix now. The usual and preferred
form is still: **write the plan, file it at the top of a lane's queue, stop.** When it does ship:

1. **Read both implementer batons' `Now` section first**, so the fix cannot collide with a branch
   already in flight.
2. **Never take a migration number.** If the fix needs a schema change it goes to Lane A, without
   exception — this is the one that turns a hotfix into a mess.
3. Ship it, under every rule in `CLAUDE.md` that a lane would follow.
4. **File the entry anyway** (`PS-`, marked shipped in the same PR). A fix that skipped the queue is
   a fix nobody else can see coming.

## 4. Identity and handoff

Each agent is a continuing role, not a session. When a session's context runs long, or the owner
calls a reset, the agent writes its baton and a successor picks it up **under the same name**.

### The names are fixed — copy them exactly

A successor session must be created with the **same title** as the one it replaces, character for
character, emoji included. That title is how the owner tells six concurrent sessions apart at a
glance, so a renamed successor is a lost thread even when its baton is perfect.

| Session title | Baton | Prompt |
|---|---|---|
| **🚧 Implementation Agent (A) 🟢** | `state/implementation-lane-a.md` | `prompts/implementation-lane-a.md` |
| **🚧 Implementation Agent (B) 🟢** | `state/implementation-lane-b.md` | `prompts/implementation-lane-b.md` |
| **🪲 BugFix Intake Agent 🟢** | `state/bugfix.md` | `prompts/bugfix.md` |
| **🎶 Tuning Agent 🟢** | `state/tuning.md` | `prompts/tuning.md` |
| **📖 Review Agent 🟢** | `state/review.md` | `prompts/review.md` |
| **🪐 Orchestrator 🟢** | `state/orchestrator.md` | `prompts/orchestrator.md` |

The two Implementation lanes deliberately share an emoji and differ only by the `(A)` / `(B)`
suffix — they are one role in two lanes, and the suffix is the part that carries meaning. Do not
invent a per-lane emoji to tell them apart.

Every handoff states its successor's title explicitly, rather than leaving it to be inferred from
the baton's filename.

### The trailing light: 🟢 live, 🔴 handed on

A title carries two emoji, and they mean different things. **The leading emoji is the role** — 🚧 🪲
🎶 📖 🪐, fixed forever, shared by every generation of that agent. **The trailing emoji is this
session's own status**, and it is the only part that ever changes:

| | |
|---|---|
| 🟢 | Live. This is the session to talk to. |
| 🔴 | Handed on. Its baton is written, its work is merged, it can be archived. |

Fixed titles otherwise create one problem at the moment of handover: for as long as both sessions
are in the list, two of them read `🚧 Implementation Agent (A)` and nothing separates them. The owner
then has to guess which is live, and the guess is wrong half the time.

**Neither light is set by hand.** Every prompt's first instruction is to self-title, so a session
comes up 🟢 on its own; the handoff ritual's last step flips it to 🔴. The owner never types an emoji
in either direction, which is what keeps the scheme from rotting.

That gives the owner a two-pass sweep of the session list: greens are the working set, reds are
finished and can be archived in a batch.

A session sets its own light unaided, in two calls:

1. `get_session` with `session_id` **omitted** — it then describes the calling session, and
   `ccr.id` is its own session ID.
2. `set_session_title` with that ID and the new title.

Both are on the `claude-code-remote` MCP server. Verified working from inside a live session on
2026-08-23, round trip included. Flip to 🔴 **last**, after the baton and every PR have landed — a
session showing 🔴 while it is still pushing commits is worse than one with an ambiguous name.

**Known limit: 🟢 can go stale, and it is the one failure this scheme cannot catch.** The light is
only true if the session got to run its closing step, and a session that hit its context limit,
timed out, or lost its container never did — so it sits there reading 🟢 while being dead. A green
that has not moved in a day is worth checking against the session's actual activity rather than
trusted. This was a known trade at the time it was chosen (2026-08-23): the alternative, marking
only retired sessions so that absent-means-live cannot go stale, gives up the positive signal the
owner sorts on, and sorting on greens is the thing this is for.

### Why there is no third light for "working"

Asked on 2026-08-23: add 🟠 for *working, needs nothing from you*, so the greens are only the
sessions actually waiting. It was investigated and **not built**, for two reasons that are worth
recording so it is not re-attempted.

**The platform already tracks it, per session, correctly.** `list_sessions` returns
`session_status` (`RUNNING` / `IDLE`), `status_bucket` (`WORKING` / `REVIEW_READY`), a
`task_summary` of what a running session is doing, and a `post_turn_summary` carrying
`status_category`, `status_detail` and a `needs_action` field. Measured against the six standing
sessions, that data separated *working* from *waiting on the owner* exactly as intended. A title
emoji would be a hand-maintained duplicate of a signal the system computes for free and never gets
wrong. To answer "which sessions need me", query it — do not read it off a title.

**Nothing that could maintain the light can see the state that matters.** A hook cannot rename a
session: there is no `claude` CLI subcommand for it, the MCP tool is available to the model and not
to hook scripts, and the REST route (`/v1/code/sessions/{session_id}`) needs the session ingress
credential, which the auto-mode classifier blocks reading — correctly, and it was not worked around.
That leaves model-driven renames, which cost a round trip and roughly 300 tokens of response JSON at
each end of every turn. And the case that prompted the request — a session blocked on a permission
prompt or an interactive question — is the one a model-driven rename **cannot** signal, because the
model is the thing that is blocked. Only the harness knows, and the harness already records it.

The 🟢/🔴 pair stays as it is: cheap, set once at each end of a session's life, and about a state
(*this session is finished*) that nothing else records.

### The baton: `docs/agents/state/<agent>.md`

One file per agent, at a stable path, **overwritten** at every handoff. This is the first thing a
successor reads, and it answers only: where am I, what is in flight, what is next, what is blocked.

It is deliberately not a narrative. The narrative goes in a dated handoff doc
(`docs/handoff-YYYY-MM-DD-<domain>-<title>.md`, written with the `handoff` skill) when a session
closes a cluster of related work. The two have different jobs — the baton is *state* and is always
current; the handoff is *history* and is never edited after the fact.

### Batons are size-ratcheted, because they are read under time pressure

The baton is how the other lane finds out what you have claimed and what is in flight, and its own
template says to keep it under a screen. Measured 2026-08-19: BugFix 135 lines, Lane A 162, Lane B
412 (its `Now` section alone is 200), Tuning 562, Review 1,280. Nobody reliably reads a 412-line
file before starting an item, which means the coordination mechanism is not working as one.

All five are now in `docs/doc-size-baseline.json` at their current sizes, shrink-only. They can only
come down, and every handoff is an opportunity — the baton is rewritten in full anyway, and anything
that reads as narrative belongs in a dated handoff doc instead. The target is a screen; the ratchet
just stops the drift going the other way.

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
6. **Flip your trailing light to 🔴**, per the subsection above, and name the successor's exact
   title in your closing message. Do this last — after the baton and every PR have landed.

The successor starts from the same prompt in [`prompts/`](prompts/), which tells it to read its own
baton first. No prompt needs editing between generations; the baton carries the change.

---

## 5. Rules that exist because there are six of you

Everything in `CLAUDE.md` applies unchanged. These are the additions that only matter under
concurrency:

- **A whole-file or whole-directory chore needs the open-PR list checked first.** Orchestrator's
  sweeps and the journal compaction are both whole-file operations, unlike ordinary per-entry work,
  so two sessions running one concurrently is guaranteed conflict — it has happened twice (#130,
  #152) and one PR's work was discarded whole.

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
| Orchestrator | [`prompts/orchestrator.md`](prompts/orchestrator.md) |

Each prompt is written to be pasted verbatim into a cold session. None of them reference a
conversation, and none need editing between generations.

### Which model, and at what effort

Set both when the session is created; each prompt restates its own pair so a pasted prompt is
self-contained.

| Agent | Model | Effort | Why this one |
|---|---|---|---|
| **Implementation Lane A** 🚧 | Opus 5 | `xhigh` | Migrations, sync-push mirroring, auth, the BLE pipeline. The failure mode is a corrective migration or a wedged outbox — things that cost more to undo than the session cost to run. Never downgrade this lane. |
| **Implementation Lane B** 🚧 | Opus 5 | `high` | Carries the cache-group, memo-stability, safe-area and instant-paint rules, which are the bug classes `CLAUDE.md` records recurring most. Reversible by a revert, though, which is what buys `high` instead of `xhigh`. |
| **Review** 📖 | Opus 5 | `xhigh` | The only role measured on noticing what nobody asked about. A weaker model does not fail loudly here — it files a thinner sweep and nothing reveals what it walked past. The least safe place in this set to economise. |
| **Tuning** 🎶 | Opus 5 | `high` | Proposal item 5 — how many other days a change moves, and by how much — is exactly the distribution work a weaker model waves through while sounding certain. Owner sign-off catches a bad proposal; it does not catch a wrong number inside a plausible one. |
| **BugFix** 🪲 | Sonnet 5 | `high` | Tracing a symptom to a file is navigation plus matching against bug classes already written down. A weak trace fails visibly — the entry says it could not locate the path — rather than silently. Escalate to Opus for a report that resists two attempts. |
| **Orchestrator** 🪐 | Sonnet 5 | `medium` | Four mechanical sweeps against scripts that already compute the answer (`next-item.js`, `check-backlog-pointers.js`). Bookkeeping under explicit guardrails. |

**Effort is the bigger dial than the model.** Opus 5 defaults to `xhigh` in Claude Code. Dropping a
role to `high` or `medium` keeps Opus's judgement while cutting spend, and that is usually the better
trade than moving to Sonnet at high effort — the thing being bought from Opus is the judgement, not
the token count.

**Haiku 4.5 is not viable for any standing role here**, for a structural reason rather than a
capability one: its context window is 200K, and the cold-start orientation read every prompt
mandates — `CLAUDE.md`, `projectOverview.md`, this file, the backlog, a pillar index — consumes a
serious fraction of that before any work begins. Haiku belongs in `Explore` subagents doing fan-out
greps, which return a conclusion instead of file dumps and keep the expensive main-loop context for
reasoning. Both Review and BugFix should push their search breadth there.

**`claude-fable-5` is an escalation, not a standing assignment.** Reach for it on a specific
session — a bug that has survived two Lane A attempts, or a Review lens on a scoring pillar where the
model itself is suspect — never as a role default. Its turns run long.

The Opus/Sonnet gap is narrower than it used to be (roughly 1.7× on API list price, not 5×), so the
split above is not really about money. With six sessions able to run at once, the constraint is the
shared rate limit, and these are the two roles where spending less costs least.
