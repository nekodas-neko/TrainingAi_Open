# Offline-first, storage, migrations and the database pool

> Moved verbatim from `CLAUDE.md` on 2026-10-05, when it was cut from 121 KB to the short form (release train, Phase 4). `CLAUDE.md` keeps each rule as one line pointing here; **this file keeps the reasons and the incidents behind them**, which is what makes a rule hold. Some passages describe the retired seven-agent process (lanes, batons, the backlog file) — where they do, the rule they carry still stands and the mechanism around it is history.

## Offline-First — the on-device local store is the source of truth (do not violate)

**This is a strict rule and the cause of a recurring class of "my data disappeared" bugs.** The app is offline-first: the on-device SQLite **local store** (`lib/local-store/`) is the source of truth; the API/Postgres is backup + cross-device sync. Writes go to the local store **and** the mutation outbox (`store.upsertX` + `queueMutation` → `pushMutations`).

**The inverse rule, which is the one that actually broke (Q-488, 2026-08-18): a domain the UI reads local-first must have EVERY write update the local store — deletes included, and including a write made from a screen that itself reads server-side.** That last clause is why it hid: `health-content.tsx` deleted an activity through the API only, and its own screen reads the server-assembled `day-log:` aggregate, so the row vanished there instantly while three local-first surfaces kept showing it until the next pull (throttled to 5 minutes and never forced by that path). Nothing on the originating screen could reveal it. Every other mutating write to a local-first domain was audited and all eight write locally; this was the only one.

**The rule: if a domain WRITES to the local store, its UI MUST READ from the local store (local-first) — never server-only.** A UI that writes locally but reads via `cachedFetch`/`fetch('/api/…')` only shows data once it has synced to the server; any unsynced or sync-failed write silently vanishes on navigation or app restart. That is exactly backwards from offline-first.

**Reference pattern (correct): supplements.** `app/nutrition/nutrition-content.tsx` reads `getLocalStore(userId)` → `store.getSupplements()`/`getSupplementLogs(date)` and only falls back to the API when the store is unavailable/empty. Copy this shape for every offline-first domain.

**Rendering requires the data locally.** A local table must hold enough to render offline. `food_logs` originally stored only a `food_item_id` (no name/macros), so the page was forced to read from the server (which joins `food_items`) — that was the food-disappearing root cause. Any log/reference table needs its display data available locally (its own table hydrated on write + via the pull-delta, or a denormalised snapshot).

**Checklist for any new or touched offline-first domain:**
1. Write path uses `store.upsertX` + `queueMutation` (not just the API).
2. The local table holds everything needed to **render** the row offline.
3. **Every** UI read site reads local-first (`store.getX`), API only as fallback/hydration.
4. Server responses fetched by the page hydrate the local store (so history is available offline next time).
5. Verify on the **APK** — native SQLite does not run in the web/dev sandbox (`getLocalStore` returns null there), so web tests pass while the device path is still broken. On-device is the authoritative check.

Read-site status (re-audited 2026-07-02, session 178): the 2026-07-01 migration list is done — `activity_logs`, `mood_logs`, `body_metrics`, `injuries`, food and supplements all read local-first now. The remaining server-only reads are cross-session aggregates (`weekly-stats`, `weekly-muscle-sets`, `weights-summary`, `muscle-recovery`) which are server-computed by design — leave them on `cachedFetch`. **Sanctioned exception (session 287, R3 SYNC-R3):** `home-day-timeline.tsx` also reads server-only (`/api/day-timeline`) despite merging several already-local-first domains (workouts, food, mood, activity, supplements) — it's a cross-domain server-assembled aggregate (not a single-domain read), and building a client-side timeline assembler that reproduces the server's merge/sort/formatting logic was judged out of scope for the R3 batch that found it. Today's timeline can go briefly stale/blank offline until sync; revisit if this becomes a live pain point.

---

## Data Layer Rules — Sync, Migrations, Stored Counters

Offline-sync write-path mirroring, local SQLite migration safety, Postgres seed-vs-drift rules,
stored-counter derivation, and the "a correlation across a model change is not evidence" trap all
moved to [`docs/data-layer-rules.md`](../data-layer-rules.md) — mostly Lane A's territory
(`lib/data/**`, `lib/local-store/**`, `app/api/**`) per the standing-agents lane split. The single
rule worth carrying even into UI-only work: **a server hard DELETE is invisible to devices that
haven't synced** — any domain with delete UI needs a `deleted_at` tombstone, or cross-device deletes
silently don't propagate.

## Migrations that add a table or column — regenerate `claude-ro-views.sql` in the same PR

`claude_ro` is **default-deny**: a table with no view is unreadable, and the generator emits an
explicit column list, so a new column is invisible to `/api/admin/db-query` until the views are
rebuilt. Every migration that adds or drops a table or column regenerates the one file, in place:

```
LOCAL_DATABASE_URL=<tcp url> CLAUDE_RO_OWNER_USER_ID=<uuid> node scripts/generate-claude-ro-views.js \
  > lib/data/postgres/claude-ro-views.sql
```

**It is not a migration (BF-214, 2026-09-27): overwrite it, and take no number for it.** It was
re-issued under a new number on every schema change — 59 copies, 92% of the migration corpus — and
two copies landing together silently destroyed each other. `ensureSchema` and `migrate.js` apply it
after the migrations whenever its content hash is not in `schema_migrations`. **Never add a
migration that creates or drops the `claude_ro` schema**: `claude-ro-views-file.test.ts` fails on
one, and on a file that differs from what the generator emits, so a forgotten column fails CI. Name a
migration from `node scripts/next-schema-number.js`: a UTC minute, `YYYYMMDDHHMM_<what>.sql` (BF-214 ②;
appliers sort by leading integer). **The owner's id must not appear in the file** (Q-456).

**⚠ The generator reads `LOCAL_DATABASE_URL`, not `DATABASE_URL`** (LA-161). The wrong one does not
fail: it reads the session's dev database, and anything hand-applied there reaches the file. Build a
scratch database (`CREATE DATABASE` + `node scripts/local-db/migrate.js`) if in doubt.

**⚠ The two role/export tests are NOT "CI-only", and believing they were cost a red
run on 2026-09-20 (TN-54).** `claude-ro-readonly-role.test.ts` and `db-snapshot-integration.test.ts`
skip under the full suite, but **not** because local dev lacks the `claude_readonly` role — the
first one provisions that role itself. They need a **TCP** `DATABASE_URL`: the test reconnects as
`claude_readonly` by rewriting the URL's credentials, and on the Unix-socket URL that
`scripts/local-db/setup.sh` writes, the rewrite silently reconnects as the superuser, so the file
skips loudly rather than reporting 20 false failures. Its own header says so.

**So run them before pushing any migration that adds a table or column:**

```
DATABASE_URL='postgresql://postgres:postgres@localhost:5433/trainingai_dev' \
  npx vitest run lib/data/postgres/__tests__/claude-ro-readonly-role.test.ts \
                 lib/export/__tests__/db-snapshot-integration.test.ts
```

Measured that day: 2 files, **27 tests, all passed, none skipped**. A green 956-file local suite had
said nothing, because both had skipped inside it.

---

## Database — Connection Pool (load-bearing; do not weaken)

The `pg` Pool in `lib/data/postgres/client.ts` MUST keep its `pool.on('error', …)` handler and the `statement_timeout` / `idle_in_transaction_session_timeout` settings. Without the error handler, a transient DB blip becomes an `unhandledRejection` that crash-loops the process; without the timeouts, a process killed mid-transaction leaves orphaned `idle in transaction` sessions that pin connection slots until the DB hits its limit. Both took production down in session 165. Keep `max` modest (10) — total connections = `max` × replica count must stay under the Railway Postgres connection limit. Before re-enabling or adding a heavy sync domain (e.g. `workout_log`), load-test it against a realistic outbox backlog.

**Accepted risk — TLS `rejectUnauthorized: false` (SEC-I6):** the prod SSL config is encrypted-but-unauthenticated TLS to Postgres. This is deliberate and is Railway's standard pattern (its managed Postgres uses self-signed certs, so certificate verification would fail). The app↔DB link is on Railway's private network. Do **not** cargo-cult this setting into any other outbound connection (external APIs, webhooks) — it belongs only on this Railway-internal DB link. If Railway ever exposes the instance CA, pin it via `ssl.ca` and flip `rejectUnauthorized` back on.

---
