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

**Through GitHub, never by messaging each other.** Nothing has to be awake at the same time, and
nothing lives only in a chat.

1. Anything arriving — a report, a feedback submission, an idea — becomes an **issue** labelled
   `needs: triage` (the templates and `issue-triage.yml` do this).
2. The **Orchestrator triages**: adds `type:`, `area:`, `lane:` and **`agent: bugfix`** (small,
   local, one file or so) or **`agent: implementer`** (real work), and removes `needs: triage`. A
   decision only the owner can make becomes a `type: question` with the brief written in it.
3. The **owner** puts issues into the open milestone. That is the plan; nothing outside it is built.
   BugFix's small fixes are the one exception.
4. **BugFix** and the **Implementer** take issues carrying their `agent:` label from the open
   milestone, open a draft PR with `Closes #N` when they start (that is the claim), and turn on
   auto-merge when it is ready.
5. The **Orchestrator** merges agent PRs on green CI, prepares the release, gives the owner the
   summary, and runs the release on "approve". The Implementer's **release-test mode** tests the
   candidate first.

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

**In GitHub, not in files.** The open milestone, the issues, their labels and the draft PRs are
the state. There are no batons. A role that needs a durable marker keeps it in one pinned issue
(BugFix's intake watermark, for example), so it is visible to everyone and survives any session.

## Sessions

One session per role, kept open. Compaction bounds its context; **compact before going idle**, not
when full, so a session woken later starts small. Hand off only when a session is genuinely lost
or the owner resets it. Titles end 🟢 while live and 🔴 when wrapped.
