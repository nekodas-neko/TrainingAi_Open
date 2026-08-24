# 2026-08-24 — removed the dead `running_baselines` write/read path (Q-301)

**Branch:** `claude/implementation-lane-a-setup-p3f5zk` · **Lane A** · no migration (table drop
deferred to owner), no APK.

`running_baselines` held exactly what a run prescription should rest on (vo2max, max HR, resting
HR, threshold HR, weekly base minutes, easy pace) and had zero rows in production. The entry's own
investigation order determined which of "wire the reader" or "delete the dead code" was right
before touching anything.

## What the investigation found

1. **What the 12 real `prescribed_runs` actually derive from:** `resolveSnapshot()`
   (`packages/shared/src/running/assemble-plan-context.ts`), called fresh on every request from
   `fitness_tests` and `body_metrics` — live data, strictly better than a stale plan-creation-time
   snapshot would have been. Sensible inputs by another route confirmed: this is dead code, not a
   broken feature.
2. **Why the table was empty:** the one `running_plans` row was created 2026-07-21; migration 146
   (which added the writer) landed after that. No plan has been created since — not a silent write
   failure, just no opportunity for the writer to fire.
3. **Decision: delete**, per the entry's own decision tree.

## What shipped

- `saveRunningBaseline`/`getRunningBaseline` and the `RunningBaseline` interface removed from
  `lib/data/repository.ts` and `lib/data/postgres/adapter.ts`.
- The dead write call (and its now-unused `easyPaceSecPerKm` computation and `pacesFromVdot`
  import) removed from `app/api/running-plan/route.ts`.
- The `runningBaselines` Drizzle table definition removed from `lib/data/postgres/schema.ts` — the
  app can no longer query it at all.

## What's deliberately not done

The physical `running_baselines` Postgres table itself. Dropping it is a schema-changing
migration, and CLAUDE.md's data-dropping rule applies regardless of the table currently holding
zero rows — the safe, reversible half (removing every code path that could reach it) ships now;
the irreversible half (an actual `DROP TABLE`) is a small follow-up gated on the owner's yes
(**Q-301b**). The table is a harmless, fully disconnected leftover in the meantime — nothing in the
app references it any more.

## Verified

- `tsc --noEmit` — clean.
- `pnpm check:rules` — 55 of 55.
- Targeted tests (`prescribed-run-explain-key`, `session-picker`, `repository-ownership-scoping`) —
  72 of 72 passing, unaffected by the removal.

**Not exercised:** production — this only removes a write that was already going nowhere and a
never-called read; there is no behavioural change for any real request. Nothing device, native,
safe-area or offline is touched.
