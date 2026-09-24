# 2026-09-24 — Review sweep 59: the queue re-read against code, and the deploy failure reproduced

**Branch:** `review/sweep-59-queue-vs-code` · **Agent:** Review · **Docs only.**

- **Queue re-read.** 59 READY entries in Lanes A and B were checked against `main`:
  - 5 are already shipped (LB-123, LB-114, Q-272, Q-3b, Q-112);
  - 2 are wrong as written;
  - 7 are not startable;
  - 4 are partly done;
  - 17 have moved lines or a missing step.

  Each has a dated note. RV-189 asks the Orchestrator to remove, park and reroute. TN-10 and Q-507
  gained `Needs:` fields.
- **Production is 22 merges behind** (1.465.26 live, 1.465.31 on `main`), because the Railway build
  runs out of heap (DV-14). Reproduced locally with a 3 GB cap:
  - the changelog is **not** the driver (cut to 9.8 KB, still fails);
  - source maps make no difference;
  - removing the Sentry wrapper lets the compile pass.

  **RV-188 heads Lane A**: raise the heap in the build script now, then trim Sentry's build hooks
  and stop Railway re-running lint and type-check.
- OR-138 gained a security note: a `set_config` pivot through the admin query route, inferred from
  source and deliberately not probed.

Write-up: `docs/reviews/2026-09-24-sweep-59-queue-against-code.md`. No product code and no
production writes. The build experiments ran on local scratch copies only, and the two temporary
edits were restored before the worktree was removed.
