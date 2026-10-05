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
| 🚧 **Implementer** | **The owner's machine** — Docker, the phone on USB | Any number; two split by `lane:` | [`prompts/implementer.md`](prompts/implementer.md) |
| ↳ release-test mode | The owner's machine | One, on Tuesdays | [`prompts/release-test.md`](prompts/release-test.md) |

**Where a role runs is decided by hardware.** Anything needing the phone, Docker or the real APK runs
on the owner's machine; everything else may run in the cloud.

## Running several at once

- **Every job is claimed before work starts** — the session adds the `in progress` label to the
  issues it takes, and every other session (and `scripts/queue.js`) skips claimed work. A session
  that stops without a PR removes its label.
- **Two Implementers split by lane:** `node scripts/agent-runner.mjs --lane engine` in one terminal and
  `--lane surface` in another. Engine is storage, API, migrations and native; surface is screens and
  components — they do not edit the same files.
- **Migrations are never parallel:** a migration is always its own batch, and only one is in flight
  at a time.

## What the Orchestrator can do from the cloud

| | |
|---|---|
| **Run the app** | Yes — the web build: `pnpm dev` on a local database, driven with the installed browser, to reproduce a report or check a PR. **Not the phone**; that is the Implementer's. |
| **Read issues, triage, batch** | Yes — every issue, label and milestone. |
| **Assign work** | Yes — `agent:` labels, and `Batch: …` milestones the Implementer runners pick up. |
| **Start agents** | BugFix in the cloud, yes. On the owner's machine, no — the owner starts the runner once and it keeps going. |
| **Message running agents** | Yes, any started with `--remote-control` (`ListAgents`, `SendMessage`). |
| **Read what agents did** | Yes — every agent writes its result on the issue and the PR. Headless runner sessions report there too; their local logs stay on the owner's machine. |
| **Merge, release** | Merges agent PRs on green CI; runs the release on the owner's "approve". |

## How they work together

**GitHub is the record; messages are only a nudge.** Every task, answer and result lives on an
issue or a PR, so nothing has to be awake at the same time and nothing lives only in a chat. On top
of that, the **Orchestrator can send instructions straight to a running agent** — "work #2133 next",
"stop and rebase" — but the instruction always points at an issue, and the agent answers there.

- **BugFix (cloud):** the Orchestrator can start it and message it. A cloud session cannot message
  back, so it answers on the issue or PR — which is where the answer belongs anyway.
- **Implementer (the owner's machine):** reachable when the owner starts it with
  `claude --remote-control` in the local clone; it then appears to the Orchestrator as a session it
  can message. Started any other way it still works, it just takes instructions from the owner.
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

**🚧 Implementer** — on the owner's machine, in the local clone, phone on USB. Two ways:

*Automatic, one fresh session per batch (recommended):*

```
cd <your local TrainingAi clone>
git pull
node scripts/agent-runner.mjs
```

It builds each batch as it appears and waits when there is none (Ctrl+C stops it; `--once` does one
batch and exits). Logs land in `.agent-runs/`. **Once per machine first:** open `claude` interactively
in that folder and accept the "trust this folder" prompt, or the headless sessions ignore the
project's settings.

*By hand, when you want to watch or steer it:*

```
cd <your local TrainingAi clone>
git pull
claude --autocompact 200k --remote-control
```

then paste:

```
You are the Implementer for TrainingAI, running on the owner's machine. Read CLAUDE.md, then
docs/agents/README.md, then follow docs/agents/prompts/implementer.md exactly. Rename this
session "🚧 Implementer Agent 🟢". Your next batch: node scripts/queue.js --next-batch
```

`--remote-control` makes it a session the Orchestrator can send instructions to.
