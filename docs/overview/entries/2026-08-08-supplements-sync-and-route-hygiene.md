# 2026-08-08 — Supplements get a pull-clobber guard, and five admin media routes get a rate limit

**Domain:** nutrition / platform — v1.270.7, JS-only (no APK rebuild) · local SQLite **v22**

Q-124 and Q-134 in one PR, because both change `updateSupplement` and the backlog says so.

## Q-124(a) — supplements was the one write domain a pull could clobber

`CREATE_SUPPLEMENTS` had neither `sync_status` nor `deleted_at`, so `applyDelta` called
`upsertSupplement` unconditionally and overwrote in full. Every other domain's arm gates on
`sync_status='synced'`; this one **could not**, because the column did not exist. Supplements are a
full offline write domain (create/rename/toggle/delete all `queueMutation`), so a rename made
offline reverted to the server's old value on the next pull.

- **Local migration v22** adds both columns, with matching `RECONCILE_COLUMNS` rows — which are the
  real authority after a partial upgrade, since `ADD COLUMN` is not idempotent. `CREATE_SUPPLEMENTS`
  carries them for fresh databases.
- **`applyDelta`** stops calling `upsertSupplement` and does its own insert with
  `WHERE supplements.sync_status='synced'`, plus a tombstone arm (`DELETE … AND sync_status='synced'`)
  — same shape as the injuries arm directly below it. The server already emits `deletedAt` for
  supplements in `getSyncDelta`, so cross-device deletes now actually land.
- **`upsertSupplement`** writes `sync_status='pending'`. Every caller is a local user edit paired
  with a `queueMutation`, so this needed no change at any call site — the pull path no longer goes
  through it.
- **`markSupplementSynced`** + a `supplements` arm in the sync engine's confirm loop flips the row
  back. Without it a pending row would be permanently unreachable by sync — the guard would have
  become a different bug.
- `getSupplements()` now also filters `deleted_at IS NULL`.

## Q-124(b) — one cache key, two incompatible envelopes

`nutrition-content.tsx` fetched `supplements` with `cachedFetchToday` on one branch and
`cachedFetch` on the adjacent one: same key, same URL, incompatible envelopes (`{date,data}` vs a
raw array). Whichever wrote last decided whether the other branch's `Array.isArray(d)` was true, and
when it was not the section rendered **empty**. This is the `weekly-stats` crash class and was the
last variant mismatch in the codebase.

Converted to `cachedFetchToday` — the variant the seed site (`readTodayCacheSync`), the
sync-provider's warm pass and the other fallback branch all already use. The `else` branch is
reachable on device, not just web: `getLocalStore()` returns null whenever the store failed to open
or before `userId` resolves.

**Not claimed as fixed:** the review flagged `supplement_logs` holding 1 row since 2026-06-21 as
*possibly* explained by this. Nothing here confirms that, and the table may simply be unused —
recorded as a plausible mechanism, not a diagnosis.

## Q-124(c) + Q-134 — `updateSupplement`

Both land in one function:

- **Q-124(c) was wrong, and this is the correction.** The claim: `PATCH /api/supplements/[id]` never
  bumps `updated_at` (`defaultNow()`, no `$onUpdate`), so a web edit is invisible to `getSyncDelta`
  forever. Migration **078** installs a `BEFORE UPDATE` trigger (`trg_set_updated_at`) on
  `supplements` — the DB has always bumped it. Verified live, not by reading: a real PATCH against
  `pnpm dev` moved `updated_at` from 03:53:19 to 03:53:32 and the row came back in the next
  `GET /api/sync/pull?since=…` delta. The repo function now sets `updatedAt` explicitly anyway, so a
  sync-critical column does not depend on a trigger no code here references — but nothing was
  broken, and the review entry has been struck through with the reason.
- **The raw request body went into Drizzle `.set()`.** The `Omit<>` is compile-time only, so
  `userId`/`deletedAt`/`createdAt` are settable column keys; it was safe **only** because the single
  caller uses `.strict()` — safety living one route away. Now an explicit allowlisted `set` object,
  the shape `updateInjury` already uses.

## Q-134 — five admin media routes had no rate limit

`admin/generate-exercise-media`, `admin/test-exercise-image`, `admin/reference-figure`,
`admin/mirror-dataset-gifs`, `admin/seed-exercise-gifs` — the only admin routes with no limit, while
`admin/ai-usage`, `admin/db-query` and `admin/day-review` all have one. Added 10/min per admin on
every handler in those files, keyed `admin-<slug>:<userId>`, matching the sibling shape
(auth → `requireAdmin` → `rateLimit`). Admin-gated, so the exposure is a mis-click or a runaway
client loop rather than an attacker — but generation is slow and paid.

Two of them (`test-exercise-image`, `seed-exercise-gifs`) are deletion candidates under Q-136, which
is another agent's item. A limit on a route that may be deleted is a few lines wasted at worst;
leaving four of five unlimited to wait on that decision was the worse trade.

## Verification

`tsc --noEmit` clean · `eslint` on every touched file matches the pre-existing baseline · full suite
406 files / 3225 tests, one failure (`scale-ble-multi-reading.test.ts`) that **also fails on a
stashed clean tree** — needs a second user row the local seed lacks. Pre-existing, unrelated.

One run also showed `cable-exercise-merge-migration.test.ts` failing; it passes in isolation and did
not reproduce on a re-run. Cross-test interference on the shared local dev Postgres, the class
`CLAUDE.md` documents — CI runs on a clean database.

New tests: three in `sqlite-backend.test.ts` (the pull upsert carries the synced guard, the tombstone
arm spares pending rows and does not also upsert, and a local write marks the row pending), one in
`migrations.test.ts` (v22 adds both columns), and two DB-backed ones in
`update-supplement-allowlist.test.ts` (the partial patch keeps unsent fields and moves `updated_at`;
out-of-allowlist column keys are ignored rather than written). **The allowlist test fails against the
pre-fix adapter** — checked out the old file and re-ran — so it tests the fix, not the harness. The existing "every ALTER-added column is mirrored in
RECONCILE_COLUMNS" guard covers the new migration automatically — that assertion is why the reconcile
rows are not optional.

**Not exercised:** no on-device run. This is the half of the change that only matters on device —
native SQLite does not run in this sandbox, so the v22 upgrade path, the reconcile fallback and the
offline rename→pull sequence are verified by unit test and code review only. A device smoke run
(`docs/device-smoke-checklist.md`) is the real gate; a Known-Issues row records that.
