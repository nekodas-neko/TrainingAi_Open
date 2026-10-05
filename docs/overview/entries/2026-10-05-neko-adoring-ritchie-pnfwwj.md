# 2026-10-05 — Release-train restructure: spec, freeze, triage

**What:** The owner asked for a workflow that deploys less, spends fewer tokens and hands control
back to them. The answer is the release-train spec
(`docs/superpowers/specs/2026-10-05-release-train-design.md`):
- merges to `main` stop deploying, and weekly releases are tags the owner approves through the
  Orchestrator;
- GitHub Issues and milestones replace the backlog file;
- four roles replace seven, and the local agent is renamed the Implementer Agent;
- a fully automated side-by-side "TrainingAi Dev" app does the device checks;
- the bundled shell is deferred to v2.

The owner answered all ten decisions the same day.

**Phase 0, the freeze:**
- The Lane A and Lane B 4-hourly routines and the daily inbound watch are paused.
- All seven standing sessions were told to stop filing and wrap up.
- #1790 and #1762 are closed as superseded, and #1499 is held for release 1.
- #1849 merged three minutes before the owner's hold answer. It is a guarded drop, the deploy check
  passed, and no data could be lost.
- The branch sweep became a manual workflow (`branch-sweep.yml`) because a cloud session can only
  push its own branch: 46 deletes and 3 archive-then-deletes.

**Phase 1, the triage:** 524 entries got verdicts using the repo's own parser and `next-item.js`
bucketing, and the counts match that tool. That gives about 245 issues: 194 work items, 38 owner
questions and 12 device-check groups. See `docs/superpowers/specs/2026-10-05-backlog-triage.md` and
its CSV.

**Evidence recorded:** the platform's usage figures put the five live cloud standing sessions at
about $45k API-equivalent, at 430k–780k tokens of context each. That is the case for short sessions.

**Not done:** Phases 2–5. Nothing in the pipeline itself has changed: merges still deploy, and the
backlog file is still the queue until Phase 3. No device or production surface was touched by this
PR.
