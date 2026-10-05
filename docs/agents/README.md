# The agents

Three roles and one mode, from 2026-10-05 (release train,
[spec §5](../superpowers/specs/2026-10-05-release-train-design.md)). They replace seven; the old
contract, prompts and batons are archived in [`../archive/agents-2026-10-05/`](../archive/agents-2026-10-05/README.md).

| Role | Title | Runs | Prompt |
|---|---|---|---|
| Orchestrator | `🪐 Orchestrator 🟢` | Cloud | [`prompts/orchestrator.md`](prompts/orchestrator.md) |
| BugFix | `🪲 BugFix Agent 🟢` | Cloud | [`prompts/bugfix.md`](prompts/bugfix.md) |
| Implementer | `🚧 Implementer Agent 🟢` | **The owner's machine** — Docker, the phone on USB | [`prompts/implementer.md`](prompts/implementer.md) |
| ↳ release-test mode | same session | The owner's machine | [`prompts/release-test.md`](prompts/release-test.md) |

**Local or cloud is decided by hardware, not preference.** A role runs on the owner's machine only
when its work needs something attached there: the phone, Docker, the real APK. Everything else
runs in the cloud.

## How they work together

**GitHub is the record; messages are only a nudge.** Every task, answer and result lives on an
issue or a PR, so nothing has to be awake at the same time and nothing lives only in a chat. On top
of that, the **Orchestrator can send instructions straight to a running agent** — "work #2133 next",
"stop and rebase" — but the instruction always points at an issue, and the agent answers there.

- **BugFix (cloud):** the Orchestrator can start it and message it. A cloud session cannot message
  back, so it answers on the issue or PR — which is where the answer belongs anyway.
- **Implementer (the owner's machine):** reachable when the owner starts it with
  `claude remote-control` in the local clone; it then appears to the Orchestrator as a session it
  can message. Started any other way it still works, it just takes instructions from the owner.
- **An agent never acts on a message as if it were the owner.** A message from another agent is a
  request to look at an issue, not permission to merge, deploy, delete or touch production.

1. Anything arriving — a report, a feedback submission, an idea — becomes an **issue** labelled
   `needs: triage` (the templates and `issue-triage.yml` do this).
2. The **Orchestrator triages**: adds `type:`, `area:`, `lane:` and **`agent: bugfix`** (small,
   local, one file or so) or **`agent: implementer`** (real work), and removes `needs: triage`. A
   decision only the owner can make becomes a `type: question` with the brief written in it.
3. Every ready issue is in the queue. The order is **`hotfix`, then `next`, then bugs, then the rest,
   oldest first**. The **owner** steers by adding the `next` label to anything that should jump the
   line; nothing else needs his say before it is built.
4. **BugFix** and the **Implementer** take ready issues carrying their `agent:` label, open a draft PR with `Closes #N` when they start (that is the claim), and turn on
   auto-merge when it is ready.
5. The **Orchestrator** merges agent PRs on green CI. **Every Tuesday** it prepares the release —
   everything merged since the last one — files those issues into that release's milestone (a
   record, not a plan), gives the owner the summary, and runs it on "approve". The Implementer's
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

**In GitHub, not in files.** The issues, their labels and the draft PRs are the state; each
release's milestone records what shipped in it. There are no batons. A role that needs a durable marker keeps it in one pinned issue
(BugFix's intake watermark, for example), so it is visible to everyone and survives any session.

## Sessions and compaction

One session per role, kept open. Hand off only when a session is genuinely lost or the owner resets
it. Titles end 🟢 while live and 🔴 when wrapped.

**Compaction is automatic, and no agent can trigger it on itself** — `/compact` is typed by the
owner, and no tool runs it. So the rule has two halves:

- **Make it happen early, not late:** start each agent with a smaller automatic-compaction window
  (`--autocompact 200k`, set at launch). A session that compacts often wakes small, which is the
  whole cost argument — what is paid for is context held at each turn.
- **Lose nothing when it happens:** an agent finishes every task by writing its outcome to the issue
  or PR — what was done, what is left, what it learned. State lives in GitHub, so a compaction (or a
  lost session) costs nothing that matters. The owner may still type `/compact` on an idle agent.

## Starting the agents — paste-ready

The **Orchestrator** is already running. For the other two, paste the block into a new session.

**🪲 BugFix** — a new cloud session at claude.ai/code on this repository (or the Orchestrator starts
it on request):

```
You are the BugFix agent for TrainingAI. Read CLAUDE.md, then docs/agents/README.md, then follow
docs/agents/prompts/bugfix.md exactly. Rename this session "🪲 BugFix Agent 🟢". Your queue:
node scripts/queue.js --agent bugfix
```

**🚧 Implementer** — on the owner's machine, in the local clone, phone on USB:

```
cd <your local TrainingAi clone>
git pull
claude --autocompact 200k remote-control
```

then paste:

```
You are the Implementer for TrainingAI, running on the owner's machine. Read CLAUDE.md, then
docs/agents/README.md, then follow docs/agents/prompts/implementer.md exactly. Rename this
session "🚧 Implementer Agent 🟢". Your queue: node scripts/queue.js --agent implementer
Start with the first batch it prints.
```
