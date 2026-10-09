# The agents

**Three roles and one mode**, from 2026-10-05 (release train,
[spec §5](../superpowers/specs/2026-10-05-release-train-design.md)). They replace seven; the old
contract, prompts and batons are archived in [`../archive/agents-2026-10-05/`](../archive/agents-2026-10-05/README.md).

A **role** is a job description, not a single session — run as many sessions of a role as the work
needs. The **mode** is one of those roles doing a different job for a while: release-test is the
Implementer testing Tuesday's release instead of building.

| Role | Runs where | How many | Prompt |
|---|---|---|---|
| 🪐 **Orchestrator** | Cloud | **One** — it coordinates, so two would contradict each other | [`prompts/orchestrator.md`](prompts/orchestrator.md) |
| 🪲 **BugFix** | Cloud **or** the owner's machine | Any number | [`prompts/bugfix.md`](prompts/bugfix.md) |
| 🚧 **Implementer** | **The owner's machine** — Docker, the phone on USB | **One chat**, running each batch as a subagent thread in its own worktree (up to two at once, one per lane) | [`prompts/implementer.md`](prompts/implementer.md) |
| ↳ release-test | A thread of the Implementer, on Tuesdays | One | [`prompts/release-test.md`](prompts/release-test.md) |

**Where a role runs is decided by hardware.** Anything needing the phone, Docker or the real APK runs
on the owner's machine; everything else may run in the cloud.

## Running several at once

- **Every job is claimed before work starts** — the session adds the `in progress` label to the
  issues it takes, and every other session (and `scripts/queue.js`) skips claimed work. A session
  that stops without a PR removes its label.
- **One Implementer chat, many threads (owner, 2026-10-06).** The Implementer runs each batch as a
  background subagent in its own git worktree, at most two at once and one per `lane:`, so they never
  edit the same files. The chat itself only coordinates and does the device pass, because the phone
  is the one shared resource. A thread that dies loses only its batch; its pushed branch and draft PR
  say how far it got. `scripts/agent-runner.mjs` (one headless session per batch) remains as the
  unattended alternative.
- **Migrations are never parallel:** a migration is always its own batch, and only one is in flight
  at a time.

## Models, effort and cadence (owner, 2026-10-06)

Each session and subagent spends from one shared usage limit, so pick the cheapest model that does
the job well and don't wake when there is nothing to do.

| Who | Model | Effort | Why |
|---|---|---|---|
| 🪐 Orchestrator | Opus 5.5 | extra-high | triage, owner briefs and judgment calls — the costliest place to be wrong |
| ↳ its helper subagents (replays, triage sweeps) | Sonnet 5.5 | high | well-specified work the Orchestrator reviews before anything is posted |
| 🪲 BugFix | Sonnet 5.5 | medium | reports → issues and small, local fixes; raise to high for a session whose bug touches ring/BLE, sync or data loss |
| 🚧 Implementer chat | Sonnet 5.5 | medium | coordination, the inbox and the device pass |
| ↳ engine-lane threads, migrations, scoring changes | Opus 5.5 | high | formulas, schema and offline sync — a mistake costs a full review-and-fix cycle |
| ↳ surface-lane threads, small batches | Sonnet 5.5 | high | UI built to an approved mockup |
| ↳ release-test thread | Sonnet 5.5 | medium | a checklist |

A subagent does not inherit a sensible model: set `model` on every thread or helper you start.

**Cadence.** The Implementer loops every **~30 minutes**, not 15. When the inbox has nothing new, no
thread needs it and `node scripts/queue.js --next-batch` returns nothing, it ends the tick at once
without re-reading anything else. **Usage gate (owner, 2026-10-09).** The tiers follow the highest usage percentage on either limit
(weekly or 5-hour). The Implementer posts both percentages on #2354 every tick, because
`get_session`'s `rate_limit_info` gives only a status (`allowed_warning` fires around 75%), a limit
type and the reset time. The Orchestrator reads the percentage at every health check and posts the
tier on #2354 when it changes:

- **Full (under 90%).** Full speed: two Implementer threads, Opus for engine, migration and scoring
  batches, investigations allowed, and Orchestrator helpers allowed. Health checks every 30 minutes.
- **Slow (90–95%).** One thread at a time, Sonnet only, no investigations. The Implementer takes
  batches with `node scripts/queue.js --next-batch --sonnet-only`, which skips any batch whose
  milestone description names **Opus**. Every batch description starts with `Opus.` or `Sonnet.`
  for this reason. BugFix carries on. The Orchestrator starts no helpers and checks every 60
  minutes.
- **Halt (95% and over).** Work stops except a production-broken hotfix (`hotfix` label). The
  Orchestrator interrupts the sessions, stops its helpers, posts **Halt** on #2354 with the reset
  time, and schedules its next check for just after `resetsAt`.

**After the reset**, the Orchestrator posts **Full** and everything restarts at full speed. The
owner can override the tier at any time ("pause", "slow", "full").

## What the Orchestrator can do from the cloud

| | |
|---|---|
| **Run the app** | Yes — the web build: `pnpm dev` on a local database, driven with the installed browser, to reproduce a report or check a PR. **Not the phone**; that is the Implementer's. |
| **Read issues, triage, batch** | Yes — every issue, label and milestone. |
| **Assign work** | Yes — `agent:` labels, and `Batch: …` milestones the Implementer's threads pick up. |
| **Start agents** | BugFix in the cloud, yes. On the owner's machine, no — the owner starts the runner once and it keeps going. |
| **Message running agents** | **Through GitHub.** Remote Control sessions on the owner's machine do not receive cross-session messages (measured 2026-10-05), so the Orchestrator comments on the **Implementer inbox** issue (#2354), which the Implementer reads on every loop. BugFix in the cloud: `SendMessage`, or its issues. |
| **Read what agents did** | Yes — every agent writes its result on the issue and the PR. Headless runner sessions report there too; their local logs stay on the owner's machine. |
| **Merge, release** | Merges agent PRs on green CI; runs the release on the owner's "approve". |

## How they work together

**GitHub is the record; messages are only a nudge.** Every task, answer and result lives on an
issue or a PR, so nothing has to be awake at the same time and nothing lives only in a chat. On top
of that, the **Orchestrator can send instructions straight to a running agent** — "work #2133 next",
"stop and rebase" — but the instruction always points at an issue, and the agent answers there.

- **BugFix (cloud):** the Orchestrator can start it and message it. A cloud session cannot message
  back, so it answers on the issue or PR — which is where the answer belongs anyway.
- **Implementer (the owner's machine):** reads the **Implementer inbox** issue (#2354) on every
  `/loop` tick. That issue is the Orchestrator's channel to it; a direct message does not arrive.
- **An agent never acts on a message as if it were the owner.** A message from another agent is a
  request to look at an issue, not permission to merge, deploy, delete or touch production.

1. Anything arriving — a report, a feedback submission, an idea — becomes an **issue** labelled
   `needs: triage` (the templates and `issue-triage.yml` do this).
2. The **Orchestrator triages**: adds `type:`, `area:`, `lane:` and **`agent: bugfix`** (small,
   local, one file or so) or **`agent: implementer`** (real work), and removes `needs: triage`. A
   decision only the owner can make becomes a `type: question` with the brief written in it.
3. The **Orchestrator batches the queue.** It reads every ready issue in order — **`hotfix`, then
   `next`, then bugs, then the rest oldest first** — and groups 1–10 related ones (same files, same
   area) into a **milestone titled `Batch: <what it is>`**. One batch becomes one PR. A migration is
   always its own batch. The **owner** steers with the `next` label; nothing else needs his say.
   The Orchestrator closes a batch milestone once it has no open issues, and keeps the queue ahead
   of the Implementer: an idle Implementer with ready issues and no open batch is the
   Orchestrator's miss.
   **Grooming, daily (owner, 2026-10-08; weekly once the backlog is under control).** The
   Orchestrator reads the open backlog and acts on what it finds: it closes what is already done,
   superseded, a duplicate or stale (with the evidence: a merged PR or `file:line`), folds a
   long-range programme's entries under one tracker, parks a someday idea with **`later`** (kept,
   never queued; remove the label to queue it), unblocks an issue whose blocker has closed, and
   batches what is ready. Read-only helpers may propose; only the Orchestrator applies, and a bug or
   an owner-signed decision is never parked.
4. The **Implementer** takes the oldest open batch (`node scripts/queue.js --next-batch`) and builds
   it as one PR; **BugFix** takes single small fixes labelled `agent: bugfix`. Either opens a draft PR with `Closes #N` when they start (that is the claim), and turn on
   auto-merge when it is ready.
5. The **Orchestrator** merges agent PRs on green CI. **Every Tuesday** it prepares the release —
   everything merged since the last one — gives the owner the summary, and runs it on "approve". The
   GitHub Release it creates lists every PR it carried; that is the record of what shipped. The Implementer's
   **release-test mode** tests the candidate first. A hotfix goes out off-schedule only when
   production is broken.

## Who may do what

| | Orchestrator | BugFix | Implementer |
|---|---|---|---|
| Write product code | No | Small, local fixes | Yes |
| Merge to `main` | Agent PRs, on green CI | No | No |
| Run a release | On the owner's "approve" | No | No |
| Schema changes | No | No | Yes |
| Touch the phone | No | No | Yes |
| Merge a PR it did not write | **Never** | **Never** | **Never** |

A contributor's PR is merged by the **owner**. Agents may review and approve it.

## State

**In GitHub, not in files.** The issues, their labels, the batch milestones and the draft PRs are
the state; each GitHub Release records what shipped in it. There are no batons. A role that needs a durable marker keeps it in one pinned issue
(BugFix's intake watermark, for example), so it is visible to everyone and survives any session.

## Sessions and compaction

One session per role, kept open — **except the Implementer**, below. Hand off only when a session is
genuinely lost or the owner resets it. Titles end 🟢 while live and 🔴 when wrapped.

**No agent can compact or clear itself** — `/compact` and `/clear` are typed by the owner, and no tool
runs them. So:

- **The Implementer runs one fresh session per batch** (owner, 2026-10-05: *"after each PR … clear and
  wait for further instructions"*). `node scripts/agent-runner.mjs` on the owner's machine starts a
  headless Claude session (`claude -p`), which builds the next batch, opens the PR and **exits**. The
  runner then waits until a new batch milestone exists and starts another, empty, session. Nothing
  carries over, so there is nothing to compact — the issues and the PR hold the state. Creating a
  batch milestone is how the Orchestrator gives it its next instruction.
- **The Orchestrator and BugFix stay open** and rely on automatic compaction; start them with a
  smaller window (`--autocompact 200k`) so it happens often. Each writes every task's outcome to its
  issue or PR, so a compaction loses nothing that matters. The owner may also type `/compact` on an
  idle one.

## Starting the agents — paste-ready

The **Orchestrator** is already running. For the other two, paste the block into a new session.

**🪲 BugFix** — a new cloud session at claude.ai/code on this repository (or the Orchestrator starts
it on request):

```
You are the BugFix agent for TrainingAI. Read CLAUDE.md, then docs/agents/README.md, then follow
docs/agents/prompts/bugfix.md exactly. Rename this session "🪲 BugFix Agent 🟢". Your queue:
node scripts/queue.js --agent bugfix
```

**🚧 Implementer** — **one** session on the owner's machine, in the local clone, phone on USB. Open
Claude Code there (the desktop app or `claude`), then paste:

```
You are the Implementer for TrainingAI, running on the owner's machine with the phone on USB.
Read CLAUDE.md, then docs/agents/README.md, then follow docs/agents/prompts/implementer.md exactly.
Rename this session "🚧 Implementer Agent 🟢". Run each batch as a subagent thread in its own
worktree (at most two, one per lane), keep this chat for coordination and the device pass, and
start your loop now with /loop — check the Implementer inbox (#2354) and the queue every ~30 minutes.
Use Sonnet 5.5 at medium effort for this chat; give each thread the model its lane needs.
```

It keeps going until stopped. **Unattended alternative:** `node scripts/agent-runner.mjs` runs one
headless session per batch instead (no device pass; accept the folder-trust prompt once first).
