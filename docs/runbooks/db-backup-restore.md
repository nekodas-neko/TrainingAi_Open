# Runbook: Database Backup & Restore

TrainingAI's only datastore is the Railway-hosted PostgreSQL instance
(`DATABASE_URL`).

## Automatic encrypted backups (the normal path)

`.github/workflows/db-backup.yml` takes a backup **before every release** (the Release workflow
calls it) and **every Monday at 02:17 Brisbane time**. Each run:

1. dumps production with `pg_dump`;
2. restores the dump into an empty Postgres on the runner, and fails if anything doesn't come back;
3. locks it with the `BACKUP_PASSPHRASE` secret (gpg, AES-256);
4. keeps the locked file as a workflow artifact for 90 days. Actions → the run → Artifacts.

The repository is public and anyone signed in to GitHub can download its artifacts, so only the
locked file is ever uploaded. The passphrase lives in two places: the `release` environment, so the
restore workflow can open backups unattended (owner, 13 Oct 2026: "I just need you to be able to
restore from backup if needed"), and the owner's password manager, as the copy that outlives
GitHub. That environment already holds the database's own address, so keeping the passphrase there
exposes nothing new.

The scripts are `scripts/db-backup-verified.sh`, `scripts/db-restore.sh` and their shared
`scripts/db-backup-lib.sh`. Run them locally against throwaway databases to test a change.

### One-off setup (owner)

1. In your password manager, generate a long random password (30+ characters) and save it as
   "TrainingAI backup passphrase".
2. In Railway → `prod_DB` → Variables, copy the value of `DATABASE_PUBLIC_URL`.
3. In GitHub → Settings → Environments → `release`, add two **secrets**:
   - `BACKUP_PASSPHRASE`, set to the password from step 1;
   - `BACKUP_DATABASE_URL`, set to the value from step 2.
4. Tell the Orchestrator. It runs a backup and then a restore check to prove both work.

Until then, a release fails at its backup step. Run Release with `skip_backup` ticked to deploy
without one.

### Restoring (the Orchestrator does this)

`.github/workflows/db-restore.yml`, run from Actions or with
`gh api -X POST repos/<owner>/<repo>/actions/workflows/db-restore.yml/dispatches`:

- **`target: check`** (the default) opens a backup and restores it into a throwaway database on
  the runner, then reports tables, rows and the newest migration. It changes nothing, so it's safe
  any time; run it after setup and whenever there's doubt that backups work.
- **`target: production`** replaces the live database with the backup. Everything written since
  that backup is lost, including ring data the ring won't send again. So it is **confirm-first,
  every time, on the owner's say-so**, and needs `confirm` set to exactly `restore production`. It
  first checks the backup restores, then backs up production as it is now
  (`trainingai-pre-restore-…`, kept on the run). Then it restores in one transaction: on any error,
  or if the job is cancelled, production is left as it was. It waits for the app's in-flight
  queries, and the app's requests wait while it runs.
- **After a production restore,** restart the app: Release with `rollback_to` set to the current
  tag. Migrations newer than the backup re-run on that start.
- **To undo a production restore,** run it again with `backup` set to that run's
  `trainingai-pre-restore-…` name.
- `backup` blank means the newest backup (pre-restore copies excluded). Otherwise give the exact
  file name.

By hand, without GitHub: download the artifact, run
`gpg --decrypt -o backup.dump trainingai-….dump.gpg` with the passphrase, then `pg_restore` as below.

## Railway's built-in backups

**Not available on this plan** (checked 13 Oct 2026): Railway refuses manual backups and backup
schedules with "only available for Pro workspaces". The two backups on the volume were made
automatically when it was resized, in July and August 2026.

## Manual backup

```bash
# From a machine with pg_dump installed and network access to Railway,
# using the connection string from the Railway dashboard → Postgres → Connect:
DATABASE_URL='postgresql://...' ./scripts/db-backup.sh ./backups
```

This wraps `pg_dump --format=custom` with a datestamped filename
(`trainingai-backup-YYYY-MM-DD_HHMMSS.dump`). The custom format is required
for `pg_restore` (below) and supports selective table restore.

Equivalent manual command (if not using the wrapper script):

```bash
pg_dump --format=custom --file=trainingai-backup-$(date +%Y-%m-%d).dump "$DATABASE_URL"
```

**When to take one by hand:** before a bulk data operation that doesn't go
through a release. Releases and the weekly copy are covered by the automatic
backups above.

## Restore to the same instance

⚠️ Destructive — this overwrites existing data. Confirm you actually want to
replace the current database contents before running.

```bash
pg_restore --clean --if-exists --dbname="$DATABASE_URL" trainingai-backup-<date>.dump
```

`--clean --if-exists` drops existing objects before recreating them from the
dump, so the target ends up matching the dump exactly.

## Restore to a new instance (disaster recovery walkthrough)

1. Provision a new Postgres instance (Railway dashboard → New → Database →
   PostgreSQL, or any Postgres 16+ host).
2. Get its connection string (`NEW_DATABASE_URL`).
3. Restore the dump into it:
   ```bash
   pg_restore --format=custom --dbname="$NEW_DATABASE_URL" trainingai-backup-<date>.dump
   ```
   (No `--clean` needed against a fresh, empty database.)
4. Verify row counts against the source instance for a few key tables
   (`users`, `workout_sessions`, `body_metrics`) before cutting over.
5. Update the Railway app service's `DATABASE_URL` environment variable to
   point at the new instance, then redeploy.

## Admin DB snapshot — a different tool for a different job (Q-530)

`pnpm db:snapshot` (backed by `GET /api/admin/db-snapshot`) is **not** a replacement for the
`pg_dump`/`pg_restore` flow above — it exists for a consumer that cannot use that flow at all.

|  | `pg_dump` / `pg_restore` (above) | `pnpm db:snapshot` |
|---|---|---|
| Who it's for | anyone with network access to Railway | an agent sandbox — HTTPS (80/443) only, Railway's Postgres port is blocked by the network policy |
| Fidelity | full — schema, indexes, constraints, every column | data only, through the `claude_ro` view schema — no schema (migrations are the schema), 9 columns withheld |
| Scope | the whole database | one user's rows (whichever user `CLAUDE_RO_OWNER_USER_ID`/`ADMIN_EXPORT_USER_ID`/`WEBHOOK_USER_ID` resolves to) |
| Auth | Railway's own Postgres credentials | `ADMIN_SNAPSHOT_SECRET` (separate from `ADMIN_EXPORT_SECRET`) + `requireAdmin` |
| Use it for | real backup/restore, disaster recovery | rehearsing a migration against prod-shaped rows, `pnpm dev` against realistic data |

If you have `pg_dump` and network access, it is strictly better than the snapshot endpoint for
every purpose above — lower fidelity, more code, another secret to manage. Reach for it. The
snapshot endpoint exists only because the sandbox that runs Lane A/B implementation sessions has no
other way to reach production data at all.

**Restoring a snapshot into the local dev DB:**

```bash
SNAPSHOT_URL='https://<railway-app>/api/admin/db-snapshot?bulk=0' \
ADMIN_SNAPSHOT_SECRET=<the secret> \
pnpm db:snapshot
```

- `bulk=0` (or omitted) excludes the four large tables (`oura_raw_samples`, `oura_heartrate`,
  `rr_intervals`, `error_events`) — the default, and "a few megabytes" covering every shaped
  domain (plan §1). `bulk=all` includes them whole; `bulk=<days>` includes a trailing window.
- **Refuses to run against anything but the local dev DB** (loopback/socket host, port 5433) —
  hard guard, checked before any fetch. This command `TRUNCATE`s tables.
- `push_subscriptions` cannot round-trip (its three withheld columns are `NOT NULL`) and is
  skipped, reported in the output. The owner's `users.password_hash` (withheld, nullable) is
  stamped with the same bcrypt hash `scripts/local-db/seed.sql` uses, so `pnpm dev` logs in
  immediately with the standard local dev password.
- Prints loaded row counts against the snapshot's own manifest and fails loudly on any mismatch.

## Verifying a dump without restoring

To sanity-check a dump file's contents without touching any live database:

```bash
pg_restore --list trainingai-backup-<date>.dump | head -50
```

This prints the table of contents (schemas, tables, and row-count-bearing
objects) without executing anything.
