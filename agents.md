# Agent Rules — TrainingAI

**This file is a pointer, not a rule set.** It exists because several tools look for an
`AGENTS.md`/`agents.md` at the repo root. The rules live in two places, and both override anything
a tool infers from this file:

| What you need | Where it lives |
|---|---|
| **The engineering rules** — timezone, cache invalidation, offline sync, safe-area, migrations, git workflow, merge authority, communication | [`CLAUDE.md`](CLAUDE.md) |
| **Who does what** — the four standing agents, their authority limits, the two-lane file-ownership contract, the cold-start prompts and the handoff protocol | [`docs/agents/README.md`](docs/agents/README.md) |
| **Orientation** — current status, live Known Issues, what's left | [`projectOverview.md`](projectOverview.md) |
| **The queue** — priority-ordered work | [`docs/implementation-backlog.md`](docs/implementation-backlog.md) |

## Why this file no longer carries its own copy of the rules

It used to restate a subset of `CLAUDE.md`, and the copy drifted until it actively contradicted the
original in three places — it required confirmation before pushing or opening a PR (`CLAUDE.md`
exempts both), it described merging to `main` directly (branch protection has blocked that for
months), and it put the `projectOverview.md` update *after* the merge (`CLAUDE.md` requires it in
the same PR, so an abandoned PR cannot leave a stale "done" claim behind).

A second copy of a rule set is a second thing to keep current, and this one was not kept current.
One source of truth, pointed at from here.
