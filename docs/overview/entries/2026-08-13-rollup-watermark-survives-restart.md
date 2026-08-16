# 2026-08-13 — the rollup watermark survives a restart (Q-213 follow-up, v1.303.2)

**Branch:** `perf/rollup-watermark-survives-restart`

## What went wrong with Stage 1

Stage 1 (#1297) narrowed `aggregateOuraRawSamples` to the span an ingest touched, which is right. But
it tracked that span in **process memory**, with a `fullWindowDone` set forcing the first run in each
process to re-derive the whole 35-day window — on the reasoning that a fresh process cannot know what
an earlier one left un-rolled.

The reasoning was right. The remedy was too expensive, and I under-weighted it: the PR called it "one
slow pass per deploy… expected, not a regression."

**Measured in production the same afternoon, it was six minutes of a pegged main thread** — CPU 1.504
→ 1.017 → 1.46 → 1.808, memory to 2.19 GB, 14:45–14:50 Brisbane, with `/api/version` taking 10–28
seconds throughout. The owner reported "loading is still really slow across pages" while it ran, and
their screenshots show empty cards on Health and Nutrition.

Five deploys went out on 2026-08-13. The owner paid that cost five times, and the last one was
triggered by a **docs-only** PR of mine.

## The fix

`oura_rollup_state` (migration 184) stores the watermark per user, so a cold start narrows from where
the last successful run reached instead of re-deriving everything. `fullWindowDone` is gone, and the
comment where it stood says not to reintroduce a process-local equivalent.

Two details that are not incidental:

- **The watermark stores the clock `epoch`, not a timestamp.** `ring_timestamp_ds` restarts on a ring
  re-key, so a counter from a previous epoch is not comparable to the current one.
  `getOuraRollupWatermark` returns null on an epoch mismatch and the caller falls back to the full
  window — correct-but-slow beats fast-but-wrong. My first draft compared `anchorUtc` for this, which
  would have been silently useless: a new anchor is minted on every drain, so it would never have
  matched and the watermark would never have applied.
- **The watermark never moves backwards** (`setWhere` on `last_rolled_ds <`), because runs can finish
  out of order — a slow full-history redecode landing after a quick incremental one would otherwise
  regress it. A new epoch is the one case that must overwrite regardless, since its counter restarts
  lower.

`dumpOnly` debug passes do not advance it (they write nothing).

## Verified

Seven DB-backed tests in the `rollup` vitest project, three of them new:

- records a watermark so a cold start does not have to re-derive the window
- narrows from the persisted watermark when the caller passes no `sinceDs`
- ignores a watermark from a previous clock epoch rather than narrowing against it

**The two new narrowing tests use a discriminator, because the obvious assertion proves nothing.**
"Nothing was destroyed" passes whether the run narrowed or re-derived everything. So the test deletes
the older night's HR rows by hand first: a narrowed run cannot see that night's raw rows and leaves
the hole, while a full-window run refills it. The epoch test asserts the opposite direction of the
same discriminator.

**Mutation-tested, both guarantees:**

| Mutation | Result |
|---|---|
| ignore the persisted watermark | "narrows from the persisted watermark" fails |
| trust a watermark from any epoch | "ignores a watermark from a previous clock epoch" fails |

Full suite green — 460 files, 3,790 tests. `tsc --noEmit` clean, all 20 custom-rule checks pass,
migration numbering clean (next free: 186).

## A trap this hit on the way through

`claude-ro-readonly-role.test.ts` pins itself to a specific `claude_ro` views migration and rebuilds
the schema from it. It was pinned to **181** while 183 and 185 existed. That stayed invisible because
183 only added *columns* — the coverage assertion counts tables, so nothing broke until this change
added a table. Repointed to 185, with a note that a green suite does not prove the pin is current,
only that no table has been added since.

Also worth recording: `scripts/local-db/migrate.js` marked migration 185 as applied on a run where a
statement inside it errored, leaving the local schema one view short and the failure attributed to my
change rather than to the partial apply. Proving the migration correct meant re-applying it from a
dropped schema by hand (80 views, as generated). That is the "assume partial application" hazard
`CLAUDE.md` describes for *local SQLite*, showing up on the Postgres side.

## Not exercised

- **The S25 and the real ring.** The BLE plugin does not run in the sandbox.
- **Production data.** Tests run against a seeded table ~40× smaller than production's 986,410 rows.
- **The cold-start path in production** is what this fixes, so the proof is the *next* deploy: the
  6-minute plateau at container start should not recur. That is the single thing to check.
- Server-side only — reaches the device through Railway with no APK rebuild.
