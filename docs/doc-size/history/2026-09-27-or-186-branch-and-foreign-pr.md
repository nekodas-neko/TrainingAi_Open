# 2026-09-27 — `CLAUDE.md` 1059 → 1060

**Branch:** `chore/or-186-branch-and-foreign-pr-rules`

One line: **never merge a pull request we did not author.** It sits in Safety & Reversibility beside
the production-DB policy because it is the same kind of rule — a hard stop on an action the rest of
the file otherwise authorises, since "merge a tested, CI-green PR without asking" reads as blanket
permission until something says it covers our own PRs only.

The branch-naming change in the same PR cost no lines; it rewrote an existing bullet.
