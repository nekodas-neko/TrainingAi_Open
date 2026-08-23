## 2026-08-23 — Session titles carry a status light: 🟢 live, 🔴 handed on

**Branch:** `claude/model-recommendations-ey670v` · docs-only · supersedes the marker from #352 and #354

The session title now carries two emoji with different jobs. **Leading = role**, fixed forever and
shared by every generation of that agent. **Trailing = this session's own status**, and it is the
only part that changes:

| Was | Is (live) | Is (handed on) |
|---|---|---|
| `Implementation Agent (A) 🚧` | `🚧 Implementation Agent (A) 🟢` | `🚧 Implementation Agent (A) 🔴` |
| `BugFix Intake Agent 🪲` | `🪲 BugFix Intake Agent 🟢` | `🪲 BugFix Intake Agent 🔴` |

…and the same shape for `🎶 Tuning Agent`, `📖 Review Agent`, `🪐 Orchestrator`, `🚧 Implementation
Agent (B)`.

**Neither light is set by hand.** Every prompt's first instruction is already a self-title, so a
session comes up 🟢 on its own; the handoff ritual's new last step flips it to 🔴. The owner types no
emoji in either direction, which is what stops the scheme rotting. The owner's stated workflow is a
two-pass sweep of the session list — greens are the working set, reds get archived in a batch.

**Updated:** `CLAUDE.md` (the fixed-titles rule), `docs/agents/README.md` (§4 title table, the
rename subsection rewritten as *The trailing light*, step 6 of the handoff ritual), all six
`docs/agents/prompts/*.md` (opening self-title line and closing paragraph), and the header line of
all six `docs/agents/state/*.md` batons. Baton H1s carry no light — a file is not a session. History
archives under `docs/overview/` are left as written.

**This replaces two markers shipped earlier the same day** — the ` (old)` suffix (#352) and the
`(Old) ` prefix (#354). Neither survives; the light is the only marker now.

**Recorded because it was argued and decided against advice.** The session recommended marking only
retired sessions, on the grounds that 🔴 has to be *set* to become true while an absent marker is
true for free — so a session that hits its context limit, times out, or loses its container never
runs its closing step and sits reading 🟢 while dead. The owner chose the two-state light anyway,
for a good reason: a positive signal is what you can sort a list *on*, and an absence is not. The
trade is written into `docs/agents/README.md` under *Known limit* rather than left implicit — a
green that has not moved in a day is worth checking rather than trusting. Also noted there: 🟢/🔴
differ only in hue, which is the shape `CLAUDE.md`'s colour-only-state rule warns about; it is
tolerated here because the audience is one person who chose it, not app UI.

**Verification:** `pnpm check:rules`. All six batons are at or below their `doc-size-baseline.json`
entries, so the shrink-only ratchet holds. Docs-only, no version or changelog bump.

**Not exercised:** no app code, so no runtime, device or CI-behaviour surface. The 🟢 self-title on
session creation is documented but has not been observed on a real agent session — the next agent
started from one of these prompts is the first test.
