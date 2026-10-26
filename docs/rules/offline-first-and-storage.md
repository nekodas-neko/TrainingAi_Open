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

**A migration's REVERSE note for a column on a table with a `claude_ro` view starts with
`DROP VIEW IF EXISTS claude_ro.<table>;`** (#3246). The generated view lists the column
explicitly, so a bare `ALTER TABLE <table> DROP COLUMN <col>` fails with `view claude_ro.<table>
depends on column <col>`, and that is the statement someone pastes during an incident. Write
`DROP VIEW IF EXISTS claude_ro.<table>; ALTER TABLE <table> DROP COLUMN <col>;` and say the boot
rebuild recreates the view from `claude-ro-views.sql`. Check the table against that file; tables
with no view need no `DROP VIEW`.

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

## A reset, a deletion or a different account must not let old rows come back (#3369)

The stores are offline-first, so an admin's reset of a user's data is undone by the next upload from
any device that still holds the old rows. The guarantees, and where each lives:

- **Every write carries the device's data epoch, and the server refuses a stale one with 409.**
  `middleware.ts` (via `lib/auth/data-epoch-gate.ts`) is the one place; no route is edited and a new
  route is covered. The account's epoch rides in the session token (`userClaims` → `dataEpoch`); the
  device's rides in `X-Data-Epoch` (Preview) or the `ta_data_epoch` cookie (the Capacitor app, whose
  Kotlin ring service forwards the WebView's cookies). Reads, `/api/auth/*` and `DELETE /api/account`
  are never gated. `fetch` is wrapped once at the root (`lib/data-epoch-fetch.ts`): a 409 wipes and reloads.
- **A device records which user id owns its local store** (`lib/local-store/device-owner.ts`;
  Preview: `src/features/account/device-record.ts`). Signing in as a different id wipes before any read or sync.
  `getLocalStore` answers null while another account's rows are there. This is what covers delete then re-signup.
  **A device with no record** (every install, on the first launch of the version that records one)
  looks at its store and at how the session began. Empty: claimed. Rows, and the session predates the
  update (its token has no `signedInAt`, so it is the session that wrote them): **adopted, nothing
  wiped, outbox kept.** Rows, and a fresh sign-in (it has `signedInAt`): the same account signing in
  again after an expired or lost cookie, or delete then re-signup. The outbox tells them apart: **an
  entry stamped with the signed-in `user_id`, of any status (pending, in backoff, failed), proves the
  rows are that account's, so the device adopts them and wipes nothing.** A replacement account never
  has its new id in the outbox. With no such entry, the account's own queued writes are pushed first
  (best effort; outbox only, no stranded-row sweep), the outbox is checked again, and only if it still
  holds nothing for the account is everything wiped and claimed. The push is capped at 10 s: at the
  cap it is aborted and waited for, so a push never runs alongside the wipe, and if it will not stop
  the wipe does not happen. If any look fails the store stays closed and the next call asks again
  after a short doubling backoff (5 s up to 60 s), not on every call; a record that cannot be written
  is treated the same way. `/api/account/data-epoch` leaves `signedInAt` out for a bearer request
  (a native token is re-stamped on every rotation), which the device reads as "cannot tell". Preview, a
  phone with no record that also holds another account's scope: only the other accounts' scopes are
  wiped; the signed-in account's scope and outbox stay, and it is not signed out (#3396). Queued
  localStorage uploads count as data; cached responses do not. An empty
  user id is never recorded as an owner.
- **Neither app pushes the previous owner's unsent writes before an account change (#3435).** The web
  wipes straight away on a known different owner (`resolveStoreOwnerMismatch` → `wipeAndClaim`); its
  push-before-wipe (`pushOwnOutboxBeforeWipe`, on a recordless device) only drains the signed-in
  account's own entries. Preview holds one session slot: sign-out removes the saved session from secure storage, and a
  sign-out the person chose also revokes its tokens on the server, so by the time another account
  signs in nobody holds a credential that could send the previous owner's queue (`HistoryOutbox`, the
  journal, the strap and scale outboxes, the Health Connect queue). Signing in as anyone but the
  recorded owner (`reconcileDevice`, `device-record.ts`) then wipes every account scope. **What is
  lost:** whatever that previous owner had logged on this phone and not yet synced when they signed
  out, and it is lost at the new account's sign-in, not at sign-out. Their synced data is on the
  server and returns on their next sign-in. Nothing is lost when the same account signs back in with
  no admin reset since (after a reset that account's own scope is wiped too). A phone with no record
  loses every other account's scope, since it cannot tell which are orphans. No push is invented for
  this in either app: it would need a flush before sign-out clears the session, which is a new
  feature, not parity with the web, and not a change to the wipe. Until that exists, the wipe stays, because the scopes it
  removes belong to a person who is not the one holding the phone.
- **Device-scoped state that describes the previous owner is reset when the owner changes.** The wipe
  leaves the `device` scope alone, so state in it that means "this person's situation" outlives the
  account. `reconcileDevice` calls `ownerChanged` after a wipe for a different owner (and after
  clearing other accounts on a recordless phone), and Preview uses it to set the ring battery alert's
  `fired` flag back to false so the next account's first low reading alerts. The level and the on/off
  the person chose are kept. It is best effort; a failure never blocks the sign-in. A same-owner
  reset does not call it. Any new device-scoped key with such a flag joins that hook.
- **A wipe that fails opens nothing.** The epoch record, and the cookie the server's gate reads, are
  written only after every clear (each SQLite table, the cache) succeeded. A partial wipe keeps the
  gate closed and the next launch wipes again; the clears raise instead of being swallowed.
- **A covered write holds off a reset and a reset holds off a covered write**
  (`lib/data/postgres/user-write-barrier.ts`, an advisory lock). The sync push and the ring-sample
  ingest use it; the other upload paths rely on the 409 gate alone.
- **A new upload path needs nothing to be covered by the gate**, but a new queue of unsent writes must
  be wiped by `clearAccountStorage` (web) or live under the account scope (Preview), the same census as sign-out.
- **The phone's `oura_raw.db` is deliberately NOT wiped** by a reset, a sign-out or an account change.
  Nothing re-uploads its old rows (only newly drained batches are POSTed), and clearing it resets the
  ring cursor to 0, which would re-drain and re-upload the ring's whole buffer, i.e. bring pre-reset
  history back. Its cursor is tied to the ring's BLE key and pairing, which no wipe may touch.
  Not covered: ring events recorded before a reset that the phone had not yet drained still arrive afterwards. Likewise Health Connect's history window is imported again on the next sync, and Oura Cloud returns on reconnect; the admin dialogs say so (`packages/shared/src/admin-wipe-copy.ts`).
