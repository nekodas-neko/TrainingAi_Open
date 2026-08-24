# 2026-08-24 — Review session closed: sweep 40's findings all shipped, and the row archived

**Branch:** `claude/review-agent-50s6e7` · **Agent:** 📖 Review · **Docs-only.**

Closes the Review run that produced **sweep 40** (PR #271, merged `4073fe8` on 2026-08-20). No new
sweep ran in this session — it is the wrap-up.

## What this session did

- **Re-verified sweep 40's three findings in source rather than trusting the closure note.** All of
  RV-32, RV-33 and RV-34 are fixed on `main`: `progressionStyleIdsOwned` guards all three write paths
  (`phase-sets/route.ts:47`, `workout-templates/route.ts:70`, `log-exercise.ts:258`), both refusal
  routes run inside `withRouteErrors`, and the join at `programs.ts:457` is scoped to the caller so a
  pre-guard row reads blank instead of another user's words.
- **Moved the RV-32…RV-34 Known-Issues row whole** into
  [`known-issues-resolved.md`](../known-issues-resolved.md). Nothing was owed on it — the 23 unprobed FK
  edges it mentions are a future lens carried in the baton, not an outstanding obligation of these
  fixes. That also gives `projectOverview.md` back 33 lines, which #373 had gone looking for and not
  found.
- **Wrote the handoff**,
  [`docs/handoff-2026-08-24-workouts-review-sweep-40-write-surface.md`](../../handoff-2026-08-24-workouts-review-sweep-40-write-surface.md),
  with the pickup prompt under its own heading.
- **Updated the baton** — the title convention now records the 🟢/🔴 trailing light introduced on
  2026-08-23, and its `Now` section says the successor is awaiting instructions rather than picking a
  lens.

## The gotcha worth carrying

`get_check_runs` returning `total_count: 0` has a **third** cause and `CLAUDE.md` names only one. It
names a stale base; the field to read is **`mergeable_state`**. `dirty` means a merge conflict, and
GitHub runs no PR checks at all while it cannot compute the merge commit — indistinguishable from CI
that never fired. It cost fifteen minutes on PR #271 with a base that was provably current. Recorded
in the baton's method notes.

## Not exercised

Docs only. The fix verification was a source read against `main` plus the existing merged tests — the
routes were **not** re-driven live in this session, and nothing device, native or production was
touched.
