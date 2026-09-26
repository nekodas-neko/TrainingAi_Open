# 2026-09-26 — `docs/agents/state/implementation-lane-a.md` 184 → 141

**Branch:** `refactor/la151-acwr-median`

A ratchet-DOWN, not a raise. The baton was rewritten in full and came out 43 lines under its
baseline — past the 25-line band, which is the ratchet correctly pointing out that the document
could regrow into that slack unnoticed.

**What came out, and why it was safe to cut:**

- **A merged PR carried as live state.** The file said PR #1098 was open and owner-gated, "keep it
  rebased, never merge it". It merged on **2026-09-20**, six days before this rewrite. Nobody was
  rebasing a merged branch, but the next session would have spent its first minutes on it. The
  replacement is a rule rather than a number: re-derive open PRs from the API.
- **Two long incident narratives** (the `#1098` conflict-resolution ritual, an earlier session's
  four-entry table) compressed to the reusable form. The arithmetic is in git; the lesson is what a
  baton is for.
- **A required-checks list that was wrong in both directions.** It said Build is not enforced;
  `merge_pull_request` refused #1721 on Build in progress. Measured and replaced.

The size-ratchet's own instruction is followed here: the number moved in the same PR as the edit,
with the reason in its own file, because the arithmetic is recoverable from git and this is not.
