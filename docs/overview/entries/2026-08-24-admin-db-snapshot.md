# An admin DB snapshot endpoint, so a migration's first real run is not production (Q-530)

**Branch:** `feat/admin-db-snapshot` · **Lane A**

## What shipped

`GET /api/admin/db-snapshot` — a prod-shaped NDJSON export of the owner's own data over the
existing `claude_ro` view schema, plus `pnpm db:snapshot` to fetch and restore it into the local
dev DB. Per [`plans/2026-08-17-admin-db-snapshot-endpoint.md`](../../superpowers/plans/2026-08-17-admin-db-snapshot-endpoint.md).

The consumer this exists for is the agent sandbox: it reaches Railway only over 80/443 (the
Postgres port is blocked by the network policy), so an HTTPS endpoint is the only way in. Anyone
with real Postgres access should keep using `pg_dump`/`pg_restore`
(`docs/runbooks/db-backup-restore.md`) — this is strictly worse for them (lower fidelity, another
secret) and exists only for the consumer that has no other path.

- `lib/export/db-snapshot.ts` — view/column enumeration, a drift gate (`public` base tables minus
  `claude_ro` views minus the generator's own exclusion list, computed from `pg_catalog` at request
  time so it can never silently miss a newly added table or column), primary-key discovery, keyset
  pagination for streaming.
- Two new meta views, `claude_ro._meta_excluded_tables` / `claude_ro._meta_withheld_columns`
  (migration 211), so the drift gate can name deliberate exclusions instead of flagging them.
- The route mirrors `day-review`'s dual auth (session or `Bearer $ADMIN_SNAPSHOT_SECRET`,
  rate-limited, fail-closed if either required var is unset) and streams NDJSON with a manifest
  line first. The four large tables (`oura_raw_samples`, `oura_heartrate`, `rr_intervals`,
  `error_events`) are excluded by default; `bulk=all`/`bulk=<days>` opts them back in.
- `scripts/local-db/snapshot.js` restores into the local dev DB: refuses any target but
  loopback/socket-host port 5433, applies `pnpm db:local` first (the snapshot carries data, not
  schema), truncates and re-inserts under `session_replication_role = 'replica'`, resyncs every
  `bigserial` sequence generically, and stamps the seed's known bcrypt hash onto `password_hash`
  (withheld and nullable in the export) so `pnpm dev` logs in immediately.
- `ADMIN_SNAPSHOT_SECRET` — a separate secret from `ADMIN_EXPORT_SECRET`, already approved and
  provisioned by the owner in both Railway and this session's environment ahead of this PR (per the
  backlog entry). No further confirmation was sought for the secret itself; the route's error
  responses were tightened (see below) as part of the same secret-handling discipline.

## Two bugs caught before shipping

- **`new URL()` cannot parse this sandbox's own `DATABASE_URL`.** The session-start hook writes
  `postgresql://postgres:postgres@/trainingai_dev?host=/tmp&port=5433` (empty host between `@` and
  `/`), which the WHATWG URL parser rejects outright. The restore script's local-target safety
  guard — the one thing standing between a mistaken run and `TRUNCATE`ing a real database — would
  have thrown a confusing "not a valid URL" error on its own default target. Replaced with a
  tolerant regex parser, verified against six cases including a deliberate spoofing attempt (a real
  `evil.host` authority with `?host=/tmp` in the query string, to confirm the query string cannot
  override the actual connection authority).
- **`ALTER ROLE ... SET` only affects new connections.** An integration test re-pointed
  `app.claude_ro_owner` after a pool was already open and reused that pool, so the view predicate
  never changed and the test hung past its timeout. Fixed by opening a fresh pool after the ALTER.

## Verification

- `pnpm check:rules` — Ran 55 of 55.
- `lib/export/__tests__/db-snapshot.test.ts` (17 pure-logic cases) and
  `db-snapshot-integration.test.ts` (5 cases against a real, freshly-provisioned `claude_readonly`
  role, including a forced 3-page keyset pagination asserting no duplicate keys) — both pass in
  isolation. Running them alongside `claude-ro-readonly-role.test.ts` in the same invocation races
  both files' role provisioning/teardown (the documented "never run two role-provisioning suites
  together" hazard) — run separately, or accept the flake CLAUDE.md already describes.
- `claude-ro-readonly-role.test.ts` updated for the two new meta views (23/23 pass).
- Full suite: 4688 passed, 51 skipped, 2 pre-existing failures unrelated to this change (missing
  `qrcode` package in this sandbox's `node_modules`, same gap noted elsewhere this session).
- `tsc --noEmit` clean except the same pre-existing sandbox gaps (`qrcode`, `@sentry/nextjs`).

## Not exercised

**The live route itself was never called.** `pnpm dev` cannot run in this sandbox (missing
`@sentry/nextjs`/`qrcode`), so the only verification of `GET /api/admin/db-snapshot` is the
integration tests exercising its core logic directly against a real `claude_readonly` role — not
an HTTP round-trip through the route handler, auth, or the NDJSON stream response. The backlog
entry's own note that "nothing has verified the Railway half yet" still holds: the first real
check is `curl -si https://.../api/admin/db-snapshot -H "Authorization: Bearer $ADMIN_SNAPSHOT_SECRET"`
returning a 200 and a manifest line, once this deploys.
