# 2026-08-23 — Q-324 closed on evidence, which is what it asked for

**Branch:** `docs/q324-evidence` · **Lane A** · **closes Q-324**, docs-only

Q-324 was filed for two test files timing out on the **first** suite run against a database where
`migrate.js` had recorded nothing: every vitest worker's `ensureSchema` re-applied all ~200
migrations concurrently, saturating the shared instance until a `beforeAll` that only opens a pool
blew its 10 s hook timeout.

Its recommended fix — make `migrate.js` record what it applied — shipped 2026-08-19. The entry then
sat open with an explicit bar: *"Keep the entry until it is seen again with this ruled out, or stays
absent long enough to close on evidence."*

## The mechanism is gone by construction, not merely unobserved

Verified on a database created for this, rather than argued:

```
createdb q324 && node scripts/local-db/migrate.js   → applied 206, 0 failed
SELECT count(*) FROM schema_migrations              → 206
a worker's ensureSchema against that DB             → applied 0, skipped 206 already recorded
```

Every worker skips all 206, so the concurrent re-application the entry describes cannot occur.

## The evidence that actually counts is CI's, not a session's

**The entry says so itself:** *"running `pnpm test` locally cannot reproduce it"* — a session's
`trainingai_dev` is warm, while **CI creates a fresh `postgres:16` for every run, so CI is always in
the first-run state.** So a local green run is supporting evidence at best, and I nearly recorded it
as the main result.

The 30 most recent `CI` runs on `pull_request`, 2026-08-20 → 2026-08-23, all post-fix:

| | |
|---|---|
| success | **29** |
| non-success | **1** — `cancelled`, the concurrency group superseding a run, not a failure |

Thirty consecutive fresh-database runs in exactly the state that used to fire it, with no `Tests`
failure. Before the fix it fired often enough to redden #195 and cost a diagnosis.

Supporting, from this session: a fresh migrated database, first suite run — **542 files, 4,468 tests,
0 failed, 174 s**, no timeout. (Predecessor's equivalent on 2026-08-19: 516 files green.)

## Closed, with the one thing worth preserving

It was a **race**, and races can hide. The entry is closed because its own bar was evidence and the
causal chain is verifiably removed — not because 30 runs prove a negative.

**If those two files time out again on a fresh CI database, the migration-recording fix is ruled out
and it is something else.** That is the sentence Q-324 existed to leave behind, and it is why the
entry is closed with reasoning rather than deleted.

## Not exercised

Docs-only; no code changed. No route, schema, or device surface.
