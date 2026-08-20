# Orchestrator 🪐 — a sixth standing agent, owning the queue and the docs

**Branch:** `feat/orchestrator-agent` · **2026-08-20** · docs + one script, no app code.

## Why the role exists

Four jobs had no natural owner: clearing entries that are already done, grouping entries that could
ship together, resolving entries nobody can tell which lane owns, and reconciling docs against
reality. Every other role is measured on what it finds or ships, so queue hygiene was always
somebody's second priority — and measurement says it was nobody's:

- **17 of 211 queue entries announce their own completion in their own heading** (`✅ Q-500 —
  SHIPPED v1.320.0`, `✅ Q-207 — SHIPPED 2026-08-12`, and 15 more), against a protocol that says a
  finished item must never linger.
- **4 of 211 carry a `Batch:`** — the two seeded a day earlier.

Neither is any individual session's failure. Both are what a standing chore with no standing owner
looks like.

## What shipped

- **`docs/agents/prompts/orchestrator.md`** — cold-start prompt, four sweeps (completions,
  aggregation, lane/readiness, docs-vs-reality), one per session.
- **`docs/agents/state/orchestrator.md`** — initial baton, seeded with the concrete worklist.
- **A completed-heading ratchet** in `scripts/check-backlog-pointers.js`: a NEW queue heading
  containing ✅/SHIPPED/FIXED/RESOLVED/SUPERSEDED/DROPPED/COMPLETE/DONE fails CI. The 17 that already
  do are baselined shrink-only, so the list is Orchestrator's worklist and can only get smaller. An
  entry genuinely still owing an owner or device check opts out with `- **Keep:** <what is owed>`.
- Contract, `CLAUDE.md`, letter table (`OR-`), title list and baton index updated for six roles.

## The design decision worth recording

**Reordering the queue is the one place this role can do real damage.** Queue position is priority
and it is the owner's steering wheel, so the rules are: never move an entry inside an owner-directed
focus block or one carrying `Gate: owner`; never move down what the owner moved up; state every move
in the PR body. A silent reprioritisation is indistinguishable from a bad merge, and this repo has
had both.

Second: **it never writes application code.** The property that keeps six concurrent sessions to one
collision surface — Lane A against Lane B — is worth more than any cleanup that breaking it would buy.

Third: **its sweeps are whole-file operations**, unlike every other role's per-entry work. That is
the same shape as the journal compaction, which was done in duplicate twice (#130, #152) with one
PR's work discarded whole. The prompt and a new §5 rule both require checking the open-PR list first.

## Not exercised

No app code changed. `pnpm check:rules` 50 of 50; lint unchanged from `main`. The four ratchet
behaviours were each tested against a deliberate violation and the valid case: a new done-heading
fails, the same heading with `Keep:` passes, a baselined entry that stops matching forces the list to
shrink, and the clean tree passes. **The role itself has not run a sweep** — the baton says so.
