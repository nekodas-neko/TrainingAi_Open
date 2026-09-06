# 2026-09-06 — the whole-app checkpoint: twenty-six lanes, ~45 verified findings, two escalations

**Agent:** 📖 Review, running `docs/agents/prompts/checkpoint.md` as a one-off at the owner's
request · **Branch:** `claude/app-checkpoint` · Docs only · IDs `PS-24…PS-39`.

The full collation is
[`docs/reviews/2026-09-05-app-checkpoint.md`](../../reviews/2026-09-05-app-checkpoint.md). The
shape of the run: lanes fanned out to read-only subagents where the session's rate limit allowed
and were run by the coordinator directly where it did not; **every finding was re-verified by the
coordinator before filing** — three lane claims died on that re-check (a "missing `clients.claim()`"
that exists at `sw-template.js:32`, a palette claim behind an unreachable branch, and a
sync-health 500 the coordinator's own concurrent build had caused).

**Escalated:** deactivation and admin revocation never reach a live session — LA-58's same-day fix
reads a claim that is never refreshed (PS-24, its Known-Issues row reopened); and the login rate
limiter keys on the untrimmed email, so whitespace padding buys unlimited attempts (PS-25).

**Live on the owner's data:** the strength card renders 16 of 34 exercises as full-1RM crashes
(deload zeros, PS-26); `oura_daily` recorded the ring worn ≤1.5 h on 20 consecutive scored nights
(PS-30).

**The two big patterns:** *a guard that exists is not a guard that reaches* — PROSE_GUARDS at 5 of
9 routes, the body-fat check skipping `components/`, health-insight's gate defeated by its own
unconditional line, and six custom rules that fire on the textbook violation and miss the common
shape (PS-34); and *one formula, several homes* — ACWR banded at 28 days on the card but raw at 56
in the chat tool, three WHO zone mappings, two hardcoded 2500 ml water goals (PS-28/36/37).

**Clean, and worth having in writing:** the full tz-shifted test suite green in the midnight hazard
band; the coach's preview/apply pair (replay refused 409 with drift — closes the baton's
`/api/coach/preview` item); the workout/device FK half (the one client-writable CASCADE edge
refuses cross-user); zero bare prefix-sibling cache keys; export coverage 94/94 accounted;
`Ran 68 of 68`; ownership clean everywhere probed. Lane 23 (screenshot crawl) was NOT swept and is
recorded as not established, not clean.
